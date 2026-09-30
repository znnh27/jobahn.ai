import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ExperienceEntry } from "./ExperienceCanvas";

/** 讀使用者的經歷資料庫，轉成畫布用的格式（經歷資料庫頁、新增經歷頁共用）。 */
export async function loadExperienceEntries(supabase: SupabaseClient, userId: string): Promise<ExperienceEntry[]> {
  const { data } = await supabase
    .from("experience_entries")
    .select("id, language, entry_type, org_name, location, role_variants, period_variants, achievements")
    .eq("user_id", userId)
    .order("created_at", { ascending: true });

  return (data ?? []).map((row) => ({
    id: row.id,
    language: row.language,
    entryType: row.entry_type,
    orgName: row.org_name,
    location: row.location,
    roleVariants: row.role_variants ?? [],
    periodVariants: row.period_variants ?? [],
    achievements: row.achievements ?? [],
  }));
}
