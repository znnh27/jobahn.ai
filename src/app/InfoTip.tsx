"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { InfoIcon } from "./icons";

// 標題或欄位旁的 ⓘ：說明文字平常收起來，滑過（或用鍵盤選到）才出現，手機點一下顯示、點別處收起。
// 全站的提醒、規則說明一律用這個，不要在畫面上攤開一段灰字。
// 提示框掛在 body 上、用 fixed 定位，才不會被側欄卡片之類 overflow 的容器切掉；位置會自動避開畫面邊緣。
// icon 可以換掉 ⓘ：例如 JD 條件清單前面的狀態 icon，滑過顯示「部分符合」這類說明。

const EDGE = 8;
const OFFSET = 6;

export function InfoTip({
  children,
  label = "說明",
  icon,
  className = "",
}: {
  children: ReactNode;
  /** 給螢幕閱讀器的按鈕名稱。 */
  label?: string;
  /** 換掉預設的 ⓘ。 */
  icon?: ReactNode;
  className?: string;
}) {
  const id = useId();
  const btnRef = useRef<HTMLButtonElement>(null);
  const bubbleRef = useRef<HTMLSpanElement>(null);
  const [hover, setHover] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const open = hover || pinned;
  // 每次打開都重新算位置，算好之前先不顯示（避免閃在上次的位置）。
  const show = () => {
    if (!open) setPos(null);
    setHover(true);
  };

  // 打開時算位置：預設在 ⓘ 下方、左邊對齊；超出右邊就往左推，下方放不下就改放上方。
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const btn = btnRef.current?.getBoundingClientRect();
      const bubble = bubbleRef.current;
      if (!btn || !bubble) return;
      const w = bubble.offsetWidth;
      const h = bubble.offsetHeight;
      const left = Math.min(Math.max(EDGE, btn.left - OFFSET), window.innerWidth - w - EDGE);
      const below = btn.bottom + OFFSET;
      const top = below + h > window.innerHeight - EDGE && btn.top - OFFSET - h > EDGE ? btn.top - OFFSET - h : below;
      setPos({ top, left });
    };
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open]);

  // 點一下固定打開（手機）；點別處或按 Esc 收起。
  useEffect(() => {
    if (!pinned) return;
    const onDown = (e: PointerEvent) => {
      if (!btnRef.current?.contains(e.target as Node)) setPinned(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPinned(false);
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [pinned]);

  return (
    <span className={`info-tip ${className}`}>
      <button
        ref={btnRef}
        type="button"
        className={`info-tip-btn ${open ? "info-tip-btn--open" : ""}`}
        aria-label={label}
        aria-describedby={open ? id : undefined}
        onMouseEnter={show}
        onMouseLeave={() => setHover(false)}
        onFocus={show}
        onBlur={() => setHover(false)}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (!open) setPos(null);
          setPinned((p) => !p);
        }}
      >
        {icon ?? <InfoIcon />}
      </button>
      {open &&
        createPortal(
          <span
            ref={bubbleRef}
            id={id}
            role="tooltip"
            className={`info-tip-bubble ${pos ? "info-tip-bubble--shown" : ""}`}
            style={pos ?? { top: 0, left: 0 }}
          >
            {children}
          </span>,
          document.body,
        )}
    </span>
  );
}
