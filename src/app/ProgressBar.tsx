"use client";

import { useEffect, useState } from "react";
import { WalkingMascot } from "./WalkingMascot";

// 讓使用者等的地方都要有進度，分兩種：
// 1. 真實進度：工作可以拆批（例如檢查經歷資料庫一次檢查一批），呼叫端自己算好 value 傳進來。
// 2. 估算進度：一次 AI 呼叫不會回報自己跑到哪，用 useEstimatedProgress 依平常要花的時間往前推，
//    越接近 95% 越慢，真的完成才跳到 100%。
// 1–2 秒就結束的等待（儲存、驗證）不用這個，用按鈕裡的 <Spinner />。

export function ProgressBar({ value, label }: { value: number; label?: string }) {
  const pct = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <div className="progress progress--mascot" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={label}>
      <div className="progress-head">
        {label && <span className="progress-label">{label}</span>}
        <span className="progress-pct">{pct}%</span>
      </div>
      <div className="progress-track">
        <div className="progress-fill" style={{ width: `${pct}%` }} />
        {/* 吉祥物站在進度條尾端，跟著進度往右走；到 100% 就停下來。 */}
        <span className="progress-mascot" style={{ left: `${pct}%` }}>
          <WalkingMascot size={52} walking={pct < 100} />
        </span>
      </div>
    </div>
  );
}

/**
 * active 從 false 變 true 開始計時，依 expectedMs 往 95% 推（指數趨近，超過預估時間也不會停在原地）；
 * active 變回 false 時跳到 100%，停留一下再回傳 null（呼叫端看到 null 就把進度條收起來）。
 */
export function useEstimatedProgress(active: boolean, expectedMs: number): number | null {
  const [value, setValue] = useState<number | null>(null);
  // active 一變就在 render 當下重設（React 建議的「props 改變時調整 state」寫法）：
  // 開始 → 歸零；結束 → 跳到 100%。
  const [prevActive, setPrevActive] = useState(active);
  if (active !== prevActive) {
    setPrevActive(active);
    setValue(active ? 0 : value === null ? null : 100);
  }

  useEffect(() => {
    if (!active) return;
    const start = Date.now();
    const timer = setInterval(() => {
      const t = (Date.now() - start) / expectedMs;
      // t = 1（到了預估時間）時約 78%，之後越來越慢，最多到 95%。
      setValue(Math.min(95, 95 * (1 - Math.exp(-1.5 * t))));
    }, 200);
    return () => clearInterval(timer);
  }, [active, expectedMs]);

  // 跳到 100% 之後停一下再收起來，讓使用者看到「完成了」。
  const finished = !active && value === 100;
  useEffect(() => {
    if (!finished) return;
    const timer = setTimeout(() => setValue(null), 600);
    return () => clearTimeout(timer);
  }, [finished]);

  return value;
}

/** 短等待（1–2 秒）用的小轉圈，放在按鈕文字前面。 */
export function Spinner() {
  return <span className="spinner" aria-hidden="true" />;
}

/** 一掛上去就開始跑的估算進度條，給「每個項目各自在等」的情況用（例如每個上傳中的檔案）。
 * 項目完成時整個元件會被換掉，所以不需要自己處理 100%。 */
export function EstimatedProgress({ expectedMs, label }: { expectedMs: number; label?: string }) {
  const value = useEstimatedProgress(true, expectedMs);
  return <ProgressBar value={value ?? 0} label={label} />;
}
