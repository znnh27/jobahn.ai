import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { askClaude } from "@/lib/ai/askClaude";
import { COVERAGE_RULES, type GeneratedResume } from "./generateResume";

const COVER_LETTER_RULES = `寫作規則：
1. 英文用 "Dear Hiring Manager," 開頭，中文用「招聘主管您好，」開頭。
2. 禁止使用 em-dash（—），改用逗號、分號，或拆成兩句話。
3. 降低 AI 感，避免堆疊術語、過度正式的寫法，避免像「served as the connective point」這種聽起來假假的措辭，盡量寫得像人類自然會寫的用詞，避免用三項並列的清單當偷懶的寫法。
4. 內容依照：這份履歷內容、JD 要求、履歷裡沒放進去但 JD 有列出的條件，去寫求職信，補上履歷放不進去的缺口。
5. 如果要用「使用者正在開發一個 AI 工具」這件事當佐證去補缺口，只能提到「有在開發一個 AI 工具」這個事實本身，絕對不要描述這個工具的細節、功能、或用途。
6. 長度跟語氣比照一般求職信，四到五段，不要過長。`;

const SYSTEM_PROMPT = `你是求職信寫作助手。使用者會給你：JD、已經定案的履歷內容、JD 符合度清單（標記履歷還缺少哪些條件）。

你的任務：寫一封求職信，語氣自然、針對這個職缺客製化，適度用已經定案履歷裡沒放進去、但 JD 有列出的條件去補強說服力。

${COVER_LETTER_RULES}

只輸出求職信本文（含開頭問候與署名），不要有其他說明文字、不要用 markdown 包起來。`;

export async function generateCoverLetterForApplication(
  supabase: SupabaseClient,
  userId: string,
  applicationId: string,
): Promise<void> {
  const { data: application, error: appError } = await supabase
    .from("applications")
    .select("job_description, resume_snapshot, cover_letter_language, jd_match_checklist")
    .eq("id", applicationId)
    .eq("user_id", userId)
    .single();

  if (appError || !application) {
    throw new Error(`找不到這筆應徵紀錄：${appError?.message ?? "unknown"}`);
  }

  if (!application.resume_snapshot) {
    throw new Error("履歷還沒定案，請先完成履歷定案再寫求職信");
  }

  const languages: string[] = application.cover_letter_language ?? [];
  if (languages.length === 0) {
    throw new Error("請先選擇求職信語言版本");
  }

  const resumeSnapshot: Record<string, GeneratedResume["resume"]> = application.resume_snapshot;
  const checklist: Record<string, GeneratedResume["jd_match_checklist"]> =
    application.jd_match_checklist ?? {};

  const draft: Record<string, string> = {};

  for (const lang of languages) {
    // 求職信語言不一定等於履歷語言，找不到完全對應時就用第一個有的履歷版本當內容依據
    const resumeLang = resumeSnapshot[lang] ? lang : Object.keys(resumeSnapshot)[0];
    const resume = resumeSnapshot[resumeLang];
    const checklistForResume = checklist[resumeLang] ?? [];

    const userPrompt = [
      `目標語言：${lang}`,
      `===== JD =====`,
      application.job_description,
      `===== 已定案的履歷內容 =====`,
      JSON.stringify(resume, null, 2),
      `===== JD 符合度清單（尚未涵蓋的部分可以考慮在求職信補強）=====`,
      JSON.stringify(checklistForResume, null, 2),
    ].join("\n\n");

    const response = await askClaude({
      userId,
      feature: "cover_letter",
      systemPrompt: SYSTEM_PROMPT,
      userPrompt,
      maxTokens: 2000,
      supabase,
    });

    draft[lang] = response.text.trim();
  }

  const { error: updateError } = await supabase
    .from("applications")
    .update({ cover_letter_draft: draft })
    .eq("id", applicationId)
    .eq("user_id", userId);

  if (updateError) throw new Error(`儲存求職信失敗：${updateError.message}`);
}

const RECHECK_SYSTEM_PROMPT = `你是求職信與履歷符合度檢查助手。使用者會給你 JD、先前已經定義好的 JD 符合度清單、履歷內容、求職信內容。

你的任務：針對清單裡的每一項，重新檢查「履歷或求職信」現在有沒有涵蓋到，item 文字要保持跟先前清單完全一樣，不要新增、刪除、改寫項目。source 欄位要標明是被履歷涵蓋（"resume"）還是求職信涵蓋（"cover_letter"），都沒涵蓋就是 null。

${COVERAGE_RULES}

只輸出 JSON，不要有其他文字、不要用 markdown code fence 包起來。輸出格式：
{ "jd_match_checklist": [{ "item": string, "covered": boolean, "source": "resume"|"cover_letter"|null }] }`;

export async function recheckJdMatchWithCoverLetter(
  supabase: SupabaseClient,
  userId: string,
  applicationId: string,
  editedCoverLetterDraft: Record<string, string>,
): Promise<Record<string, GeneratedResume["jd_match_checklist"]>> {
  const { data: application, error: appError } = await supabase
    .from("applications")
    .select("job_description, resume_snapshot, jd_match_checklist, cover_letter_language")
    .eq("id", applicationId)
    .eq("user_id", userId)
    .single();

  if (appError || !application) {
    throw new Error(`找不到這筆應徵紀錄：${appError?.message ?? "unknown"}`);
  }

  const resumeSnapshot: Record<string, GeneratedResume["resume"]> = application.resume_snapshot ?? {};
  const existingChecklists: Record<string, GeneratedResume["jd_match_checklist"]> =
    application.jd_match_checklist ?? {};
  const languages: string[] = application.cover_letter_language ?? [];

  const updatedChecklists: Record<string, GeneratedResume["jd_match_checklist"]> = {
    ...existingChecklists,
  };

  for (const lang of languages) {
    const resumeLang = resumeSnapshot[lang] ? lang : Object.keys(resumeSnapshot)[0];
    const existingItems = existingChecklists[resumeLang] ?? [];
    const coverLetter = editedCoverLetterDraft[lang] ?? "";

    const userPrompt = [
      `===== JD =====`,
      application.job_description,
      `===== 先前已經定義好的 JD 符合度清單（item 文字要保持不變）=====`,
      JSON.stringify(existingItems.map((i) => i.item), null, 2),
      `===== 履歷內容 =====`,
      JSON.stringify(resumeSnapshot[resumeLang], null, 2),
      `===== 求職信內容 =====`,
      coverLetter,
    ].join("\n\n");

    const response = await askClaude({
      userId,
      feature: "jd_recheck",
      systemPrompt: RECHECK_SYSTEM_PROMPT,
      userPrompt,
      maxTokens: 3000,
      temperature: 0,
      supabase,
    });

    const parsed = JSON.parse(
      response.text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, ""),
    ) as { jd_match_checklist: GeneratedResume["jd_match_checklist"] };

    updatedChecklists[resumeLang] = parsed.jd_match_checklist;
  }

  const { error: updateError } = await supabase
    .from("applications")
    .update({ cover_letter_draft: editedCoverLetterDraft, jd_match_checklist: updatedChecklists })
    .eq("id", applicationId)
    .eq("user_id", userId);

  if (updateError) throw new Error(`儲存重新比對結果失敗：${updateError.message}`);

  return updatedChecklists;
}
