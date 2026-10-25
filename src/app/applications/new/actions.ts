"use server";

import { normalizeJobUrl } from "@/lib/jobs/jobUrl";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { scrapeJobPosting } from "@/lib/jobs/scrapeJobPosting";

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
      company_name: companyName || null,
      job_title: jobTitle || null,
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
