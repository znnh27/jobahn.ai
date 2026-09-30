"use client";

import { useEffect, useRef } from "react";

// 滿版裝飾色塊。游標移動時，每顆色塊在自己的小範圍內跟著往同一個方向移（最多幾十 px），
// 移動量依 CSS 裡每顆的 --blob-depth 不同，看起來有前後層次。
// 只把游標位置寫成兩個 CSS 變數（--mx、--my，-1 到 1），位移跟緩動都交給 CSS；
// 一個畫面最多更新一次，不會每次 mousemove 都觸發 React 重新 render。
// 手機（沒有游標）跟開了「減少動態效果」的人就維持不動。

export function BlobScene({ count = 7, className = "" }: { count?: number; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const scene = ref.current;
    if (!scene || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let frame = 0;
    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        scene.style.setProperty("--mx", ((e.clientX / window.innerWidth) * 2 - 1).toFixed(3));
        scene.style.setProperty("--my", ((e.clientY / window.innerHeight) * 2 - 1).toFixed(3));
      });
    };
    window.addEventListener("pointermove", onMove);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", onMove);
    };
  }, []);

  return (
    <div ref={ref} className={`blob-scene ${className}`} aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className={`blob blob--${i + 1}`} />
      ))}
    </div>
  );
}
