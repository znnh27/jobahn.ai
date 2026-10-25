"use client";

import { useEffect, useRef } from "react";
import { cleanBulletText } from "./bulletEditing";

/**
 * Cmd/Ctrl + Z：上一步；Shift + Cmd/Ctrl + Z：下一步（履歷畫布、經歷資料庫共用）。
 * 正在某一格打字、內容跟存好的不一樣時，交給瀏覽器原本的復原（一個字一個字退）；
 * 那一格跟存好的一樣（或沒有在打字）才是整頁的上一步／下一步。
 * 可編輯的格子用 data-committed 標出目前存好的內容；沒有標的輸入框（例如對話框）一律交給瀏覽器。
 */
export function useUndoShortcuts(handlers: { undo: () => void; redo: () => void; enabled: boolean }) {
  const ref = useRef(handlers);
  useEffect(() => {
    ref.current = handlers;
  });

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.key.toLowerCase() !== "z") return;
      const { undo, redo, enabled } = ref.current;
      if (!enabled) return;
      const el = document.activeElement as HTMLElement | null;
      const typing = el && (el.isContentEditable || el.tagName === "INPUT" || el.tagName === "TEXTAREA");
      if (typing) {
        const committed = el.dataset.committed;
        const now = el.isContentEditable ? (el.textContent ?? "") : (el as HTMLInputElement).value;
        if (committed === undefined || cleanBulletText(now) !== committed.trim()) return;
      }
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
