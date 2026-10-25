"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import {
  SECTION_LABEL_KEYS,
  SECTION_LABEL_MAX_LENGTH,
  readCustomSectionLabels,
  type CustomSectionLabels,
  type SectionLabelKey,
} from "@/lib/resumes/sectionLabels";

/** 改某個區塊的標題（全帳號共用）。改成空白就恢復預設。回傳這個語言改過的全部標題。 */
export async function saveSectionLabelAction(
  language: "zh" | "en",
  key: SectionLabelKey,
  value: string,
): Promise<{ error?: string; labels?: CustomSectionLabels }> {
  if (language !== "zh" && language !== "en") return { error: "不支援的語言" };
  if (!SECTION_LABEL_KEYS.includes(key)) return { error: "不認得的標題" };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "請先登入" };

  const { data: profile } = await supabase.from("profile_data").select("data").eq("user_id", user.id).maybeSingle();
  const data = (profile?.data ?? {}) as Record<string, unknown>;
  const all = readCustomSectionLabels(data);
  const next: CustomSectionLabels = { ...all[language] };
  const text = value.replace(/\s+/g, " ").trim().slice(0, SECTION_LABEL_MAX_LENGTH);
  if (text) next[key] = text;
  else delete next[key];

  const { error } = await supabase
    .from("profile_data")
    .upsert({ user_id: user.id, data: { ...data, section_labels: { ...all, [language]: next } } });
  if (error) return { error: error.message };

  revalidatePath("/experience");
  revalidatePath("/applications/[id]", "page");
  return { labels: next };
}
