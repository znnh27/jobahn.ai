import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AppNav, getDisplayName } from "../AppNav";
import { loadExperienceEntries } from "./loadEntries";
import { ExperiencePageClient } from "./ExperiencePageClient";
import { readLayoutDefaults } from "@/lib/resumes/typography";
import { readBackground } from "@/lib/resumes/background";
import { readRuleTags } from "@/lib/experience/bulletRules";

export default async function ExperiencePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const entries = await loadExperienceEntries(supabase, user.id);
  const { data: profile } = await supabase.from("profile_data").select("data").eq("user_id", user.id).maybeSingle();

  return (
    <div className="page page--with-nav">
      <AppNav active="experience" userName={getDisplayName(user)} />
      <div className="page-container page-container--canvas">
        <div className="page-header">
          <div className="stack-tight">
            <h1 className="heading-page">經歷資料庫</h1>
            <p className="text-muted">
              這裡是你所有經歷的完整內容，寫任何履歷都會從這裡挑選。可以直接點擊編輯，也可以隨時補傳新的履歷來源。
            </p>
          </div>
        </div>

        <ExperiencePageClient
          entries={entries}
          background={readBackground(profile?.data)}
          initialMutedRules={readRuleTags(profile?.data?.muted_rules)}
          initialLayouts={readLayoutDefaults(profile?.data)} />
      </div>
    </div>
  );
}
