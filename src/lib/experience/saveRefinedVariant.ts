import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

// 把一條改好的寫法存進經歷資料庫既有的 achievement。
// 經歷資料庫的「AI 潤飾」跟履歷頁的「跟 AI 聊」補數字（2026-10-30 Z 要求任何入口補的數字都存得回去）共用這一支。
// 同時做兩件連動的事：(1) 同一個 achievement 底下如果還有其他寫法一樣缺這次補上的
// 具體事實，自動幫忙補上；(2) 把這個新事實同步到另一個語言對應的經歷裡。

export async function saveRefinedVariant(params: {
  supabase: SupabaseClient;
  userId: string;
  entryId: string;
  achievementId: string;
  text: string;
  angleLabel: string;
  source: string;
  /** replace：取代 variantIndex 那條；append：另存成同一件事的新寫法。 */
  mode: "replace" | "append";
  variantIndex?: number;
  /** 照規則檢查過：存成已通過（reviewedText 等於目前文字），下次檢查不會再標它。 */
  reviewed: boolean;
}): Promise<{ error?: string; variantIndex?: number; syncedToOtherLanguage?: boolean }> {
  const { supabase, userId } = params;
  const { data: row, error: readError } = await supabase
    .from("experience_entries")
    .select("org_name, location, language, entry_type, role_variants, period_variants, achievements")
    .eq("id", params.entryId)
    .eq("user_id", userId)
    .maybeSingle();
  if (readError || !row) return { error: "找不到這個經歷區塊" };

  const achievements = Array.isArray(row.achievements) ? row.achievements : [];
  const target = achievements.find((a: { id: string }) => a.id === params.achievementId);
  if (!target) return { error: "找不到這個成就" };

  const refined = {
    text: params.text,
    angleLabel: params.angleLabel,
    source: params.source,
    ...(params.reviewed ? { reviewedText: params.text } : {}),
  };
  let newVariantIndex: number;
  if (params.mode === "replace" && params.variantIndex !== undefined && target.variants[params.variantIndex]) {
    // 取代原本那條：原本的流水帳不留在資料庫，不然下次檢查又會被標出同樣的問題。
    const { reviewedText: _old, ...previous } = target.variants[params.variantIndex]; // eslint-disable-line @typescript-eslint/no-unused-vars
    target.variants[params.variantIndex] = { ...previous, ...refined };
    newVariantIndex = params.variantIndex;
  } else {
    target.variants.push(refined);
    newVariantIndex = target.variants.length - 1;
  }

  // 同一個 achievement 底下的其他寫法，缺同一個新事實的話自動補上
  const siblings = target.variants
    .map((v: { text: string; angleLabel: string }, i: number) => ({ index: i, text: v.text, angleLabel: v.angleLabel }))
    .filter((_: unknown, i: number) => i !== newVariantIndex);
  if (siblings.length > 0) {
    const { syncSiblingVariants } = await import("@/lib/experience/syncSiblingVariants");
    const updates = await syncSiblingVariants({ supabase, userId, refinedText: params.text, siblings });
    for (const u of updates) {
      if (target.variants[u.index]) target.variants[u.index].text = u.text;
    }
  }

  const { error } = await supabase
    .from("experience_entries")
    .update({ achievements, updated_at: new Date().toISOString() })
    .eq("id", params.entryId)
    .eq("user_id", userId);
  if (error) return { error: error.message };

  const { syncToOtherLanguage } = await import("@/lib/experience/syncLanguage");
  const synced = await syncToOtherLanguage({
    supabase,
    userId,
    sourceLanguage: row.language,
    orgName: row.org_name,
    role: row.role_variants?.[0]?.role ?? "",
    location: row.location ?? null,
    period: row.period_variants?.[0]?.period ?? "",
    entryType: row.entry_type,
    text: params.text,
    sourceLabel: `${params.source}（雙語同步）`,
  });

  return { variantIndex: newVariantIndex, syncedToOtherLanguage: synced !== null };
}

/** 經歷資料庫還沒有這件事：在這段經歷底下新增一個 achievement，再同步到另一個語言。 */
export async function addAchievement(params: {
  supabase: SupabaseClient;
  userId: string;
  entryId: string;
  text: string;
  angleLabel: string;
  source: string;
  reviewed: boolean;
}): Promise<{ error?: string; syncedToOtherLanguage?: boolean }> {
  const { supabase, userId } = params;
  const { data: row, error: readError } = await supabase
    .from("experience_entries")
    .select("org_name, location, language, entry_type, role_variants, period_variants, achievements")
    .eq("id", params.entryId)
    .eq("user_id", userId)
    .maybeSingle();
  if (readError || !row) return { error: "找不到這個經歷區塊" };

  const achievements = Array.isArray(row.achievements) ? row.achievements : [];
  achievements.push({
    id: `ach_${Math.random().toString(36).slice(2, 10)}`,
    variants: [
      {
        text: params.text,
        angleLabel: params.angleLabel,
        source: params.source,
        ...(params.reviewed ? { reviewedText: params.text } : {}),
      },
    ],
  });
  const { error } = await supabase
    .from("experience_entries")
    .update({ achievements, updated_at: new Date().toISOString() })
    .eq("id", params.entryId)
    .eq("user_id", userId);
  if (error) return { error: error.message };

  const { syncToOtherLanguage } = await import("@/lib/experience/syncLanguage");
  const synced = await syncToOtherLanguage({
    supabase,
    userId,
    sourceLanguage: row.language,
    orgName: row.org_name,
    role: row.role_variants?.[0]?.role ?? "",
    location: row.location ?? null,
    period: row.period_variants?.[0]?.period ?? "",
    entryType: row.entry_type,
    text: params.text,
    sourceLabel: `${params.source}（雙語同步）`,
  });
  return { syncedToOtherLanguage: synced !== null };
}
