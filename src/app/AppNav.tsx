import Link from "next/link";
import { logout } from "@/app/logout/actions";
import { AppNavMenu } from "./AppNavMenu";
import { BookIcon } from "./icons";

type NavSection = "experience";

// 登入後每一頁最上方的全站導覽列：左邊 logo（= 首頁 = 應徵紀錄），右邊經歷資料庫入口（帶書本圖示的按鈕）跟頭像選單
// （帳號設定、登出）。頭像選單用原生 <details>（AppNavMenu 補上點外面自動關閉）。
// minimal：首次設定（onboarding）還沒有經歷資料庫，主要入口點了也會被導回來，所以不顯示。
export function AppNav({
  active,
  userName,
  minimal = false,
}: {
  active?: NavSection;
  userName: string;
  minimal?: boolean;
}) {
  return (
    <header className="app-nav">
      <Link href="/" className="app-nav-brand">
        {/* eslint-disable-next-line @next/next/no-img-element -- 純裝飾性的靜態小圖示，不需要 next/image 的最佳化 */}
        <img src="/logo-head.png" alt="" className="app-nav-brand-icon" />
        <span className="app-nav-brand-text">jobahn</span>
      </Link>

      {!minimal && (
        <nav className="app-nav-links">
          <Link
            href="/experience"
            className={active === "experience" ? "app-nav-link app-nav-link--active" : "app-nav-link"}
            aria-current={active === "experience" ? "page" : undefined}
          >
            <BookIcon />
            經歷資料庫
          </Link>
        </nav>
      )}

      <AppNavMenu>
        <summary className="app-nav-avatar" aria-label="帳號選單">
          {userName.slice(0, 1).toUpperCase()}
        </summary>
        <div className="app-nav-menu-panel">
          <p className="app-nav-menu-name">{userName}</p>
          <Link href="/settings" className="app-nav-menu-item">
            帳號設定
          </Link>
          <form action={logout}>
            <button type="submit" className="app-nav-menu-item">
              登出
            </button>
          </form>
        </div>
      </AppNavMenu>
    </header>
  );
}

export function getDisplayName(user: { email?: string; user_metadata?: Record<string, unknown> }): string {
  return (user.user_metadata?.display_name as string | undefined) || user.email?.split("@")[0] || "你";
}
