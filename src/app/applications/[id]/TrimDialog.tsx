"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { TrimSuggestion } from "./actions";

// 履歷超出一頁時，AI 給的取捨建議清單（已經依優先順序排好）。
// 打開時預設只勾「實際量過、剛好塞回一頁」的最少那幾條，其他的列在後面當備用。
// 每勾一條都會重新排一次 PDF 量（伺服器端，約 0.3 秒），上面直接顯示「套用後剛好一頁／還超出幾行」，使用者不用猜。

export function TrimDialog({
  suggestions,
  initialChecked,
  measure,
  linePt,
  onApply,
  onCancel,
}: {
  suggestions: TrimSuggestion[];
  initialChecked: boolean[];
  /** 套用這幾條之後，PDF 超出一頁多少 pt（0 = 塞得下）。 */
  measure: (picked: TrimSuggestion[]) => Promise<number>;
  linePt: number;
  onApply: (picked: TrimSuggestion[]) => void;
  onCancel: () => void;
}) {
  const [checked, setChecked] = useState<boolean[]>(initialChecked);
  const picked = suggestions.filter((_, i) => checked[i]);
  // 記下量的是哪一組勾選；跟目前的勾選不一樣就是還在量（顯示 null）。很快連點時只採用最後一次的結果。
  const [result, setResult] = useState<{ for: boolean[]; overflow: number } | null>(null);
  const overflowAfter = result?.for === checked ? result.overflow : null;
  useEffect(() => {
    let cancelled = false;
    measure(suggestions.filter((_, i) => checked[i]))
      .then((overflow) => !cancelled && setResult({ for: checked, overflow }))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [measure, suggestions, checked]);
  const linesAfter = overflowAfter === null ? 0 : Math.ceil(overflowAfter / linePt);
  // 預設勾選的那幾條之後的，都是備用建議。
  const recommendedCount = initialChecked.filter(Boolean).length;

  return createPortal(
    <div className="confirm-overlay" onClick={onCancel}>
      <div
        className="confirm-card trim-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="trim-dialog-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="trim-dialog-title" className="heading-card--lg">
          AI 建議的取捨
        </h2>
        <p className="text-body">
          已經幫你勾好剛好能塞回一頁的組合（優先刪跟 JD 關聯最低的內容，特別冗長的句子才精簡）。可以自己換掉想保留的，套用後也能按「復原」退回。
        </p>

        {suggestions.length === 0 ? (
          <p className="text-muted">AI 沒有找到適合取捨的內容，可以試著自己精簡摘要或較長的條目。</p>
        ) : (
          <>
            <p
              className={`trim-status ${overflowAfter === null ? "" : overflowAfter > 0 ? "trim-status--over" : "trim-status--fit"}`}
              role="status"
            >
              {overflowAfter === null
                ? "計算套用後的 PDF 頁數…"
                : overflowAfter > 0
                  ? `⚠ 套用後還超出約 ${linesAfter} 行`
                  : "✓ 套用後剛好一頁"}
            </p>
            <ul className="trim-list">
              {suggestions.map((s, i) => (
                <li key={i}>
                  {i === recommendedCount && recommendedCount > 0 && recommendedCount < suggestions.length && (
                    <p className="trim-list-divider">備用建議：想再精簡一點再勾</p>
                  )}
                  <label className={`trim-item ${s.action === "remove" ? "trim-item--remove" : ""}`}>
                    <input
                      type="checkbox"
                      checked={checked[i]}
                      onChange={() => setChecked((prev) => prev.map((v, j) => (j === i ? !v : v)))}
                    />
                    <span className="trim-item-body">
                      <span className={`trim-item-tag ${s.action === "remove" ? "trim-item-tag--remove" : ""}`}>
                        {s.section === "summary" ? "精簡摘要" : s.action === "remove" ? "刪掉這條" : "精簡這條"}
                      </span>
                      <span className="trim-item-original">{s.original}</span>
                      {s.action === "shorten" && s.newText && <span className="trim-item-new">→ {s.newText}</span>}
                      <span className="trim-item-reason">{s.reason}</span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </>
        )}

        <div className="btn-wrapper">
          <button type="button" className="btn btn-secondary" onClick={onCancel}>
            取消
          </button>
          <button type="button" className="btn btn-primary" disabled={picked.length === 0} onClick={() => onApply(picked)}>
            套用 {picked.length} 項
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

type TrimmableResume = {
  summary: string;
  work_experience: { bullets: string[] }[];
  leadership: { bullets: string[] }[];
};

/**
 * 把勾選的建議套進履歷。用原文找要改的那一條，不靠編號：
 * 同一批裡前面刪掉一條，後面的編號就會跑掉；第二輪建議也是對著第一輪改過的版本編號的。
 */
export function applyTrimSuggestions<R extends TrimmableResume>(resume: R, picked: TrimSuggestion[]): R {
  const next = {
    ...resume,
    work_experience: resume.work_experience.map((e) => ({ ...e, bullets: [...e.bullets] })),
    leadership: resume.leadership.map((e) => ({ ...e, bullets: [...e.bullets] })),
  };
  for (const s of picked) {
    if (s.section === "summary") {
      if (s.newText) next.summary = s.newText;
      continue;
    }
    const entry = next[s.section][s.entryIndex ?? -1];
    if (!entry) continue;
    const index = entry.bullets.indexOf(s.original);
    if (index === -1) continue;
    if (s.action === "shorten" && s.newText) entry.bullets[index] = s.newText;
    // 每段經歷至少留一條。
    if (s.action === "remove" && entry.bullets.length > 1) entry.bullets.splice(index, 1);
  }
  return next;
}

/**
 * 找出「剛好塞回一頁」要套用前幾條：前 1 條、前 2 條…每種組合一次送去排 PDF 量。
 * 全部套上還是超出，就回傳 null（呼叫端會再請 AI 補一輪）。
 */
export async function findMinimalTrim<R extends TrimmableResume>(
  resume: R,
  suggestions: TrimSuggestion[],
  measureMany: (candidates: R[]) => Promise<number[]>,
): Promise<number | null> {
  const candidates = suggestions.map((_, i) => applyTrimSuggestions(resume, suggestions.slice(0, i + 1)));
  const overflows = await measureMany(candidates);
  const index = overflows.findIndex((o) => o <= 0);
  return index === -1 ? null : index + 1;
}
