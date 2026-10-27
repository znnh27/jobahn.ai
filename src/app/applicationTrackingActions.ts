"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { normalizeJobUrl } from "@/lib/jobs/jobUrl";
import type { MilestoneKey } from "@/lib/jobs/milestones";

// 首頁應徵紀錄表格：求職進度（投出去、回覆 get、面試 get、Offer get!）跟職缺連結，點了就存。

const COLUMNS: Record<MilestoneKey, string> = {
  submitted: "submitted_at",
  replied: "replied_at",
  interview: "interview_at",
  offer: "offer_at",
};

/** 勾選／取消勾選某個進度。at 是勾選的時間（ISO 字串），取消勾選傳 null。 */
export async function setMilestoneAction(
  applicationId: string,
  key: MilestoneKey,
  at: string | null,
): Promise<{ error?: string }> {
  const column = COLUMNS[key];
  if (!column) return { error: "不認得的進度" };
  if (at !== null && Number.isNaN(Date.parse(at))) return { error: "日期格式不對" };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "請先登入" };

  const { error } = await supabase
    .from("applications")
    .update({ [column]: at })
    .eq("id", applicationId)
    .eq("user_id", user.id);
  if (error) return { error: error.message };
  revalidatePath("/");
  return {};
}

/** 補上（或改）職缺連結。空白就清掉。 */
export async function setJobUrlAction(applicationId: string, raw: string): Promise<{ error?: string; url?: string | null }> {
  const url = normalizeJobUrl(raw);
  if (raw.trim() && !url) return { error: "這看起來不是網址" };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "請先登入" };

  const { error } = await supabase
    .from("applications")
    .update({ job_source_url: url })
    .eq("id", applicationId)
    .eq("user_id", user.id);
  if (error) return { error: error.message };
  revalidatePath("/");
  return { url };
}
