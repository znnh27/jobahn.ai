"use client";

import { useEffect, useRef, useState } from "react";
import { MessageComposer } from "@/app/experience/MessageComposer";
import { TypingIndicator } from "@/app/experience/TypingIndicator";

// 「跟 AI 聊」面板（履歷頁、求職信頁共用）：浮在右下角、不擋住內容，邊聊邊看左邊的變化。
// 這裡只管對話畫面；實際怎麼改、改完換到哪裡，由 onSend 決定（見 ResumeChatPanel、CoverLetterChatPanel）。

export interface ChatTurn {
  role: "user" | "assistant";
  text: string;
}

export function AiChatPanel({
  ariaLabel,
  intro,
  examples,
  placeholder,
  onSend,
  onClose,
}: {
  ariaLabel: string;
  /** 面板一打開的第一句話。 */
  intro: string;
  /** 點了直接送出的範例要求。 */
  examples: string[];
  placeholder: string;
  /** 送出一句要求：成功回傳 AI 的一句說明，失敗回傳 error。history 是這句之前的對話。 */
  onSend: (instruction: string, history: ChatTurn[]) => Promise<{ error?: string; reply?: string }>;
  onClose: () => void;
}) {
  const [turns, setTurns] = useState<ChatTurn[]>([]);
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
    const result = await onSend(instruction, history);
    setPending(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    setTurns((t) => [...t, { role: "assistant", text: result.reply ?? "改好了。" }]);
  }

  return (
    <div className="resume-chat" role="dialog" aria-label={ariaLabel}>
      <div className="resume-chat-header">
        <h2 className="heading-card">跟 AI 聊</h2>
        <button type="button" className="elicitation-close" onClick={onClose} aria-label="關閉">
          ×
        </button>
      </div>

      <div className="resume-chat-messages" ref={listRef}>
        <div className="elicitation-bubble elicitation-bubble--assistant">
          <p>{intro}</p>
          <div className="resume-chat-examples">
            {examples.map((ex) => (
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
        placeholder={placeholder}
      />
    </div>
  );
}
