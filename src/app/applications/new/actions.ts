"use server";

import { normalizeJobUrl } from "@/lib/jobs/jobUrl";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { scrapeJobPosting, tidyPastedJobPage } from "@/lib/jobs/scrapeJobPosting";

type CreateResult = { error?: string };

type ScrapeResult = { text?: string; companyName?: string | null; jobTitle?: string | null; error?: string };

export async function scrapeJobUrlAction(url: string): Promise<ScrapeResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "請先登入" };

  if (!url.trim()) return { error: "請貼上職缺連結" };

  try {
    return await scrapeJobPosting(url.trim(), { supabase, userId: user.id });
  } catch (e) {
    return { error: e instanceof Error ? e.message : "抓取失敗" };
  }
}

/** JD 欄位整頁貼上時：請 AI 挑出職缺本身、公司名稱、職稱。 */
export async function tidyPastedJdAction(text: string): Promise<ScrapeResult & { notJob?: boolean }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "請先登入" };

  const result = await tidyPastedJobPage(text, { supabase, userId: user.id });
  if (result === "blocked") return { notJob: true };
  if (!result) return { error: "AI 整理失敗，先保留你貼上的原文" };
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

  redirect(`/applications/${data.id}`);
}
