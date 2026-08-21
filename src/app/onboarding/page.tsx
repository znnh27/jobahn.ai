import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { listUploadedResumes } from "./actions";
import { UploadForm } from "./upload-form";

export default async function OnboardingPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const resumes = await listUploadedResumes();

  return (
    <div className="page">
      <div className="page-container">
        <div className="page-header">
          <div className="stack-tight">
            <h1 className="heading-page">首次設定：上傳履歷</h1>
            <p className="text-muted">
              把你手上所有版本的履歷都丟進來，之後會解析成經歷資料庫，寫任何職缺的履歷都會參考這裡的內容。
            </p>
          </div>
          <Link href="/" className="link-muted">
            回首頁
          </Link>
        </div>

        <UploadForm resumes={resumes} />
      </div>
    </div>
  );
}
