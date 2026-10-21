"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import {
  answerWorkCondition,
  generateResumeForApplication,
  rescoreResumeForApplication,
  reviseResumeWithChat,
  type GeneratedResume,
  type ResumeChatTurn,
} from "@/lib/resumes/generateResume";
import {
  generateCoverLetterForApplication,
  recheckJdMatchWithCoverLetter,
  type CoverLetterOptions,
} from "@/lib/resumes/generateCoverLetter";
import { mergeContentIntoExperienceDb, removeVariantsFromSource } from "@/lib/experience/mergeIntoExperienceDb";
import { measureResumePdf } from "@/lib/documents/measureResumePdf";
import type { ResumeContact } from "@/lib/resumes/contact";
import { readLayoutSettings, resolveMetrics, type PdfFit, type ResumeLayoutSettings } from "@/lib/resumes/typography";
import { BODY_WIDTH_PT } from "@/lib/documents/ResumePdfDocument";
import { isValidWordLimit } from "@/lib/text/letterLength";

type ResumeMap = Record<string, GeneratedResume["resume"]>;
type ChecklistMap = Record<string, GeneratedResume["jd_match_checklist"]>;
type GapsMap = Record<string, string[]>;

/** 把定案履歷某個語言版本的工作經歷/領導經驗序列化成一般履歷文字，餵給跟解析履歷檔案
 * 同一套的 mergeContentIntoExperienceDb，這樣「定案後寫回資料庫」跟「上傳履歷解析」共用
 * 同一套比對/分組邏輯，不用各自維護一套本地字串比對規則。 */
function allBullets(resume: GeneratedResume["resume"]): string[] {
  return [...(resume.work_experience ?? []), ...(resume.leadership ?? [])].flatMap((s) => s.bullets);
}

/** 只留下「上一次定案沒有的」bullet；整段都沒新東西的經歷就拿掉。 */
function onlyNewBullets(
  resume: GeneratedResume["resume"],
  before: GeneratedResume["resume"],
): GeneratedResume["resume"] {
  const old = new Set(allBullets(before));
  const keep = (sections: GeneratedResume["resume"]["work_experience"]) =>
    sections
      .map((s) => ({ ...s, bullets: s.bullets.filter((b) => !old.has(b)) }))
      .filter((s) => s.bullets.length > 0);
  return { ...resume, work_experience: keep(resume.work_experience ?? []), leadership: keep(resume.leadership ?? []) };
}

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
    revalidatePath(`/applications/${applicationId}/cover-letter`);
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

/** 履歷頁「跟 AI 聊」：照使用者的一句話改這個語言版本，回傳改好的履歷（不存檔，畫布按儲存才存）。 */
export async function reviseResumeAction(
  applicationId: string,
  language: string,
  resume: GeneratedResume["resume"],
  history: ResumeChatTurn[],
  instruction: string,
): Promise<{ error?: string; reply?: string; resume?: GeneratedResume["resume"] }> {
  if (!instruction.trim()) return { error: "請輸入想怎麼改" };
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "請先登入" };

  try {
    return await reviseResumeWithChat({
      supabase,
      userId: user.id,
      applicationId,
      language,
      resume,
      history: history.slice(-10),
      instruction: instruction.trim(),
    });
  } catch (e) {
    return { error: e instanceof Error ? e.message : "修改失敗，請再試一次" };
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
    revalidatePath(`/applications/${applicationId}/cover-letter`);
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

/** JD 條件清單裡的工作條件（出差這類）：使用者回答能不能配合。可以配合的話摘要會補一句並重新評分。 */
export async function answerWorkConditionAction(
  applicationId: string,
  item: string,
  willing: boolean,
  editedResumeDraft: ResumeMap,
): Promise<GenerateResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "請先登入" };

  try {
    await answerWorkCondition({ supabase, userId: user.id, applicationId, item, willing, editedResumeDraft });
    const fresh = await fetchApplicationScoringFields(supabase, user.id, applicationId);
    revalidatePath(`/applications/${applicationId}`);
    revalidatePath(`/applications/${applicationId}/cover-letter`);
    revalidatePath("/");
    if (!fresh) return { error: "儲存後讀取結果失敗" };
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
    return { error: e instanceof Error ? e.message : "儲存失敗，請再試一次" };
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
  revalidatePath(`/applications/${applicationId}/cover-letter`);
  return { success: true };
}

