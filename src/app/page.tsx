import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AppNav, getDisplayName } from "./AppNav";
import { ApplicationsTable } from "./ApplicationsTable";
import { PlusIcon } from "./icons";
import { BlobScene } from "./BlobScene";

export default async function HomePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return (
      <div className="page sunny-surface landing-hero">
        <BlobScene count={6} />
        {/* eslint-disable-next-line @next/next/no-img-element -- 純裝飾性的靜態吉祥物圖，不需要 next/image 的最佳化 */}
        <img
          src="/logo-mascot.png"
          alt="jobahn 吉祥物：提著公事包的石斑魚"
          className="landing-mascot"
        />
        <div className="landing-heading-group">
          <h1 className="landing-wordmark">
            jo<span className="landing-wordmark-accent">bahn</span>
          </h1>
          <div className="landing-tagline-group">
            <p className="landing-tagline">
              一個故事，拆成精準對上每份職缺的履歷
            </p>
            <p className="landing-subtagline">
              從 AI 追問經歷、拆解職缺、撰寫履歷、ATS 評分到求職信，一條龍完成。
            </p>
          </div>
        </div>
        <div className="toolbar-inline">
          <Link href="/login" className="btn btn-primary btn--lg">
            登入
          </Link>
          <Link href="/signup" className="btn btn-secondary btn--lg">
            註冊
          </Link>
        </div>
      </div>
    );
  }

  const { count: experienceCount } = await supabase
    .from("experience_entries")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id);

  // 沒有經歷資料庫的帳號一律先導去首次設定，沒有跳過選項。
  if ((experienceCount ?? 0) === 0) {
    redirect("/onboarding");
  }

  const { data: applications } = await supabase
    .from("applications")
    .select(
      "id, company_name, job_title, status, ats_score, resume_language, created_at, job_source_url, submitted_at, replied_at, interview_at, offer_at",
    )
    .order("created_at", { ascending: false });

  const displayName = getDisplayName(user);
  // 首頁的招呼語：吉祥物、標題維持原本的大小跟置中排版，只是不再撐滿 66% 螢幕高度，下面直接接漏斗。
  // greeting、applicationsHeader 當 props 傳進 client 元件，不給 key 的話 React 19 開發模式會誤報缺 key。
  const greeting = (
    <div key="home-hero" className="home-hero">
      <div className="home-hero-greeting">
        {/* eslint-disable-next-line @next/next/no-img-element -- 純裝飾性的靜態吉祥物圖，不需要 next/image 的最佳化 */}
        <img
          src="/logo-mascot.png"
          alt="jobahn 吉祥物：提著公事包的石斑魚"
          className="home-hero-mascot"
        />
        <h1 className="home-hero-greeting-title">
          <span className="home-hero-greeting-hi">Hi!</span> {displayName}
        </h1>
        <p className="home-hero-greeting-sub">和九斑一起打造專業的履歷吧！</p>
      </div>
    </div>
  );
  const applicationsHeader = (
    <div key="applications-header" className="page-header">
      <h2 className="heading-page">應徵紀錄</h2>
      <Link href="/applications/new" className="btn btn-primary">
        <PlusIcon />
        新增應徵
      </Link>
    </div>
  );

  return (
    <div className="page page--with-nav page--blobs">
      <AppNav userName={displayName} />
      <BlobScene className="blob-scene--home" />
      <div className="page-container page-container--home">
        {applications && applications.length > 0 ? (
          // 招呼語＋漏斗一區，下面是「應徵紀錄」標題跟表格；招呼語、標題傳進去（漏斗要跟表格的勾選即時同步）。
          <ApplicationsTable
            applications={applications}
            intro={greeting}
            header={applicationsHeader}
          />
        ) : (
          <>
            {greeting}
            <div className="applications-section">
              {applicationsHeader}
              <div className="table-wrap">
                <p className="table-empty">還沒有應徵紀錄</p>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
