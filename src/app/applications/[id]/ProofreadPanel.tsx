"use client";

import { InfoTip } from "@/app/InfoTip";
import {
  FORMAT_CARD,
  PROOFREAD_CATEGORY_LABEL,
  proofreadCardKeys,
  type ProofreadIssue,
} from "@/lib/resumes/proofreadTypes";

// 「校稿」結果（履歷頁、求職信頁共用）：校稿時取代右欄的 JD 條件卡片，按 × 關掉就換回來（2026-10-28 Z 選的）。
// 跟經歷資料庫的建議欄一樣：點哪一張卡，畫布就捲到那一句，直接畫刪除線、標綠底（見 ProofreadMarks.tsx）；
// 一開始選第一張，處理完一張自動換下一張。按「套用」才會改，「略過」只是從清單拿掉，處理完最後一張自動關掉。
// 格式問題（中英空格、全形標點）是程式查的、改法固定，合成最上面一張卡一次套用：
// 舊的履歷常常有十幾處，一項一項列會把錯字、事實這些真正要看的蓋掉（2026-10-28 實測 19 項裡 15 項是空格）。
// 實際怎麼套用由頁面決定（見 canvas.tsx、CoverLetter.tsx 的 applyProofread）。

export function ProofreadPanel({
  issues,
  activeKey,
  disabled,
  onActivate,
  onApply,
  onSkip,
  onClose,
}: {
  issues: ProofreadIssue[];
  /** 被點選的那張卡（見 proofreadCardKeys）。 */
  activeKey: string | null;
  disabled: boolean;
  onActivate: (key: string) => void;
  /** 套用這張卡的建議（格式卡一次給全部）。 */
  onApply: (key: string) => void;
  /** 從清單拿掉這張卡。 */
  onSkip: (key: string) => void;
  onClose: () => void;
}) {
  const format = issues.filter((i) => i.category === "format");
  const others = issues.filter((i) => i.category !== "format");
  const byId = new Map(issues.map((i) => [i.id, i]));
  const count = [
    others.length > 0 && `找到 ${others.length} 個地方可以改`,
    format.length > 0 && `${others.length > 0 ? "另外 " : "找到 "}${format.length} 處格式問題`,
  ]
    .filter(Boolean)
    .join("，");

  return (
    <div className="card card--sm proofread-panel" aria-label="校稿建議">
      <div className="proofread-header">
        <h2 className="heading-card">
          校稿
          <InfoTip label="校稿檢查什麼">
            <ul>
              <li>錯字、文法、簡繁誤轉</li>
              <li>全形標點、中英文之間的空格</li>
              <li>跟經歷資料庫、AI 記住的事對不上的事實</li>
              <li>前後寫法不一致</li>
              <li>點卡片會在左邊標出要改哪裡，按「套用」才會改</li>
            </ul>
          </InfoTip>
        </h2>
        <button type="button" className="elicitation-close" onClick={onClose} aria-label="關閉校稿，回到 JD 條件">
          ×
        </button>
      </div>
      <p className="proofread-count">{count}</p>

      <ul className="proofread-list">
        {proofreadCardKeys(issues).map((key) => {
          const isFormat = key === FORMAT_CARD;
          const issue = isFormat ? null : byId.get(key)!;
          const active = key === activeKey;
          return (
            <li
              key={key}
              className={`proofread-item ${active ? "proofread-item--active" : ""}`}
              role="button"
              tabIndex={0}
              aria-pressed={active}
              onClick={() => onActivate(key)}
              onKeyDown={(e) => {
                if (e.target !== e.currentTarget) return;
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onActivate(key);
                }
              }}
            >
              <div className="proofread-item-meta">
                <span className={`proofread-tag proofread-tag--${isFormat ? "format" : issue!.category}`}>
                  {PROOFREAD_CATEGORY_LABEL[isFormat ? "format" : issue!.category]}
                </span>
                <span className="proofread-where">{isFormat ? `${format.length} 處` : issue!.where}</span>
              </div>
              <p className="proofread-reason">{isFormat ? formatSummary(format) : issue!.reason}</p>
              {issue?.replacement === "" && <p className="proofread-where">建議整段刪掉</p>}
              <div className="btn-wrapper proofread-actions">
                {issue?.replacement === null ? (
                  <button type="button" className="btn btn-secondary btn--sm" onClick={stop(() => onSkip(key))} disabled={disabled}>
                    知道了
                  </button>
                ) : (
                  <>
                    <button type="button" className="btn btn-secondary btn--sm" onClick={stop(() => onSkip(key))} disabled={disabled}>
                      略過
                    </button>
                    <button type="button" className="btn btn-primary btn--sm" onClick={stop(() => onApply(key))} disabled={disabled}>
                      {isFormat ? "全部套用" : "套用"}
                    </button>
                  </>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** 卡片上的按鈕不要觸發卡片本身的點選。 */
function stop(fn: () => void) {
  return (e: React.MouseEvent) => {
    e.stopPropagation();
    fn();
  };
}

/** 格式卡的說明：有哪幾種問題（原因是 proofread.ts 的 formatIssues 寫的）。 */
function formatSummary(issues: ProofreadIssue[]): string {
  const spacing = issues.some((i) => i.reason.includes("空一格"));
  const punctuation = issues.some((i) => i.reason.includes("全形"));
  return [spacing && "中文跟英文、數字之間要空一格", punctuation && "中文句子要用全形標點"].filter(Boolean).join("；") + "。";
}