/**
 * 用下載時同一套程式排 PDF，量每個版本會不會超出一頁（取捨建議一次要試很多種組合，所以收陣列）。
 * 不讀資料庫，畫布上還沒儲存的內容也能量。
 */
export async function measureResumesAction(
  resumes: GeneratedResume["resume"][],
  language: string,
  contact: ResumeContact,
): Promise<{ error?: string; fits?: PdfFit[] }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "請先登入" };
  if (resumes.length > 40) return { error: "一次最多量 40 個版本" };

  try {
    const fits: PdfFit[] = [];
    // 一個一個排：react-pdf 的字型是全域共用的，同時排好幾份沒有比較快。
    for (const resume of resumes) fits.push(await measureResumePdf({ contact, resume, language }));
    return { fits };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "量 PDF 版面失敗" };
  }
}

/**
 * 存字級跟間距。排版不算內容，定案後也能調，草稿跟定案版本一起更新，下載的檔案才會用新的設定。
 */
export async function saveLayoutAction(
  applicationId: string,
  language: string,
  layout: ResumeLayoutSettings,
): Promise<{ error?: string; success?: boolean }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "請先登入" };

  const { data: application } = await supabase
    .from("applications")
    .select("resume_draft, resume_snapshot")
    .eq("id", applicationId)
    .eq("user_id", user.id)
    .single();
  if (!application) return { error: "找不到這筆應徵紀錄" };

  const clean = readLayoutSettings(layout, language);
  const withLayout = (map: ResumeMap | null) =>
    map?.[language] ? { ...map, [language]: { ...map[language], layout: clean } } : map;

  const { error } = await supabase
    .from("applications")
    .update({
      resume_draft: withLayout(application.resume_draft as ResumeMap | null),
      resume_snapshot: withLayout(application.resume_snapshot as ResumeMap | null),
    })
    .eq("id", applicationId)
    .eq("user_id", user.id);
  if (error) return { error: error.message };
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
    .select("resume_draft, resume_snapshot, resume_language, company_name, job_title")
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

  // 上一次定案的版本（回到編輯後再定案才會有）。拿來比對這次改了哪幾條，
  // 只寫回新增或改過的，改掉或刪掉的舊寫法從資料庫拿掉，不會越定案越多重複的寫法。
  const previous = (application.resume_snapshot ?? null) as ResumeMap | null;

  for (const lang of languages) {
    const resume = draft[lang];
    if (!resume) continue;
    const sourceLabel = `${labelBase}_${lang}_定案`;
    const before = previous?.[lang];

    if (before) {
      const nowBullets = new Set(allBullets(resume));
      const staleBullets = allBullets(before).filter((b) => !nowBullets.has(b));
      if (staleBullets.length > 0) {
        await removeVariantsFromSource({ supabase, userId: user.id, sourceLabel, texts: staleBullets });
      }
    }

    const toWrite = before ? onlyNewBullets(resume, before) : resume;
    const rawContent = serializeResumeSections(toWrite);
    if (!rawContent.trim()) continue;

    await mergeContentIntoExperienceDb({
      supabase,
      userId: user.id,
      sourceLabel,
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

  revalidatePath(`/applications/${applicationId}/cover-letter`);
  revalidatePath("/");
  return { success: true };
}

type CoverLetterGenerateResult = {
  error?: string;
  success?: boolean;
  data?: {
    cover_letter_draft: Record<string, string>;
    researchSources: string[] | null;
    companyMismatch: string | null;
  };
};

export async function generateCoverLetterAction(
  applicationId: string,
  languages: string[],
  options: CoverLetterOptions,
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
    // 字數上限只收合理的正整數，其他當作不限。
    const wordLimits = Object.fromEntries(
      Object.entries(options.wordLimits ?? {}).filter(([lang, n]) => isValidWordLimit(lang, n)),
    );
    const info = await generateCoverLetterForApplication(supabase, user.id, applicationId, {
      wordLimits,
      research: !!options.research,
    });
    const { data } = await supabase
      .from("applications")
      .select("cover_letter_draft")
      .eq("id", applicationId)
      .eq("user_id", user.id)
      .single();
    revalidatePath(`/applications/${applicationId}`);
    revalidatePath(`/applications/${applicationId}/cover-letter`);
    return {
      success: true,
      data: {
        cover_letter_draft: data?.cover_letter_draft ?? {},
        researchSources: info.researchSources,
        companyMismatch: info.companyMismatch,
      },
    };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "生成求職信失敗" };
  }
}

