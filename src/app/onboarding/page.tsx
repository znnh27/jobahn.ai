import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { OnboardingUpload } from "./OnboardingUpload";

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

  return (
    <div className="page">
      <div className="page-container">
        <div className="stack-tight">
          <h1 className="heading-page">建立你的經歷資料庫</h1>
          <p className="text-muted">
            把手上所有版本的履歷都丟進來，上傳完會自動呼叫 AI
            解析、整理成你的經歷資料庫，之後寫任何職缺的履歷都會從這裡挑選內容。
          </p>
        </div>

        <OnboardingUpload />
      </div>
    </div>
  );
}
