"use server";

import { normalizeJobUrl } from "@/lib/jobs/jobUrl";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { tidyJobPage } from "@/lib/jobs/tidyJobPage";

type CreateResult = { error?: string };

type TidyResult = { text?: string; companyName?: string | null; jobTitle?: string | null; notJob?: boolean; error?: string };

/** 「AI 整理內容」：從整頁貼上的內容挑出職缺本身、公司名稱、職稱。 */
export async function tidyPastedJdAction(text: string): Promise<TidyResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "請先登入" };
  if (!text.trim()) return { error: "請先貼上職缺內容" };

  const result = await tidyJobPage(text, { supabase, userId: user.id });
  if (result === "blocked") return { notJob: true };
  if (!result) return { error: "AI 整理失敗，內容沒有變動，可以再按一次" };
  return result;
}

export async function createApplication(formData: FormData): Promise<CreateResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "請先登入" };
  }

  const companyName = (formData.get("companyName") as string)?.trim();
  const jobTitle = (formData.get("jobTitle") as string)?.trim();
  const jobDescription = (formData.get("jobDescription") as string)?.trim();
  const languages = formData.getAll("language") as string[];
  // 職缺連結也存起來，首頁表格可以直接點回職缺頁。
  const jobUrl = normalizeJobUrl(formData.get("jobUrl") as string | null);

  // 公司名稱、職稱跟 JD 一樣必填（2026-10-27 Z 要求）：求職信、檔名、首頁表格都要用。
  if (!companyName) return { error: "請填公司名稱" };
  if (!jobTitle) return { error: "請填職稱" };
  if (!jobDescription) {
    return { error: "請貼上 JD 內容" };
  }
  if (languages.length === 0) {
    return { error: "請至少選一個語言版本" };
  }

  const { data, error } = await supabase
    .from("applications")
    .insert({
      user_id: user.id,
      company_name: companyName,
      job_title: jobTitle,
      job_description: jobDescription,
      job_source_url: jobUrl,
      resume_language: languages,
      status: "draft",
    })
    .select("id")
    .single();

  if (error || !data) {
    return { error: `建立應徵紀錄失敗：${error?.message ?? "unknown"}` };
  }

  // 帶 ?generate=1：到履歷頁就直接開始生成，不用再按一次「生成履歷」（2026-10-27 Z 回報）。
  redirect(`/applications/${data.id}?generate=1`);
}
