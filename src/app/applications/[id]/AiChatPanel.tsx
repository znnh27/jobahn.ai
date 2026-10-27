"use client";

import { useEffect, useRef, useState } from "react";
import { MessageComposer } from "@/app/experience/MessageComposer";
import { TypingIndicator } from "@/app/experience/TypingIndicator";

// 「跟 AI 聊」面板（履歷頁、求職信頁共用）：浮在右下角、不擋住內容，邊聊邊看左邊的變化。
// 這裡只管對話畫面；實際怎麼改、改完換到哪裡，由 onSend 決定（見 ResumeChatPanel、CoverLetterChatPanel）。
// AI 的回覆照 CHAT_REPLY_FORMAT（lib/ai/chatReply.ts）分段：「- 」開頭顯示成圓點條列、空一行是分段（2026-10-27 Z 要求，整段擠在一起很難讀）。

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
            {t.role === "assistant" ? <ChatText text={t.text} /> : <p className="chat-user-text">{t.text}</p>}
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

type ChatBlock = { type: "p"; text: string } | { type: "ul"; items: string[] };

const BULLET = /^(?:[-•・*]|\d+[.、)])\s*/;

/**
 * AI 回覆拆成段落跟條列：「- 」「1.」開頭的行是條列，其他每行一段，空行只是分隔。
 * AI 沒照格式、整段沒換行又超過兩句時，照句號拆成一句一段，不要一整塊字。
 */
function toBlocks(text: string): ChatBlock[] {
  const trimmed = text.replace(/\r\n/g, "\n").trim();
  if (!trimmed.includes("\n")) {
    const sentences = trimmed
      .split(/(?<=[。！？!?])/)
      .map((t) => t.trim())
      .filter(Boolean);
    return (sentences.length > 2 ? sentences : [trimmed]).map((t) => ({ type: "p", text: t }));
  }
  const blocks: ChatBlock[] = [];
  for (const raw of trimmed.split("\n")) {
    const line = raw.trim();
    const last = blocks[blocks.length - 1];
    if (!line) continue;
    if (BULLET.test(line)) {
      const item = line.replace(BULLET, "");
      if (last?.type === "ul") last.items.push(item);
      else blocks.push({ type: "ul", items: [item] });
    } else {
      blocks.push({ type: "p", text: line });
    }
  }
  return blocks;
}

function ChatText({ text }: { text: string }) {
  return (
    <div className="chat-text">
      {toBlocks(text).map((b, i) =>
        b.type === "p" ? (
          <p key={i}>{b.text}</p>
        ) : (
          <ul key={i}>
            {b.items.map((item, j) => (
              <li key={j}>{item}</li>
            ))}
          </ul>
        ),
      )}
    </div>
  );
}
