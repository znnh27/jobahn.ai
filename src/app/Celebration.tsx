"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";

// 首頁勾「面試 get」「Offer get!」時的慶祝畫面：吉祥物敲鑼打鼓，幾秒後自動消失，點一下或按 Esc 也能關。
// - 面試 get：小慶祝，敲鼓＋彩帶。
// - Offer get!：大慶祝，敲鑼又打鼓＋滿版彩帶。
// 吉祥物沿用進度條那隻（public/mascot/ 五張分開的圖），前手一直往下敲；鑼跟鼓是這裡用 SVG 畫的，
// 顏色、米白描邊照吉祥物的風格，之後有正式素材再換掉。
// 有開「減少動態效果」的人只看到靜態的恭喜畫面（CSS 會把動畫關掉）。

export type CelebrationKind = "interview" | "offer";

const DURATION_MS: Record<CelebrationKind, number> = { interview: 2600, offer: 3800 };
const CONFETTI_COUNT: Record<CelebrationKind, number> = { interview: 28, offer: 64 };
const CONFETTI_COLORS = ["#2f5d85", "#f2b33d", "#e9e2d0", "#7fa7c9", "#e06c4f"];
const LAYERS = ["hand-back", "leg-back", "leg-front", "hand-front", "body"] as const;

export function Celebration({ kind, onClose }: { kind: CelebrationKind; onClose: () => void }) {
  useEffect(() => {
    const timer = setTimeout(onClose, DURATION_MS[kind]);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("keydown", onKey);
    };
  }, [kind, onClose]);

  const big = kind === "offer";

  return createPortal(
    <div
      className={`celebration celebration--${kind}`}
      role="status"
      aria-live="polite"
      aria-label={big ? "恭喜拿到 Offer！" : "恭喜拿到面試！"}
      onClick={onClose}
    >
      <div className="celebration-confetti" aria-hidden="true">
        {Array.from({ length: CONFETTI_COUNT[kind] }, (_, i) => (
          <span
            key={i}
            className="celebration-confetti-piece"
            style={{
              // 用編號算出固定的位置、顏色、延遲，每次畫面都一樣，不用亂數（伺服器跟瀏覽器才不會對不上）。
              left: `${(i * 37) % 100}%`,
              background: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
              animationDelay: `${((i * 7) % 10) * 0.08}s`,
              animationDuration: `${1.6 + ((i * 13) % 10) * 0.12}s`,
              transform: `rotate(${(i * 47) % 360}deg)`,
            }}
          />
        ))}
      </div>

      <div className="celebration-stage" aria-hidden="true">
        {big && <Gong />}
        <span className="celebration-mascot">
          {LAYERS.map((layer) => (
            // eslint-disable-next-line @next/next/no-img-element -- 純裝飾性的靜態圖層，不需要 next/image 的最佳化
            <img key={layer} src={`/mascot/${layer}.png`} alt="" className={`celebration-mascot-part celebration-mascot-part--${layer}`} />
          ))}
        </span>
        <Drum />
        <ImpactLines className="celebration-impact celebration-impact--drum" />
        {big && <ImpactLines className="celebration-impact celebration-impact--gong" />}
      </div>

      <p className="celebration-title">{big ? "Offer get!" : "面試 get！"}</p>
      <p className="celebration-subtitle">{big ? "恭喜！這一路辛苦了" : "準備好，去讓他們記住你"}</p>
    </div>,
    document.body,
  );
}

/** 被敲到的瞬間往外放射的幾條短線（漫畫的衝擊線），跟著敲擊的節奏閃一下。 */
function ImpactLines({ className }: { className: string }) {
  return (
    <svg className={className} viewBox="0 0 100 100" aria-hidden="true">
      <g stroke="#f6f0e3" strokeWidth="6" strokeLinecap="round">
        <path d="M50 8 L50 24" />
        <path d="M80 18 L70 31" />
        <path d="M94 48 L78 50" />
        <path d="M20 18 L30 31" />
        <path d="M6 48 L22 50" />
      </g>
    </svg>
  );
}

/** 鼓：側面看的圓筒，芥末黃鼓身、米白鼓皮、深藍繩子，外圈米白描邊跟吉祥物一致。 */
function Drum() {
  return (
    <svg className="celebration-drum" viewBox="0 0 160 150" aria-hidden="true">
      <g stroke="#f6f0e3" strokeWidth="10" strokeLinejoin="round" fill="none">
        <path d="M20 40 L20 110 A60 18 0 0 0 140 110 L140 40" />
        <ellipse cx="80" cy="40" rx="60" ry="18" />
      </g>
      <path d="M20 40 L20 110 A60 18 0 0 0 140 110 L140 40 Z" fill="#f2b33d" />
      <path d="M20 104 A60 18 0 0 0 140 104 L140 110 A60 18 0 0 1 20 110 Z" fill="#2f5d85" />
      <path d="M20 46 A60 18 0 0 0 140 46 L140 52 A60 18 0 0 1 20 52 Z" fill="#2f5d85" />
      <path
        d="M28 58 L44 100 L60 62 L80 104 L100 62 L116 100 L132 58"
        fill="none"
        stroke="#2f5d85"
        strokeWidth="4"
        strokeLinejoin="round"
      />
      <ellipse className="celebration-drum-head" cx="80" cy="40" rx="60" ry="18" fill="#efe8d6" stroke="#2f5d85" strokeWidth="3" />
    </svg>
  );
}

/** 鑼：深藍木架吊著一面芥末黃的銅鑼。 */
function Gong() {
  return (
    <svg className="celebration-gong" viewBox="0 0 180 200" aria-hidden="true">
      <g stroke="#f6f0e3" strokeWidth="10" strokeLinecap="round" fill="none">
        <path d="M20 190 L20 20 L160 20 L160 190" />
        <circle cx="90" cy="100" r="58" />
      </g>
      <path d="M20 190 L20 20 L160 20 L160 190" fill="none" stroke="#2f5d85" strokeWidth="10" strokeLinecap="round" />
      <path d="M60 20 L66 46 M120 20 L114 46" stroke="#2f5d85" strokeWidth="3" />
      <g className="celebration-gong-disc">
        <circle cx="90" cy="100" r="58" fill="#f2b33d" stroke="#2f5d85" strokeWidth="3" />
        <circle cx="90" cy="100" r="40" fill="none" stroke="#d99a26" strokeWidth="3" />
        <circle cx="90" cy="100" r="16" fill="#d99a26" />
        <path d="M64 78 A34 34 0 0 1 86 66" fill="none" stroke="#fbe3a6" strokeWidth="5" strokeLinecap="round" />
      </g>
    </svg>
  );
}
