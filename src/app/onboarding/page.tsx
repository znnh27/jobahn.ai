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
    <div className="min-h-screen bg-neutral-50 px-6 py-10">
      <div className="mx-auto max-w-2xl space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-neutral-900">首次設定：上傳履歷</h1>
            <p className="mt-1 text-sm text-neutral-500">
              把你手上所有版本的履歷都丟進來，之後會解析成經歷資料庫，寫任何職缺的履歷都會參考這裡的內容。
            </p>
          </div>
          <Link href="/" className="text-sm text-neutral-500 hover:underline">
            回首頁
          </Link>
        </div>

        <UploadForm resumes={resumes} />
      </div>
    </div>
  );
}
