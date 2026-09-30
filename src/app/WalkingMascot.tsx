// 會走路的吉祥物：用在進度條尾端（跟著進度往右走）。首頁大 logo 用靜態圖（logo-mascot.png），不動。
//
// 五張透明 PNG 疊在一起，畫的順序＝前後圖層：後手、後腳、前腳、前手都在身體底下，身體在最上面
// （手腳從袖口、衣襬底下伸出來，擺動時接縫才不會露出來）。
// 素材放在 public/mascot/，五張是同一張 490×490 畫布、已經對齊好位置
// （原始素材的手、腳跟身體沒對齊，已經用程式重新縮放、擺好）。
// 腳繞髖關節、手繞肩膀前後擺，身體跟著微微上下；同一側的手跟腳方向相反，跟人走路一樣。
// 動畫只用 transform（瀏覽器交給顯示卡處理，幾乎不耗電），有開「減少動態效果」的人會停下來。

const LAYERS = ["hand-back", "leg-back", "leg-front", "hand-front", "body"] as const;

export function WalkingMascot({
  size,
  walking = true,
  className = "",
}: {
  size: number;
  walking?: boolean;
  className?: string;
}) {
  return (
    <span
      className={`walking-mascot walking-mascot--layered ${walking ? "walking-mascot--walking" : ""} ${className}`}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      {LAYERS.map((layer) => (
        // eslint-disable-next-line @next/next/no-img-element -- 純裝飾性的靜態圖層，不需要 next/image 的最佳化
        <img key={layer} src={`/mascot/${layer}.png`} alt="" className={`walking-mascot-part walking-mascot-part--${layer}`} />
      ))}
    </span>
  );
}
