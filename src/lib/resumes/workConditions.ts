import type { SupabaseClient } from "@supabase/supabase-js";

// JD 裡的工作條件（出差、外派、輪班…）使用者能不能配合。這不是經歷，是意願，
// 所以可以寫進履歷（摘要最後一句），但一定要使用者自己確認過，AI 不能幫他假設。
// 答案記在每份應徵的清單上（jd_match_checklist 的 answer），摘要只能寫「這份應徵」按過可以配合的條件。
// 這裡另外把回答記一份在 profile_data.data.work_conditions，目前只是紀錄，不會自動套用到別份職缺：
// 以前會自動沿用，結果 AI 把別份職缺的「可配合出差至日本、新加坡」寫進不相關的履歷（2026-10-23 拿掉）。

export interface WorkConditionAnswer {
  /** JD 裡那個條件的原文（例如「可能需出差至日本、新加坡等地」）。 */
  condition: string;
  willing: boolean;
  answeredAt: string;
}

export function readWorkConditions(profile: unknown): WorkConditionAnswer[] {
  const raw = (profile as { work_conditions?: unknown } | null)?.work_conditions;
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((r) =>
    r && typeof r.condition === "string" && typeof r.willing === "boolean"
      ? [{ condition: r.condition, willing: r.willing, answeredAt: typeof r.answeredAt === "string" ? r.answeredAt : "" }]
      : [],
  );
}

/** 記下使用者對某個條件的回答；同一句條件再回答一次就蓋掉舊的。 */
export async function saveWorkConditionAnswer(params: {
  supabase: SupabaseClient;
  userId: string;
  condition: string;
  willing: boolean;
}): Promise<void> {
  const { supabase, userId, condition, willing } = params;
  const { data: profile } = await supabase.from("profile_data").select("data").eq("user_id", userId).maybeSingle();
  const data = (profile?.data ?? {}) as Record<string, unknown>;
  const key = condition.trim();
  const next = [
    ...readWorkConditions(data).filter((a) => a.condition.trim() !== key),
    { condition: key, willing, answeredAt: new Date().toISOString() },
  ];
  const { error } = await supabase.from("profile_data").upsert({ user_id: userId, data: { ...data, work_conditions: next } });
  if (error) throw new Error(`儲存失敗：${error.message}`);
}
