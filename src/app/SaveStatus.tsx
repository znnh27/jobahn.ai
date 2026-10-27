"use client";

import type { SaveState } from "./useAutoSave";

// 工具列左邊（上一步／下一步旁）的存檔狀態（見 useAutoSave）。
// 平常不顯示（反正都會自動存，2026-10-28 Z 要求拿掉「已自動儲存」）；只有存失敗才出現紅字，旁邊可以按「重試」，
// 不然存失敗使用者不會知道，離開就不見了。

export function SaveStatus({ state, error, onRetry }: { state: SaveState; error: string | null; onRetry: () => void }) {
  if (state !== "error") return null;
  return (
    <span className="save-status save-status--error" role="alert" title={error ?? undefined}>
      儲存失敗
      <button type="button" className="btn-link" onClick={onRetry}>
        重試
      </button>
    </span>
  );
}
