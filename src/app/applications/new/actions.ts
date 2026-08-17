"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

type CreateResult = { error?: string };

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
