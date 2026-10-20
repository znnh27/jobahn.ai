"use client";

import { useEffect, useRef, useState } from "react";
import type { GeneratedResume, ResumeChatTurn } from "@/lib/resumes/generateResume";
import { MessageComposer } from "@/app/experience/MessageComposer";
import { TypingIndicator } from "@/app/experience/TypingIndicator";
import { reviseResumeAction } from "./actions";

type Resume = GeneratedResume["resume"];

// 履歷頁的「跟 AI 聊」：浮在右下角、不擋住履歷，邊聊邊看畫布上的變化。
// 每次 AI 改完就整份換進草稿（可以按「復原」退回），按「儲存」才會存起來。

const EXAMPLES = ["最新那份工作多加兩條", "摘要改短一點", "把跟 JD 無關的那條拿掉"];

export function ResumeChatPanel({
  applicationId,
  language,
  resume,
  onApply,
  onClose,
}: {
  applicationId: string;
  language: string;
  resume: Resume;
  onApply: (next: Resume) => void;
  onClose: () => void;
}) {
  const [turns, setTurns] = useState<ResumeChatTurn[]>([]);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [turns, pending, error]);

  async function send(text: string) {
    const instruction = text.trim();
    if (!instruction || pending) return;
    const history = turns;
    setTurns([...history, { role: "user", text: instruction }]);
    setDraft("");
    setError(null);
    setPending(true);
    const result = await reviseResumeAction(applicationId, language, resume, history, instruction);
    setPending(false);
    if (result.error || !result.resume) {
      setError(result.error ?? "修改失敗，請再試一次");
      return;
    }
    onApply(result.resume);
    setTurns((t) => [...t, { role: "assistant", text: result.reply ?? "改好了。" }]);
  }

  return (
    <div className="resume-chat" role="dialog" aria-label="跟 AI 聊，修改履歷">
      <div className="resume-chat-header">
        <h2 className="heading-card">跟 AI 聊</h2>
        <button type="button" className="elicitation-close" onClick={onClose} aria-label="關閉">
          ×
        </button>
      </div>

      <div className="resume-chat-messages" ref={listRef}>
        <div className="elicitation-bubble elicitation-bubble--assistant">
          <p>想怎麼改這份履歷？我只會用經歷資料庫裡的事實，改完可以按「復原」退回。</p>
          <div className="resume-chat-examples">
            {EXAMPLES.map((ex) => (
              <button key={ex} type="button" className="elicitation-option-btn" onClick={() => send(ex)} disabled={pending}>
                {ex}
              </button>
            ))}
          </div>
        </div>
        {turns.map((t, i) => (
          <div key={i} className={`elicitation-bubble elicitation-bubble--${t.role === "user" ? "user" : "assistant"}`}>
            <p>{t.text}</p>
          </div>
        ))}
        {pending && <TypingIndicator />}
        {error && (
          <div className="elicitation-bubble elicitation-bubble--assistant">
            <p className="text-error">{error}</p>
          </div>
        )}
      </div>

      <MessageComposer
        value={draft}
        onChange={setDraft}
        onSend={() => send(draft)}
        disabled={pending}
        placeholder="例如：Northwind 那段多加兩條跟數據分析有關的"
      />
    </div>
  );
}
