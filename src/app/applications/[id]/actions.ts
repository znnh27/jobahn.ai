"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import {
  generateResumeForApplication,
  rescoreResumeForApplication,
  type GeneratedResume,
} from "@/lib/resumes/generateResume";
import {
  generateCoverLetterForApplication,
  recheckJdMatchWithCoverLetter,
} from "@/lib/resumes/generateCoverLetter";
import { mergeContentIntoExperienceDb } from "@/lib/experience/mergeIntoExperienceDb";

type ResumeMap = Record<string, GeneratedResume["resume"]>;
type ChecklistMap = Record<string, GeneratedResume["jd_match_checklist"]>;
type GapsMap = Record<string, string[]>;

/** 把定案履歷某個語言版本的工作經歷/領導經驗序列化成一般履歷文字，餵給跟解析履歷檔案
 * 同一套的 mergeContentIntoExperienceDb，這樣「定案後寫回資料庫」跟「上傳履歷解析」共用
 * 同一套比對/分組邏輯，不用各自維護一套本地字串比對規則。 */
function serializeResumeSections(resume: GeneratedResume["resume"]): string {
  const sections = [...(resume.work_experience ?? []), ...(resume.leadership ?? [])];
  return sections
    .map((s) => {
      const bullets = s.bullets.map((b) => `- ${b}`).join("\n");
      return `${s.org}\t${s.location ?? ""}\n${s.role}\t${s.period}\n${bullets}`;
    })
    .join("\n\n");
}

type GenerateResult = {
  error?: string;
  success?: boolean;
  data?: {
    resume_draft: ResumeMap;
    jd_match_checklist: ChecklistMap;
    ats_score: number | null;
    ats_gaps: GapsMap;
  };
};

async function fetchApplicationScoringFields(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  applicationId: string,
) {
  const { data } = await supabase
    .from("applications")
    .select("resume_draft, jd_match_checklist, ats_score, ats_gaps")
    .eq("id", applicationId)
    .eq("user_id", userId)
    .single();
  return data;
}

export async function generateAction(applicationId: string): Promise<GenerateResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "請先登入" };

  try {
    await generateResumeForApplication(supabase, user.id, applicationId);
    const fresh = await fetchApplicationScoringFields(supabase, user.id, applicationId);
    revalidatePath(`/applications/${applicationId}`);
    revalidatePath("/");
    if (!fresh) return { error: "生成後讀取結果失敗" };
    return {
      success: true,
      data: {
        resume_draft: fresh.resume_draft,
        jd_match_checklist: fresh.jd_match_checklist,
        ats_score: fresh.ats_score,
        ats_gaps: fresh.ats_gaps,
      },
    };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "生成失敗" };
  }
}

export async function rescoreAction(
  applicationId: string,
  editedResumeDraft: ResumeMap,
): Promise<GenerateResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "請先登入" };

  try {
    await rescoreResumeForApplication(supabase, user.id, applicationId, editedResumeDraft);
    const fresh = await fetchApplicationScoringFields(supabase, user.id, applicationId);
    revalidatePath(`/applications/${applicationId}`);
    revalidatePath("/");
    if (!fresh) return { error: "評分後讀取結果失敗" };
    return {
      success: true,
      data: {
        resume_draft: fresh.resume_draft,
        jd_match_checklist: fresh.jd_match_checklist,
        ats_score: fresh.ats_score,
        ats_gaps: fresh.ats_gaps,
      },
    };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "重新評分失敗" };
  }
}

export async function saveDraftAction(
  applicationId: string,
  editedResumeDraft: ResumeMap,
): Promise<{ error?: string; success?: boolean }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "請先登入" };

  const { error } = await supabase
    .from("applications")
    .update({ resume_draft: editedResumeDraft })
    .eq("id", applicationId)
    .eq("user_id", user.id);

  if (error) return { error: error.message };
  revalidatePath(`/applications/${applicationId}`);
  return { success: true };
}

