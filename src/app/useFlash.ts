"use client";

import { useEffect, useRef, useState } from "react";

/**
 * 按鈕本身的短暫回饋：按「儲存」後按鈕變成「✓ 已儲存」，2 秒後變回來（2026-10-27 Z 要求：
 * 已儲存、已複製這種簡短確認不用進訊息列，要自己按 × 關很麻煩）。
 * flash(key) 標記哪個按鈕剛完成，flashed === key 時顯示完成文字。
 */
export function useFlash(ms = 2000) {
  const [flashed, setFlashed] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  function flash(key: string) {
    if (timer.current) clearTimeout(timer.current);
    setFlashed(key);
    timer.current = setTimeout(() => setFlashed(null), ms);
  }
  return { flashed, flash };
}
