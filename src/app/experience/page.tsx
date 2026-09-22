import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { BrandMark } from "../BrandMark";
import type { ExperienceEntry } from "./ExperienceCanvas";
import { ExperiencePageClient } from "./ExperiencePageClient";

export default async function ExperiencePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data } = await supabase
    .from("experience_entries")
    .select("id, language, entry_type, org_name, location, role_variants, period_variants, achievements")
    .eq("user_id", user.id)
    .order("created_at", { ascending: true });

  const entries: ExperienceEntry[] = (data ?? []).map((row) => ({
    id: row.id,
    language: row.language,
    entryType: row.entry_type,
    orgName: row.org_name,
    location: row.location,
    roleVariants: row.role_variants ?? [],
    periodVariants: row.period_variants ?? [],
    achievements: row.achievements ?? [],
  }));

  return (
    <div className="page">
      <div className="page-container page-container--canvas">
        <BrandMark />
        <div className="page-header">
          <div className="stack-tight">
            <h1 className="heading-page">經歷資料庫</h1>
            <p className="text-muted">
              這裡是你所有經歷的完整內容，寫任何履歷都會從這裡挑選。可以直接點擊編輯，也可以隨時補傳新的履歷來源。
            </p>
          </div>
          <Link href="/" className="link-muted">
            回首頁
          </Link>
        </div>

        <ExperiencePageClient entries={entries} />
      </div>
    </div>
  );
}
