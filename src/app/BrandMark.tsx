import Link from "next/link";

// 除了首頁（登入前的滿版品牌頁、登入後的招呼語 hero，logo 已經是主視覺）以外，
// 其他每一頁都在左上角放這個小的 icon + "jobahn" 文字組合，點擊回首頁。
export function BrandMark() {
  return (
    <Link href="/" className="brand-mark">
      {/* eslint-disable-next-line @next/next/no-img-element -- 純裝飾性的靜態小圖示，不需要 next/image 的最佳化 */}
      <img src="/logo-mascot.png" alt="jobahn" className="brand-mark-icon" />
      <span className="brand-mark-text">jobahn</span>
    </Link>
  );
}