export async function finalizeResumeAction(
  applicationId: string,
): Promise<{ error?: string; success?: boolean }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "請先登入" };

  const { data: application, error: fetchError } = await supabase
    .from("applications")
    .select("resume_draft, resume_language, company_name, job_title")
    .eq("id", applicationId)
    .eq("user_id", user.id)
    .single();

  if (fetchError || !application || !application.resume_draft) {
    return { error: "還沒有可以定案的履歷內容" };
  }

  const draft = application.resume_draft as ResumeMap;
  const languages: string[] = application.resume_language ?? [];
  const labelBase =
    (application.company_name || "app") + "-" + (application.job_title || applicationId.slice(0, 8));

  for (const lang of languages) {
    const resume = draft[lang];
    if (!resume) continue;

    const rawContent = serializeResumeSections(resume);
    if (!rawContent.trim()) continue;

    await mergeContentIntoExperienceDb({
      supabase,
      userId: user.id,
      sourceLabel: `${labelBase}_${lang}_定案`,
      rawContent,
    });
  }

  const { error: updateError } = await supabase
    .from("applications")
    .update({
      resume_snapshot: draft,
      status: "resume_finalized",
      resume_finalized_at: new Date().toISOString(),
    })
    .eq("id", applicationId)
    .eq("user_id", user.id);

  if (updateError) return { error: updateError.message };

  revalidatePath(`/applications/${applicationId}`);
  revalidatePath("/");
  return { success: true };
}

type CoverLetterGenerateResult = {
  error?: string;
  success?: boolean;
  data?: { cover_letter_draft: Record<string, string> };
};

export async function generateCoverLetterAction(
  applicationId: string,
  languages: string[],
): Promise<CoverLetterGenerateResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "請先登入" };

  const { error: langError } = await supabase
    .from("applications")
    .update({ cover_letter_language: languages })
    .eq("id", applicationId)
    .eq("user_id", user.id);
  if (langError) return { error: langError.message };

  try {
    await generateCoverLetterForApplication(supabase, user.id, applicationId);
    const { data } = await supabase
      .from("applications")
      .select("cover_letter_draft")
      .eq("id", applicationId)
      .eq("user_id", user.id)
      .single();
    revalidatePath(`/applications/${applicationId}`);
    return { success: true, data: { cover_letter_draft: data?.cover_letter_draft ?? {} } };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "生成求職信失敗" };
  }
}

type RecheckResult = {
  error?: string;
  success?: boolean;
  data?: { jd_match_checklist: ChecklistMap };
};

export async function recheckWithCoverLetterAction(
  applicationId: string,
  editedCoverLetterDraft: Record<string, string>,
): Promise<RecheckResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "請先登入" };

  try {
    const checklist = await recheckJdMatchWithCoverLetter(
      supabase,
      user.id,
      applicationId,
      editedCoverLetterDraft,
    );
    revalidatePath(`/applications/${applicationId}`);
    return { success: true, data: { jd_match_checklist: checklist } };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "重新比對失敗" };
  }
}

export async function saveCoverLetterDraftAction(
  applicationId: string,
  editedCoverLetterDraft: Record<string, string>,
): Promise<{ error?: string; success?: boolean }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "請先登入" };

  const { error } = await supabase
    .from("applications")
    .update({ cover_letter_draft: editedCoverLetterDraft })
    .eq("id", applicationId)
    .eq("user_id", user.id);

  if (error) return { error: error.message };
  return { success: true };
}

export async function finalizeCoverLetterAction(
  applicationId: string,
  editedCoverLetterDraft: Record<string, string>,
): Promise<{ error?: string; success?: boolean }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "請先登入" };

  const { error } = await supabase
    .from("applications")
    .update({
      cover_letter_draft: editedCoverLetterDraft,
      cover_letter_snapshot: JSON.stringify(editedCoverLetterDraft),
      status: "completed",
      completed_at: new Date().toISOString(),
    })
    .eq("id", applicationId)
    .eq("user_id", user.id);

  if (error) return { error: error.message };

  revalidatePath(`/applications/${applicationId}`);
  revalidatePath("/");
  return { success: true };
}
