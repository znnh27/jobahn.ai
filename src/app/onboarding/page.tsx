import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AppNav, getDisplayName } from "../AppNav";
import { AddExperienceChoice } from "../AddExperienceChoice";
import { BlobScene } from "../BlobScene";

export default async function OnboardingPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // 這頁只透過首頁的判斷式導向過來（沒有經歷資料庫時），首頁跟其他任何地方都不會
  // 再出現連回這裡的按鈕/連結，所以不需要在這裡自己再擋一次「已經有資料就導走」——
  // 這裡加自我阻擋反而會有個副作用：上傳成功那一刻 Server Action 觸發的自動刷新，
  // 會讓這個頁面重新判斷「現在已經有資料了」而立刻把使用者導回首頁，導致完成訊息跟
  // CTA 按鈕根本來不及顯示就被導走。

  // 版面跟首頁一致：色塊滿版鋪在整頁後面，中間是大 logo，兩張入口卡片疊在色塊上面。
  return (
    <div className="page page--with-nav page--blobs">
      <AppNav minimal userName={getDisplayName(user)} />
      <BlobScene className="blob-scene--home" />
      <div className="page-container page-container--home">
        <div className="home-hero">
          <div className="home-hero-greeting">
            {/* eslint-disable-next-line @next/next/no-img-element -- 純裝飾性的靜態吉祥物圖，不需要 next/image 的最佳化 */}
            <img src="/logo-mascot.png" alt="jobahn 吉祥物：提著公事包的石斑魚" className="home-hero-mascot" />
            <h1 className="home-hero-greeting-title home-hero-greeting-title--xs">首次登入：建立你的經歷資料庫</h1>
            <p className="home-hero-greeting-sub">
              有現成的履歷就直接上傳；沒有也沒關係，說說你做過的事，AI 會陪你寫出第一份履歷。
            </p>
          </div>
        </div>

        <AddExperienceChoice mode="onboarding" />
      </div>
    </div>
  );
}