type RecheckResult = {
  error?: string;
  success?: boolean;
  /** 求職信頁的 JD 條件對照（履歷＋求職信），key 是求職信語言。 */
  data?: { cover_letter_checklist: ChecklistMap };
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
    revalidatePath(`/applications/${applicationId}/cover-letter`);
    return { success: true, data: { cover_letter_checklist: checklist } };
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

  revalidatePath(`/applications/${applicationId}/cover-letter`);
  revalidatePath("/");
  return { success: true };
}

export async function updateApplicationTitleAction(
  applicationId: string,
  companyName: string,
  jobTitle: string,
): Promise<{ error?: string; success?: boolean }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "請先登入" };

  const { error } = await supabase
    .from("applications")
    .update({ company_name: companyName.trim() || null, job_title: jobTitle.trim() || null })
    .eq("id", applicationId)
    .eq("user_id", user.id);

  if (error) return { error: error.message };
  revalidatePath(`/applications/${applicationId}`);
  revalidatePath(`/applications/${applicationId}/cover-letter`);
  revalidatePath("/");
  return { success: true };
}

// 履歷、求職信都存在同一筆 applications 資料裡，沒有其他表格引用它，刪這一筆就乾淨了。
export async function deleteApplicationAction(
  applicationId: string,
): Promise<{ error?: string; success?: boolean }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "請先登入" };

  const { error } = await supabase
    .from("applications")
    .delete()
    .eq("id", applicationId)
    .eq("user_id", user.id);

  if (error) return { error: error.message };
  revalidatePath("/");
  return { success: true };
}

// 定案後想再修改：狀態退回草稿，畫布恢復可編輯。已經寫回經歷資料庫的內容先不動，
// 重新定案時會跟上一次定案的版本比對：改掉或刪掉的舊寫法移除、只寫回新的，不會重複新增。
export async function reopenResumeAction(
  applicationId: string,
): Promise<{ error?: string; success?: boolean }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "請先登入" };

  const { error } = await supabase
    .from("applications")
    .update({ status: "draft" })
    .eq("id", applicationId)
    .eq("user_id", user.id);

  if (error) return { error: error.message };
  revalidatePath(`/applications/${applicationId}`);
  revalidatePath(`/applications/${applicationId}/cover-letter`);
  revalidatePath("/");
  return { success: true };
}

// 求職信定案後想再修改：狀態退回「履歷已定案」（步驟列回到「寫求職信」，「完成」不再打勾），
// 求職信恢復可編輯。
export async function reopenCoverLetterAction(
  applicationId: string,
): Promise<{ error?: string; success?: boolean }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "請先登入" };

  const { error } = await supabase
    .from("applications")
    .update({ status: "resume_finalized", completed_at: null })
    .eq("id", applicationId)
    .eq("user_id", user.id);

  if (error) return { error: error.message };
  revalidatePath(`/applications/${applicationId}`);
  revalidatePath(`/applications/${applicationId}/cover-letter`);
  revalidatePath("/");
  return { success: true };
}

export type TrimSuggestion = {
  /** summary = 專業摘要；其他是工作經歷／領導經驗裡的某一條 bullet。 */
  section: "summary" | "work_experience" | "leadership";
  entryIndex?: number;
  bulletIndex?: number;
  action: "shorten" | "remove";
  /** 原文（顯示給使用者對照）。 */
  original: string;
  /** action 是 shorten 時的精簡版。 */
  newText?: string;
  reason: string;
};

