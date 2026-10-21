import type { SupabaseClient } from "@supabase/supabase-js";

// JD 裡的工作條件（出差、外派、輪班…）使用者能不能配合。這不是經歷，是意願，
// 所以可以寫進履歷（摘要最後一句），但一定要使用者自己確認過，AI 不能幫他假設。
// 答案存在 profile_data.data.work_conditions，之後別的職缺遇到同一件事就不用再問：
// 可以配合的，生成履歷時直接寫進摘要；無法配合的，評分時標成已回答、不再出現按鈕。

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

/** 給 AI 看的清單。 */
export function formatWorkConditions(answers: WorkConditionAnswer[], willing: boolean): string {
  const list = answers.filter((a) => a.willing === willing).map((a) => `- ${a.condition}`);
  return list.length > 0 ? list.join("\n") : "（無）";
}
