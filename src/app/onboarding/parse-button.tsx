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
    <div className="rounded-lg border border-neutral-200 bg-white p-6">
      <h2 className="text-sm font-semibold text-neutral-900">開始解析</h2>
      <p className="mt-1 text-sm text-neutral-500">
        把上面所有履歷內容解析成經歷資料庫，這步會呼叫 AI，只有第一次設定需要做一次。
      </p>

      <form action={formAction} className="mt-3">
        <button
          type="submit"
          disabled={isPending}
          className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
        >
          {isPending ? "解析中，請稍候…" : "開始解析"}
        </button>
      </form>

      {state.error && <p className="mt-3 text-sm text-red-600">{state.error}</p>}
      {state.success && (
        <div className="mt-3 space-y-2 text-sm">
          <p className="text-green-600">
            解析完成，寫入 {state.entriesWritten} 段經歷。
          </p>
          {state.conflicts && state.conflicts.length > 0 && (
            <div className="rounded-md bg-amber-50 p-3 text-amber-800">
              <p className="font-medium">有幾個地方版本間有出入，之後可以再調整：</p>
              <ul className="mt-1 list-disc space-y-1 pl-5">
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
