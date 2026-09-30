import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AppNav, getDisplayName } from "../../AppNav";
import { AddExperienceChoice } from "../../AddExperienceChoice";
import { loadExperienceEntries } from "../loadEntries";
import Link from "next/link";
import { ArrowLeftIcon } from "../../icons";
import { BlobScene } from "../../BlobScene";

// 經歷資料庫的「新增經歷」：跟首次登入同一套版面（滿版色塊、中間大 logo、同一個分頁卡片），
// 只是分頁換成「新增履歷來源」跟「跟 AI 聊，新增經歷」；左上角多一個回經歷資料庫的連結。
export default async function AddExperiencePage(props: PageProps<"/experience/add">) {
  const { lang } = await props.searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const entries = await loadExperienceEntries(supabase, user.id);
  const language = lang === "en" ? "en" : "zh";

  return (
    <div className="page page--with-nav page--blobs">
      <AppNav active="experience" userName={getDisplayName(user)} />
      <BlobScene className="blob-scene--home" />
      <div className="page-container page-container--home">
        {/* 從經歷資料庫過來的，左上角可以回去（首次登入那頁沒有這個）。 */}
        <Link href="/experience" className="page-back-link">
          <ArrowLeftIcon />
          回經歷資料庫
        </Link>
        <div className="home-hero">
          <div className="home-hero-greeting">
            {/* eslint-disable-next-line @next/next/no-img-element -- 純裝飾性的靜態吉祥物圖，不需要 next/image 的最佳化 */}
            <img src="/logo-mascot.png" alt="jobahn 吉祥物：提著公事包的石斑魚" className="home-hero-mascot" />
            <h1 className="home-hero-greeting-title home-hero-greeting-title--sm">新增經歷</h1>
            <p className="home-hero-greeting-sub">上傳另一份履歷，或跟 AI 聊一段還沒寫下來的經歷。</p>
          </div>
        </div>

        <AddExperienceChoice mode="experience" entries={entries} language={language} />
      </div>
    </div>
  );
}
