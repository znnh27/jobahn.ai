"use client";

import type { ReactNode } from "react";
import { locate, type ProofreadIssue } from "@/lib/resumes/proofreadTypes";
import { inlineDiff, type DiffPart } from "@/lib/text/inlineDiff";

// 校稿時，被點選的那張建議卡直接標在畫布（履歷、求職信）上，像 Word 的追蹤修訂：
// 要刪的字畫刪除線、要加的字綠底；沒辦法直接改的（只提醒）整段黃底。
// 每個標記都有 data-proofread-mark，頁面用它把畫布捲到第一個標記。

/** text 裡把這幾項建議標出來；原文找不到的項目（使用者已經改過）就不標。 */
export function markedText(text: string, issues: ProofreadIssue[]): ReactNode[] {
  const ranges = issues
    .map((issue) => {
      const found = locate(text, issue);
      if (!found) return null;
      const start = text.indexOf(found.quote);
      return { start, end: start + found.quote.length, ...found };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null)
    .sort((a, b) => a.start - b.start);

  const out: ReactNode[] = [];
  let pos = 0;
  ranges.forEach((r, i) => {
    // 兩項重疊（同一句被兩項建議指到）就只標前面那項。
    if (r.start < pos) return;
    if (r.start > pos) out.push(text.slice(pos, r.start));
    if (r.replacement === null) {
      out.push(
        <mark key={i} className="proofread-mark-flag" data-proofread-mark>
          {r.quote}
        </mark>,
      );
    } else if (r.replacement === "") {
      out.push(
        <del key={i} className="proofread-mark-del" data-proofread-mark>
          {r.quote}
        </del>,
      );
    } else {
      out.push(
        <span key={i} className="proofread-mark" data-proofread-mark>
          {tidyDiff(inlineDiff(r.quote, r.replacement)).map((part, j) =>
            part.type === "del" ? (
              <del key={j} className="proofread-mark-del">
                {part.text}
              </del>
            ) : part.type === "ins" ? (
              <ins key={j} className="proofread-mark-ins">
                {part.text}
              </ins>
            ) : (
              part.text
            ),
          )}
        </span>,
      );
    }
    pos = r.end;
  });
  if (pos < text.length) out.push(text.slice(pos));
  return out;
}

/**
 * inlineDiff 把英文單字、數字連同後面的空白當一段，補空格（「練8名」→「練 8 名」）會變成刪掉「8」、加上「 8 」，
 * 畫面上看起來像同一個字被劃掉又加回來。相鄰的一刪一加改成逐字比對，只標真的多出來或少掉的字。
 */
function tidyDiff(parts: DiffPart[]): DiffPart[] {
  const out: DiffPart[] = [];
  for (let i = 0; i < parts.length; i++) {
    const a = parts[i];
    const b = parts[i + 1];
    if (b && a.type !== "same" && b.type !== "same" && a.type !== b.type) {
      const [del, ins] = a.type === "del" ? [a.text, b.text] : [b.text, a.text];
      out.push(...charDiff(del, ins));
      i++;
      continue;
    }
    out.push(a);
  }
  return out;
}

/** 一個字一個字比（最長共同子序列），只用在相鄰的一刪一加，都很短。 */
function charDiff(before: string, after: string): DiffPart[] {
  const a = Array.from(before);
  const b = Array.from(after);
  const lcs = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const parts: DiffPart[] = [];
  const push = (type: DiffPart["type"], text: string) => {
    const last = parts[parts.length - 1];
    if (last && last.type === type) last.text += text;
    else parts.push({ type, text });
  };
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      push("same", a[i++]);
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      push("del", a[i++]);
    } else {
      push("ins", b[j++]);
    }
  }
  while (i < a.length) push("del", a[i++]);
  while (j < b.length) push("ins", b[j++]);
  return parts;
}

/** 畫布捲到第一個標記（點了卡片、或處理完一張換下一張時）。 */
export function scrollToFirstMark() {
  requestAnimationFrame(() => {
    document.querySelector("[data-proofread-mark]")?.scrollIntoView({ behavior: "smooth", block: "center" });
  });
}
