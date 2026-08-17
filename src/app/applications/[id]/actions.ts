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

type ResumeMap = Record<string, GeneratedResume["resume"]>;
type ChecklistMap = Record<string, GeneratedResume["jd_match_checklist"]>;
type GapsMap = Record<string, string[]>;

/**
 * 生成履歷時 AI 可能會對公司名稱做輕微改寫（例如省略括號內的說明文字），
 * 所以比對時先試完全一致，再退而求其次比對「公司名稱的核心詞」是否互相包含，
 * 避免因為文字沒有一字不差而漏掉本來該回寫的經歷。
 */
function findMatchingEntry<T extends { org_name: string }>(
  candidates: T[],
  targetOrg: string,
): T | undefined {
  const normalize = (s: string) => s.trim().toLowerCase();
  const coreName = (s: string) => normalize(s.split("(")[0]).trim();

  const exact = candidates.find((c) => normalize(c.org_name) === normalize(targetOrg));
  if (exact) return exact;

  const targetCore = coreName(targetOrg);
  return candidates.find((c) => {
    const candidateCore = coreName(c.org_name);
    return (
      candidateCore.length > 0 &&
      (candidateCore.includes(targetCore) || targetCore.includes(candidateCore))
    );
  });
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
  const dateTag = new Date().toISOString().slice(0, 10);
  const labelBase =
    (application.company_name || "app") + "-" + (application.job_title || applicationId.slice(0, 8));

  for (const lang of languages) {
    const resume = draft[lang];
    if (!resume) continue;

    const sourceTag = `${labelBase}_${lang}_final(${dateTag})`;
    const sections = [...(resume.work_experience ?? []), ...(resume.leadership ?? [])];

    // 一次抓這個語言底下所有經歷，本地比對，比較能容忍 AI 生成時對公司名稱的些微改寫
    const { data: candidates } = await supabase
      .from("experience_entries")
      .select("id, org_name, description_variants")
      .eq("user_id", user.id)
      .eq("language", lang);

    for (const section of sections) {
      const existing = findMatchingEntry(candidates ?? [], section.org);
      if (!existing) continue; // 找不到對應經歷就跳過，不亂造新的一筆

      const updatedVariants = [
        ...((existing.description_variants as unknown[]) ?? []),
        { source: sourceTag, bullets: section.bullets },
      ];

      await supabase
        .from("experience_entries")
        .update({ description_variants: updatedVariants, updated_at: new Date().toISOString() })
        .eq("id", existing.id);
    }
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
