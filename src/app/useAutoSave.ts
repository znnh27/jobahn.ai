"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type SaveState = "saved" | "pending" | "saving" | "error";

/**
 * 履歷頁、求職信頁的自動存檔（2026-10-28 Z 同意拿掉「儲存」按鈕）：
 * - schedule：自己打字改的，停 1 秒沒再動才存。
 * - saveNow：AI 改完、上一步、套用校稿這種一次換掉的，馬上存。
 * - flush：定案這種要讀資料庫的動作前先呼叫，等還沒存的存完。
 * 一個接一個存（不會舊的蓋掉新的）。離開頁面（站內切換）時把還沒存的存掉；關分頁時還有沒存完的就跳瀏覽器的提醒。
 */
export function useAutoSave<V>(save: (value: V) => Promise<{ error?: string }>, delay = 1000) {
  const [state, setState] = useState<SaveState>("saved");
  const [error, setError] = useState<string | null>(null);
  const saveRef = useRef(save);
  const pending = useRef<V | null>(null);
  const latest = useRef<V | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const queue = useRef<Promise<boolean>>(Promise.resolve(true));
  const inFlight = useRef(0);

  useEffect(() => {
    saveRef.current = save;
  }, [save]);

  const run = useCallback((value: V) => {
    latest.current = value;
    inFlight.current += 1;
    setState("saving");
    queue.current = queue.current.then(async () => {
      const result = await saveRef.current(value).catch((e: unknown) => ({
        error: e instanceof Error ? e.message : "儲存失敗",
      }));
      inFlight.current -= 1;
      // 存的期間又有新的修改，就等最後那次的結果再更新狀態。
      if (latest.current === value && pending.current === null) {
        setState(result.error ? "error" : "saved");
        setError(result.error ?? null);
      }
      return !result.error;
    });
    return queue.current;
  }, []);

  const flush = useCallback((): Promise<boolean> => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    const value = pending.current;
    pending.current = null;
    return value !== null ? run(value) : queue.current;
  }, [run]);

  const schedule = useCallback(
    (value: V) => {
      pending.current = value;
      setState("pending");
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void flush(), delay);
    },
    [delay, flush],
  );

  const saveNow = useCallback(
    (value: V) => {
      pending.current = value;
      return flush();
    },
    [flush],
  );

  /** 存失敗時按「重試」：再存一次最後那份。 */
  const retry = useCallback(() => (latest.current !== null ? run(latest.current) : queue.current), [run]);

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (pending.current !== null || inFlight.current > 0) e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => {
      window.removeEventListener("beforeunload", warn);
      void flush();
    };
  }, [flush]);

  return { state, error, schedule, saveNow, flush, retry };
}
