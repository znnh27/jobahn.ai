"use client";

import { useMemo } from "react";
import { inlineDiff } from "@/lib/text/inlineDiff";

// 信紙上的求職信編輯區：還是一般的 textarea（直接打字），後面墊一層一模一樣排版的文字，
// 把「補充進求職信」新加的字標成綠底（跟經歷資料庫剛改完的那一條同一個顏色）。
// 新加的字＝跟 base（第一次補充前的信）比對多出來的字，所以使用者繼續打字，綠底也會跟著文字走。
// textarea 的背景是透明的，看起來就像字底下有螢光筆。

export function LetterEditor({
  label,
  value,
  base,
  readOnly,
  onChange,
}: {
  label: string;
  value: string;
  /** 第一次補充前的信；沒有就不標。 */
  base: string | null;
  readOnly: boolean;
  onChange: (text: string) => void;
}) {
  const parts = useMemo(() => (base === null || base === value ? null : inlineDiff(base, value)), [base, value]);

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
