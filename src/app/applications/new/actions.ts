"use server";

import { normalizeJobUrl } from "@/lib/jobs/jobUrl";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { tidyJobPage } from "@/lib/jobs/tidyJobPage";
import { textLanguage } from "@/lib/text/detectLanguage";

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
  // 主版本排第一個，生成時以它為主、另一個照它改寫；履歷頁也先打開它。
  // 中英文都勾時跟 JD 同一個語言的當主版本：以前讓使用者選，但之後的修改兩個語言會互相同步，
  // 主版本只影響第一次生成，不用多問一題（2026-11-04 Z 提出）。
  const primaryLanguage = textLanguage(jobDescription ?? "") ?? "zh";
  const languages = (formData.getAll("language") as string[]).sort((a, b) =>
    a === primaryLanguage ? -1 : b === primaryLanguage ? 1 : 0,
  );
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
