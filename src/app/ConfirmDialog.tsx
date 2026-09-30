"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";
import type { ReactNode } from "react";
import { Spinner } from "./ProgressBar";

// 共用的確認視窗，取代瀏覽器內建的 confirm()。危險動作（刪除）用 danger 樣式的確認鈕，一般確認用 primary。
// 預設聚焦在「取消」，避免按 Enter 誤刪；Esc 也能關閉。
// secondaryAction：兩個都算「確定」的選擇時用（例如沿用求職信／重新生成），排在取消跟確認鈕中間。
// children 可以塞額外的選項（例如求職信要生成哪些語言）；confirmDisabled 在選項不完整時擋住確認鈕。
// 用 portal 掛到 <body>，不然會被外層元素的 z-index 層級困住，蓋不到頂端導覽列。
export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  cancelLabel = "取消",
  tone = "danger",
  pending,
  error,
  children,
  confirmDisabled,
  secondaryAction,
  onConfirm,
  onCancel,
}: {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: "danger" | "primary";
  pending?: boolean;
  error?: string | null;
  children?: ReactNode;
  confirmDisabled?: boolean;
  secondaryAction?: { label: string; onClick: () => void };
  onConfirm: () => void;
  onCancel: () => void;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !pending) onCancel();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pending, onCancel]);

  return createPortal(
    <div className="confirm-overlay" onClick={pending ? undefined : onCancel}>
      <div
        className="confirm-card"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="confirm-title" className="heading-card--lg">
          {title}
        </h2>
        <p className="text-body">{message}</p>
        {children}
        {error && <p className="confirm-error">{error}</p>}
        {/* 三個按鈕一排放不下，改成直的排。 */}
        <div className={secondaryAction ? "btn-wrapper btn-wrapper--stack" : "btn-wrapper"}>
          <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={pending} autoFocus>
            {cancelLabel}
          </button>
          {secondaryAction && (
            <button type="button" className="btn btn-secondary" onClick={secondaryAction.onClick} disabled={pending}>
              {secondaryAction.label}
            </button>
          )}
          <button type="button" className={tone === "danger" ? "btn btn-danger" : "btn btn-primary"} onClick={onConfirm} disabled={pending || confirmDisabled}>
            {pending && <Spinner />}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
