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
    <div className="card stack">
      <div className="stack-tight">
        <h2 className="heading-card">Anthropic API Key（選填）</h2>
        <p className="text-muted">
          預設所有生成功能都會用共用的額度，不需要你另外做任何設定就能直接用。
          如果你想改用自己的 Claude API Key（例如想自己掌控費用），可以在下面綁定，
          綁定後你的生成會改用你自己的額度計費。
        </p>
      </div>

      {last4 && (
        <div className="key-status-row">
          <span className="text-body">已綁定 · 末 4 碼 {last4}</span>
          <form action={removeAnthropicKeyAction}>
            <button type="submit" className="btn-link">
              移除，改回共用額度
            </button>
          </form>
        </div>
      )}

      <form action={formAction} className="form-stack">
        <div className="field">
          <label htmlFor="anthropicKey" className="label">
            {last4 ? "更新 API Key" : "輸入 API Key"}
          </label>
          <input
            id="anthropicKey"
            name="anthropicKey"
            type="password"
            placeholder="sk-ant-..."
            required
            className="input"
          />
          <p className="hint-text">
            去{" "}
            <a
              href="https://console.anthropic.com/settings/keys"
              target="_blank"
              rel="noreferrer"
              className="link"
            >
              Anthropic Console
            </a>{" "}
            申請，建議先在那邊設定月費用上限
          </p>
        </div>

        {state.error && <p className="text-error">{state.error}</p>}
        {state.success && <p className="text-success">已儲存</p>}

        <button type="submit" disabled={isPending} className="btn btn-primary">
          {isPending ? "驗證中…" : "儲存"}
        </button>
      </form>
    </div>
  );
}
