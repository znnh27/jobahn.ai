import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { askClaude } from "@/lib/ai/askClaude";

const WRITING_RULES = `寫作規則（一定要遵守）：
1. 每條 bullet：動詞開頭 + 具體任務 + 量化成果，最多兩句話。就算用分號或子句硬塞出 3 個以上概念，也算違規，即使字數沒超版也算。
2. 不要寫得太細碎、太過程導向（跳過一步一步的流程描述），但重點要抓到，盡量帶數字或具體成果。
3. 禁止使用 em-dash（—），改用逗號、分號，或拆成兩句話。
4. 禁止用三個並列動詞/形容詞當偷懶的清單寫法（例如：Led..., fixed..., and lifted...）。
5. 禁止過程/背景填充語，例如「as part of X project」「after doing Y」這種鋪陳。
6. 降低 AI 感，避免堆疊術語、過度正式的寫法，避免像「served as the connective point」這種聽起來假假的措辭，盡量寫得像人類自然會寫的用詞。
7. 每段工作經歷最多 4 條 bullet，只放對這個職缺有幫助的內容，其餘略過不用全部塞進去。
8. 履歷內容要能一頁 A4 呈現，不要塞得過多過滿。
9. JD 原文用字要盡量真的出現在履歷裡（不是只有意思接近），前提是使用者真的有對應的真實經歷可以支撐，不能為了關鍵字硬掰。`;

const SYSTEM_PROMPT = `你是履歷客製化助手。使用者會給你：這個職缺的 JD、使用者的經歷資料庫（同一段經歷可能有多種描述變體，是他過去不同履歷版本留下的）、使用者的個人資料（聯絡方式、學歷、技能）。

你的任務：
1. 分析 JD 要求哪些條件。
2. 從經歷資料庫的變體裡，挑選/合併出最適合這個職缺的內容，寫成一份完整履歷（Professional Summary、工作經歷、領導經驗/專案、學歷、技能）。
3. 產出 JD 符合度清單：列出 JD 的關鍵要求，標記這份履歷有沒有涵蓋到。
4. 產出 ATS heuristic 評分（0-100，非官方標準分數，綜合關鍵字覆蓋與格式健檢）跟目前還缺少哪些 JD 要求的清單。

重要：輸出的每一段工作經歷/領導經驗的 "org" 欄位，一定要跟輸入的經歷資料庫裡對應那筆的 org_name 完全一致（一字不改），不要精簡、不要改寫、不要移除括號內的說明文字。這個欄位之後系統要拿去跟資料庫比對，改寫過會導致比對失敗。

${WRITING_RULES}

只輸出 JSON，不要有其他文字、不要用 markdown code fence 包起來。輸出格式（嚴格遵守）：
{
  "resume": {
    "summary": string,
    "work_experience": [{ "org": string, "role": string, "period": string, "location": string|null, "bullets": string[] }],
    "leadership": [{ "org": string, "role": string, "period": string, "location": string|null, "bullets": string[] }],
    "education": [{ "school": string, "period": string, "location": string|null, "detail": string|null }],
    "skills": string[]
  },
  "jd_match_checklist": [{ "item": string, "covered": boolean, "source": "resume"|null }],
  "ats_score": number,
  "ats_gaps": string[]
}`;

interface ExperienceEntryRow {
  language: string;
  entry_type: string;
  org_name: string;
  location: string | null;
  role_variants: unknown;
  period_variants: unknown;
  description_variants: unknown;
}

export interface GeneratedResume {
  resume: {
    summary: string;
    work_experience: Array<{
      org: string;
      role: string;
      period: string;
      location: string | null;
      bullets: string[];
    }>;
    leadership: Array<{
      org: string;
      role: string;
      period: string;
      location: string | null;
      bullets: string[];
    }>;
    education: Array<{ school: string; period: string; location: string | null; detail: string | null }>;
    skills: string[];
  };
  jd_match_checklist: Array<{ item: string; covered: boolean; source: "resume" | null }>;
  ats_score: number;
  ats_gaps: string[];
}

export async function generateResumeForApplication(
  supabase: SupabaseClient,
  userId: string,
  applicationId: string,
): Promise<void> {
  const { data: application, error: appError } = await supabase
    .from("applications")
    .select("job_description, resume_language")
    .eq("id", applicationId)
    .eq("user_id", userId)
    .single();

  if (appError || !application) {
    throw new Error(`找不到這筆應徵紀錄：${appError?.message ?? "unknown"}`);
  }

  const languages: string[] = application.resume_language ?? [];
  if (languages.length === 0) {
    throw new Error("這筆應徵沒有指定語言版本");
  }

  const { data: entries, error: entriesError } = await supabase
    .from("experience_entries")
    .select("language, entry_type, org_name, location, role_variants, period_variants, description_variants")
    .eq("user_id", userId);

  if (entriesError) throw new Error(`讀取經歷資料庫失敗：${entriesError.message}`);
  if (!entries || entries.length === 0) {
    throw new Error("經歷資料庫是空的，請先到首次設定上傳並解析履歷");
  }

  const { data: profile } = await supabase
    .from("profile_data")
    .select("data")
    .eq("user_id", userId)
    .maybeSingle();

  const resumeDraft: Record<string, GeneratedResume["resume"]> = {};
  const checklists: Record<string, GeneratedResume["jd_match_checklist"]> = {};
  const atsScores: Record<string, number> = {};
  const atsGaps: Record<string, string[]> = {};

  for (const lang of languages) {
    const langEntries = (entries as ExperienceEntryRow[]).filter((e) => e.language === lang);

    const userPrompt = buildUserPrompt({
      jd: application.job_description,
      language: lang,
      entries: langEntries,
      profile: profile?.data ?? {},
    });

    const response = await askClaude({
      userId,
      feature: "resume_generate",
      systemPrompt: SYSTEM_PROMPT,
      userPrompt,
      maxTokens: 8000,
      supabase,
    });

    const parsed = parseJsonResponse(response.text);
    resumeDraft[lang] = parsed.resume;
    checklists[lang] = parsed.jd_match_checklist;
    atsScores[lang] = parsed.ats_score;
    atsGaps[lang] = parsed.ats_gaps;
  }

  const { error: updateError } = await supabase
    .from("applications")
    .update({
      resume_draft: resumeDraft,
      jd_match_checklist: checklists,
      ats_score: Math.round(
        Object.values(atsScores).reduce((a, b) => a + b, 0) / Object.values(atsScores).length,
      ),
      ats_gaps: atsGaps,
      status: "draft",
    })
    .eq("id", applicationId)
    .eq("user_id", userId);

  if (updateError) throw new Error(`儲存生成結果失敗：${updateError.message}`);
}

