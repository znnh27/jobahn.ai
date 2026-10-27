import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ExperienceEntry } from "./ExperienceCanvas";

/** 讀使用者的經歷資料庫，轉成畫布用的格式（經歷資料庫頁、新增經歷頁共用）。 */
export async function loadExperienceEntries(supabase: SupabaseClient, userId: string): Promise<ExperienceEntry[]> {
  // 順序：使用者用 ↑↓ 調過的照 sort_order，沒調過的照建立時間排在後面（migration 0012）。
  // 還沒跑 migration（沒有 sort_order 欄位）就只照建立時間，頁面照常能用。
  const columns = "id, language, entry_type, org_name, location, role_variants, period_variants, achievements, created_at";
  const ordered = await supabase
    .from("experience_entries")
    .select(`${columns}, sort_order`)
    .eq("user_id", userId)
    .order("sort_order", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: true });
  const { data } = ordered.error
    ? await supabase.from("experience_entries").select(columns).eq("user_id", userId).order("created_at", { ascending: true })
    : ordered;

  return ((data ?? []) as EntryRow[]).map((row) => ({
    id: row.id,
    language: row.language,
    entryType: row.entry_type,
    orgName: row.org_name,
    location: row.location,
    roleVariants: row.role_variants ?? [],
    periodVariants: row.period_variants ?? [],
    achievements: row.achievements ?? [],
    createdAt: row.created_at,
    sortOrder: row.sort_order,
  }));
}

interface EntryRow {
  id: string;
  language: string;
  entry_type: string;
  org_name: string;
  location: string | null;
  role_variants: ExperienceEntry["roleVariants"] | null;
  period_variants: ExperienceEntry["periodVariants"] | null;
  achievements: ExperienceEntry["achievements"] | null;
  created_at: string;
  /** 沒跑 migration 0012 時沒有這個欄位。 */
  sort_order?: number | null;
}
