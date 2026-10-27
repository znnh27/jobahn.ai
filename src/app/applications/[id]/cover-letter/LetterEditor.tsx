"use client";

import { useMemo } from "react";
import { inlineDiff } from "@/lib/text/inlineDiff";
import type { ProofreadIssue } from "@/lib/resumes/proofreadTypes";
import { markedText } from "../ProofreadMarks";

// 信紙上的求職信編輯區：還是一般的 textarea（直接打字），後面墊一層一模一樣排版的文字，
// 把「補充進求職信」新加的字標成綠底（跟經歷資料庫剛改完的那一條同一個顏色）。
// 新加的字＝跟 base（這次補充前的信）比對多出來的字；使用者一打字，CoverLetter 就把 base 清掉、綠底消失。
// textarea 的背景是透明的，看起來就像字底下有螢光筆。
// 校稿時被點選的建議（marks）：textarea 換成唯讀的一層，直接在信上畫刪除線、綠底（見 ProofreadMarks.tsx），
// 按套用或略過之後換回 textarea。

export function LetterEditor({
  label,
  value,
  base,
  readOnly,
  onChange,
  marks,
}: {
  label: string;
  value: string;
  /** 第一次補充前的信；沒有就不標。 */
  base: string | null;
  readOnly: boolean;
  onChange: (text: string) => void;
  /** 校稿：被點選的那張建議卡，沒有就不標。 */
  marks?: ProofreadIssue[];
}) {
  const parts = useMemo(() => (base === null || base === value ? null : inlineDiff(base, value)), [base, value]);

  if (marks && marks.length > 0)
    return (
      <div className="letter-editor">
        <div className="letter-page-text letter-marked" aria-label={label}>
          {markedText(value, marks)}
        </div>
      </div>
    );

  return (
    <div className="letter-editor">
      {parts && (
        <div className="letter-page-text letter-highlight" aria-hidden="true">
          {parts
            .filter((p) => p.type !== "del")
            .map((p, i) => (p.type === "ins" ? <mark key={i}>{p.text}</mark> : <span key={i}>{p.text}</span>))}
        </div>
      )}
      <textarea
        aria-label={label}
        value={value}
        readOnly={readOnly}
        onChange={(e) => onChange(e.target.value)}
        className="letter-page-text"
      />
    </div>
  );
}