const RESCORE_SYSTEM_PROMPT = `你是履歷評分助手。使用者會給你 JD、一份「先前已經定義好的 JD 符合度清單」、跟一份已經寫好（可能是他自己編輯過）的履歷內容。

你的任務：不要改寫或重新生成履歷內容，也不要自己重新想一份新的檢查清單。
1. 針對「先前已經定義好的 JD 符合度清單」裡的每一項，重新檢查現在這份履歷內容有沒有涵蓋到，更新 covered 跟 source，item 文字本身要保持跟先前清單完全一樣，不要改寫、不要新增、不要刪除項目（除非先前清單是空的，這種情況才需要你自己從 JD 重新列出）。這樣使用者才能看出「這次編輯前後」是不是真的有進步。
2. 根據這份更新後的清單，重新算 ATS heuristic 評分（0-100，非官方標準分數，綜合關鍵字覆蓋與格式健檢）跟目前還缺少哪些 JD 要求。

只輸出 JSON，不要有其他文字、不要用 markdown code fence 包起來。輸出格式（嚴格遵守）：
{
  "jd_match_checklist": [{ "item": string, "covered": boolean, "source": "resume"|null }],
  "ats_score": number,
  "ats_gaps": string[]
}`;

export async function rescoreResumeForApplication(
  supabase: SupabaseClient,
  userId: string,
  applicationId: string,
  editedResumeDraft: Record<string, GeneratedResume["resume"]>,
): Promise<void> {
  const { data: application, error: appError } = await supabase
    .from("applications")
    .select("job_description, resume_language, jd_match_checklist")
    .eq("id", applicationId)
    .eq("user_id", userId)
    .single();

  if (appError || !application) {
    throw new Error(`找不到這筆應徵紀錄：${appError?.message ?? "unknown"}`);
  }

  const languages: string[] = application.resume_language ?? [];
  const existingChecklists: Record<string, GeneratedResume["jd_match_checklist"]> =
    application.jd_match_checklist ?? {};
  const checklists: Record<string, GeneratedResume["jd_match_checklist"]> = {};
  const atsScores: Record<string, number> = {};
  const atsGaps: Record<string, string[]> = {};

  for (const lang of languages) {
    const resumeContent = editedResumeDraft[lang];
    if (!resumeContent) continue;

    const existingItems = existingChecklists[lang] ?? [];

    const userPrompt = [
      `===== JD =====`,
      application.job_description,
      `===== 先前已經定義好的 JD 符合度清單（item 文字要保持不變，只更新 covered/source）=====`,
      existingItems.length > 0
        ? JSON.stringify(existingItems.map((i) => i.item), null, 2)
        : "（目前是空的，請你從 JD 自己列出）",
      `===== 履歷內容（${lang}）=====`,
      JSON.stringify(resumeContent, null, 2),
    ].join("\n\n");

    const response = await askClaude({
      userId,
      feature: "ats_score",
      systemPrompt: RESCORE_SYSTEM_PROMPT,
      userPrompt,
      maxTokens: 3000,
      supabase,
    });

    const parsed = JSON.parse(
      response.text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, ""),
    ) as Pick<GeneratedResume, "jd_match_checklist" | "ats_score" | "ats_gaps">;

    checklists[lang] = parsed.jd_match_checklist;
    atsScores[lang] = parsed.ats_score;
    atsGaps[lang] = parsed.ats_gaps;
  }

  const { error: updateError } = await supabase
    .from("applications")
    .update({
      resume_draft: editedResumeDraft,
      jd_match_checklist: checklists,
      ats_score: Math.round(
        Object.values(atsScores).reduce((a, b) => a + b, 0) / Object.values(atsScores).length,
      ),
      ats_gaps: atsGaps,
    })
    .eq("id", applicationId)
    .eq("user_id", userId);

  if (updateError) throw new Error(`儲存評分結果失敗：${updateError.message}`);
}

function buildUserPrompt(params: {
  jd: string;
  language: string;
  entries: ExperienceEntryRow[];
  profile: unknown;
}): string {
  return [
    `目標職缺語言版本：${params.language}`,
    `===== JD =====`,
    params.jd,
    `===== 使用者經歷資料庫（${params.language}）=====`,
    JSON.stringify(params.entries, null, 2),
    `===== 使用者個人資料 =====`,
    JSON.stringify(params.profile, null, 2),
  ].join("\n\n");
}

function parseJsonResponse(text: string): GeneratedResume {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "");

  try {
    return JSON.parse(cleaned) as GeneratedResume;
  } catch {
    throw new Error("AI 回傳的內容不是有效的 JSON，解析失敗");
  }
}
