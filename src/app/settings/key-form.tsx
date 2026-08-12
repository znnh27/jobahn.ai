"use client";

import { useActionState } from "react";
import { setAnthropicKey, removeAnthropicKeyAction } from "./actions";

type ActionResult = { error?: string; success?: boolean };

const initialState: ActionResult = {};

export function AnthropicKeyForm({ last4 }: { last4: string | null }) {
  const [state, formAction, isPending] = useActionState(
    async (_prev: ActionResult, formData: FormData) => setAnthropicKey(formData),
    initialState,
  );

  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-6">
      <h2 className="text-base font-semibold text-neutral-900">Anthropic API Key</h2>
      <p className="mt-1 text-sm text-neutral-500">
        這個工具採 BYOK 模式：所有履歷生成、JD 比對、ATS 評分都會用你自己的 Claude
        API Key，費用算在你自己的 Anthropic 帳號，不會用到其他人的額度。
      </p>

      {last4 ? (
        <div className="mt-4 flex items-center justify-between rounded-md bg-neutral-50 px-3 py-2 text-sm">
          <span className="text-neutral-700">已綁定 · 末 4 碼 {last4}</span>
          <form action={removeAnthropicKeyAction}>
            <button
              type="submit"
              className="text-sm font-medium text-red-600 hover:underline"
            >
              移除
            </button>
          </form>
        </div>
      ) : (
        <div className="mt-4 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
          尚未綁定，綁定前無法使用任何生成功能
        </div>
      )}

      <form action={formAction} className="mt-4 space-y-3">
        <div>
          <label htmlFor="anthropicKey" className="block text-sm font-medium text-neutral-700">
            {last4 ? "更新 API Key" : "輸入 API Key"}
          </label>
          <input
            id="anthropicKey"
            name="anthropicKey"
            type="password"
            placeholder="sk-ant-..."
            required
            className="mt-1 block w-full rounded-md border border-neutral-300 px-3 py-2 text-sm shadow-sm focus:border-neutral-500 focus:outline-none"
          />
          <p className="mt-1 text-xs text-neutral-400">
            去{" "}
            <a
              href="https://console.anthropic.com/settings/keys"
              target="_blank"
              rel="noreferrer"
              className="underline"
            >
              Anthropic Console
            </a>{" "}
            申請，建議先在那邊設定月費用上限
          </p>
        </div>

        {state.error && (
          <p className="text-sm text-red-600">{state.error}</p>
        )}
        {state.success && (
          <p className="text-sm text-green-600">已儲存</p>
        )}

        <button
          type="submit"
          disabled={isPending}
          className="rounded-md bg-neutral-900 px-3 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
        >
          {isPending ? "驗證中…" : "儲存"}
        </button>
      </form>
    </div>
  );
}
