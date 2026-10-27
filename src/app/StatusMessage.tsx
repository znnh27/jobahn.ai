"use client";

import { AlertIcon, CheckCircleIcon, CloseIcon } from "@/app/icons";

/**
 * 履歷頁、求職信頁動作完成後的訊息：放在工具列正下方、紙張上方，整列顯示、字多就換行，不會自動消失，要按 × 關；
 * 下一個動作的訊息會直接取代（2026-10-27 Z 要求）。
 * 樣式用中性色：一般訊息白底灰框、灰色勾勾，不用綠色（會跟右欄「已寫到」的綠色勾勾撞在一起）；
 * 「錯誤：」開頭或講到失敗的才用紅色。
 */
export function StatusMessage({ message, onClose }: { message: string | null; onClose: () => void }) {
  if (!message) return null;
  const isError = message.startsWith("錯誤") || message.includes("失敗");
  return (
    <div className={`status-message ${isError ? "status-message--error" : ""}`} role={isError ? "alert" : "status"}>
      <span className="status-message-icon">{isError ? <AlertIcon /> : <CheckCircleIcon />}</span>
      <p className="status-message-text">{message}</p>
      <button type="button" className="icon-btn" aria-label="關掉這則訊息" onClick={onClose}>
        <CloseIcon />
      </button>
    </div>
  );
}
