"use client";

import { useState, useTransition } from "react";
import { Spinner } from "@/app/ProgressBar";
import { TrashIcon } from "@/app/icons";
import type { MemoryNote } from "@/lib/ai/userMemory";
import { addMemoryAction, deleteMemoryAction } from "./actions";

/** 帳號設定「AI 記住的事」：看、刪、直接新增。在「跟 AI 聊」裡說「記住…」也會出現在這裡。 */
export function MemoryForm({ notes }: { notes: MemoryNote[] }) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function add() {
    setError(null);
    startTransition(async () => {
      const result = await addMemoryAction(text);
      if (result.error) setError(result.error);
      else setText("");
    });
  }

  function remove(id: string) {
    setError(null);
    startTransition(async () => {
      const result = await deleteMemoryAction(id);
      if (result.error) setError(result.error);
    });
  }

  return (
    <div className="card stack">
      <div className="stack-tight">
        <h2 className="heading-card">AI 記住的事</h2>
        <p className="text-muted">寫履歷、求職信、經歷時，AI 每次都會照這裡做。</p>
      </div>

      {notes.length > 0 ? (
        <ul className="memory-list">
          {notes.map((n) => (
            <li key={n.id} className="memory-item">
              <span className="memory-item-text">{n.text}</span>
              <button
                type="button"
                className="icon-btn memory-item-delete"
                aria-label={`刪除：${n.text}`}
                title="刪除"
                onClick={() => remove(n.id)}
                disabled={pending}
              >
                <TrashIcon />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted">還沒有。在「跟 AI 聊」裡說「記住…」，或在下面直接新增。</p>
      )}

      <div className="memory-add">
        <input
          className="input"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.nativeEvent.isComposing && text.trim()) add();
          }}
          placeholder="例如：我已經從 A 公司離職，不能寫成目前在 A 公司任職"
          aria-label="要 AI 記住的事"
        />
        <button type="button" className="btn btn-primary" onClick={add} disabled={pending || !text.trim()}>
          {pending && <Spinner />}
          新增
        </button>
      </div>
      {error && <p className="text-error">{error}</p>}
    </div>
  );
}
