"use client";

import { useActionState } from "react";
import { parseResumes } from "./actions";

type ParseResult = { error?: string; success?: boolean; entriesWritten?: number; conflicts?: string[] };

const initialState: ParseResult = {};

export function ParseButton() {
  const [state, formAction, isPending] = useActionState(
    async () => parseResumes(),
    initialState,
  );

  return (
    <div className="card">
      <h2 className="heading-card">開始解析</h2>
      <p className="text-muted mt-2">
        把上面所有履歷內容解析成經歷資料庫，這步會呼叫 AI，只有第一次設定需要做一次。
      </p>

      <form action={formAction} className="mt-3">
        <button type="submit" disabled={isPending} className="btn btn-primary">
          {isPending ? "解析中，請稍候…" : "開始解析"}
        </button>
      </form>

      {state.error && <p className="text-error mt-3">{state.error}</p>}
      {state.success && (
        <div className="stack-tight mt-3">
          <p className="text-success">解析完成，寫入 {state.entriesWritten} 段經歷。</p>
          {state.conflicts && state.conflicts.length > 0 && (
            <div className="alert alert-warning">
              <p className="alert-title">有幾個地方版本間有出入，之後可以再調整：</p>
              <ul className="list-disc">
                {state.conflicts.map((c, i) => (
                  <li key={i}>{c}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