const TRIM_SYSTEM_PROMPT = `你是履歷一頁排版顧問。使用者的履歷超出 A4 一頁，你要建議怎麼取捨內容讓它塞回一頁。

規則：
1. 優先刪掉跟這份 JD 關聯度最低的內容，通常是最舊、或跟這個職缺最不相關那段經歷裡的 bullet。寧可整條刪掉，也不要把每一句都砍幾個字，讓全部內容都變得倉促。
2. 只有句子明顯冗長、精簡後能少掉一整行，才建議精簡：去掉過程、背景描述，只留「做了什麼 + 數字結果」。事實跟數字不能改。
3. 禁止建議縮小字體、縮小邊界、壓行距（使用者可以自己在畫布上調字級跟間距）。
4. 跟 JD 越相關、數字越具體的內容越要保留；每段經歷至少留一條。
5. **依優先順序排列**：最該先動的放最前面。系統會從第一條開始一條一條套用、實際量排版後的高度，套到剛好塞回一頁就停，所以順序很重要。
6. **給的量要足夠**：建議的總量要比超出的行數多大約一半（例如超出 4 行，就給大約能省下 6 行的建議），避免給太少，使用者還要再請你第二次。精簡一條通常只省 1 行，刪掉一條省下它佔的全部行數。
7. 精簡後的句子要真的變短、少掉至少一行，不要只換幾個字。

每條建議都要寫理由（為什麼是這條、跟 JD 的關係），用繁體中文寫理由。精簡版要跟原文同一種語言。

只輸出 JSON，不要其他文字、不要 markdown：
{ "suggestions": [{ "section": "summary"|"work_experience"|"leadership", "entryIndex": number, "bulletIndex": number, "action": "shorten"|"remove", "newText": string, "reason": string }] }
section 是 summary 時不用 entryIndex、bulletIndex，action 只能是 shorten。`;

/** 一行大約放幾個字，依使用者調的字級算（中文字寬等於字級，英文字母平均約半個字級）。 */
function charsPerLine(language: string, resume: GeneratedResume["resume"]): string {
  const body = resolveMetrics(language, resume.layout).body;
  return language === "zh"
    ? `${Math.floor(BODY_WIDTH_PT / body)} 個中文字`
    : `${Math.floor(BODY_WIDTH_PT / (body * 0.47))} 個英文字元`;
}

/** 履歷超出一頁時，請 AI 建議精簡哪幾句、刪哪幾條（使用者勾選後才套用）。 */
export async function suggestTrimAction(
  applicationId: string,
  language: string,
  resume: GeneratedResume["resume"],
  overflowLines: number,
): Promise<{ error?: string; suggestions?: TrimSuggestion[] }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "請先登入" };

  const { data: application } = await supabase
    .from("applications")
    .select("job_description")
    .eq("id", applicationId)
    .eq("user_id", user.id)
    .single();
  if (!application) return { error: "找不到這筆應徵紀錄" };

  const numbered = {
    summary: resume.summary,
    work_experience: resume.work_experience.map((e, entryIndex) => ({
      entryIndex,
      org: e.org,
      role: e.role,
      bullets: e.bullets.map((text, bulletIndex) => ({ bulletIndex, text })),
    })),
    leadership: resume.leadership.map((e, entryIndex) => ({
      entryIndex,
      org: e.org,
      role: e.role,
      bullets: e.bullets.map((text, bulletIndex) => ({ bulletIndex, text })),
    })),
  };

  const userPrompt = [
    `履歷語言：${language === "zh" ? "中文" : "英文"}`,
    `目前超出一頁大約 ${overflowLines} 行。每一行大約是 ${charsPerLine(language, resume)}。`,
    `===== JD =====`,
    application.job_description,
    `===== 履歷內容（有編號）=====`,
    JSON.stringify(numbered, null, 2),
  ].join("\n\n");

  try {
    const { askClaude } = await import("@/lib/ai/askClaude");
    const response = await askClaude({
      userId: user.id,
      feature: "resume_trim",
      systemPrompt: TRIM_SYSTEM_PROMPT,
      userPrompt,
      maxTokens: 3000,
      temperature: 0,
      supabase,
    });
    const parsed = JSON.parse(
      response.text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, ""),
    ) as { suggestions: Omit<TrimSuggestion, "original">[] };

    // 把原文補上，順便丟掉編號對不上的建議（AI 偶爾會編錯號）。
    const suggestions: TrimSuggestion[] = [];
    for (const s of parsed.suggestions ?? []) {
      if (s.section === "summary") {
        if (s.newText) suggestions.push({ ...s, action: "shorten", original: resume.summary });
        continue;
      }
      const entry = resume[s.section]?.[s.entryIndex ?? -1];
      const original = entry?.bullets[s.bulletIndex ?? -1];
      if (original === undefined) continue;
      if (s.action === "shorten" && !s.newText) continue;
      suggestions.push({ ...s, original });
    }
    return { suggestions };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "AI 建議失敗，請再試一次" };
  }
}
