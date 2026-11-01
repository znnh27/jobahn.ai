import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { askClaude } from "@/lib/ai/askClaude";
import { NATURAL_WRITING_RULES } from "@/lib/text/naturalWriting";
import { EN_RULES, ZH_RULES, parseJsonResponse, pinBackground, polishChinese, type GeneratedResume } from "./generateResume";
import { applyResumePatch, isResumeShape, resumeForPatch } from "./resumePatch";
import { pinEntryFacts } from "./pinEntryFacts";
import { ensureBackgroundLanguage } from "./translateBackground";

// 應徵履歷在一個語言改了內容（打字、跟 AI 聊、補充、校稿、上一步…），同樣的修改套到另一個語言（2026-11-01 Z 要求中英文內容一致）。
// 畫面停止編輯幾秒後呼叫（canvas.tsx），只回傳改好的另一個語言，不存檔；畫面換進草稿後由自動存檔存。
// 跟「跟 AI 聊」一樣只回傳改到的地方（resumePatch.ts），不整份重寫。

type Resume = GeneratedResume["resume"];

const SYSTEM_PROMPT = `你是履歷雙語同步助手。使用者有同一份履歷的兩個語言版本，剛在其中一個語言（來源）改了內容，你要把同樣的修改套到另一個語言（目標）的版本，兩個版本的內容才會一致。

1. 先比對「來源改之前」跟「來源改之後」，找出改了什麼：新增、改寫、刪除了哪幾條 bullet，摘要、技能有沒有改，有沒有新增或拿掉整段經歷、調整順序。
2. 在目標版本找到對應的地方，做同樣的修改。對應關係看內容講的是不是同一件事，通常 id 也一樣，但不一定。
3. 只改有變動的地方，其他地方一字不動。
4. 目標版本已經有的修改（內容已經跟來源改之後一致）不用重複做。
5. 改寫或新增的那條，事實、數字跟來源改之後的那條一樣，照目標語言的履歷寫法重寫（見下面的語言規則），不是逐字翻譯，避免翻譯腔。
6. 來源只改了標點、空白、錯字這種不影響內容的地方，目標版本不用改，ops 給空陣列。
7. 技能改了的話，從「目標語言的技能清單」挑對應的，寫法一字不差。
8. 新增整段經歷時，公司名稱、職稱、期間、地點照「目標語言經歷資料庫」裡同一家公司的寫法；資料庫沒有才自己轉成目標語言的寫法。

${NATURAL_WRITING_RULES}

只輸出 JSON，不要有其他文字、不要用 markdown code fence 包起來。輸出格式：{ "mode": "patch" | "full", "ops": op[], "resume": 整份目標版本履歷 | null }
- 預設用 patch：ops 只列出目標版本要改的地方，用目標版本的 id 指名，沒列到的程式會保持原樣，resume 給 null。
- op 有這幾種：
  { "op": "summary", "text": string }：改寫摘要
  { "op": "replace", "id": "w0-2", "text": string }：改寫這條 bullet
  { "op": "insert", "entry": "w0", "after": "w0-2" | null, "text": string }：在這段經歷新增一條，接在 after 那條後面；after 給 null 就放在第一條。同一個 after 新增好幾條，會照 ops 的順序往下排
  { "op": "delete", "id": "w0-2" }：刪掉這條
  { "op": "skills", "skills": string[] }：整組換掉技能
- 這幾種情況改用 full，resume 給整份目標版本履歷（不要帶 id），ops 給空陣列：
  要改公司、職稱、期間、地點，新增或拿掉整段經歷，或調整 bullet、經歷的順序；改動超過大概一半的 bullet。
  full 的格式：{ "summary": string, "work_experience": [{ "org": string, "role": string, "period": string, "location": string|null, "bullets": string[] }], "leadership": [同 work_experience], "education": [{ "school": string, "period": string, "location": string|null, "detail": string|null }], "skills": string[], "languages": string[] }`;

export async function syncResumeEdit(params: {
  supabase: SupabaseClient;
  userId: string;
  sourceLanguage: string;
  /** 來源語言上次同步時的內容。 */
  before: Resume;
  /** 來源語言現在的內容。 */
  after: Resume;
  /** 目標語言現在的內容。 */
  target: Resume;
}): Promise<Resume> {
  const { supabase, userId, before, after, target } = params;
  const targetLanguage = params.sourceLanguage === "zh" ? "en" : "zh";

  const [background, { data: entryRows }] = await Promise.all([
    ensureBackgroundLanguage({ supabase, userId, language: targetLanguage }),
    supabase
      .from("experience_entries")
      .select("org_name, location, role_variants, period_variants")
      .eq("user_id", userId)
      .eq("language", targetLanguage),
  ]);
  const targetEntries = entryRows ?? [];

  const userPrompt = [
    `來源語言：${params.sourceLanguage}；目標語言：${targetLanguage}`,
    targetLanguage === "en" ? EN_RULES : ZH_RULES,
    `===== 來源改之前 =====`,
    JSON.stringify(resumeForPatch(before), null, 2),
    `===== 來源改之後 =====`,
    JSON.stringify(resumeForPatch(after), null, 2),
    `===== 目標版本（現在的內容，ops 用這裡的 id）=====`,
    JSON.stringify(resumeForPatch(target), null, 2),
    `===== 目標語言經歷資料庫裡的公司、職稱、期間、地點 =====`,
    JSON.stringify(targetEntries, null, 2),
    `===== 目標語言的技能清單 =====`,
    background.skills.length > 0 ? background.skills.join("、") : "（無）",
  ].join("\n\n");

  const response = await askClaude({
    userId,
    feature: "resume_language_sync",
    systemPrompt: SYSTEM_PROMPT,
    userPrompt,
    maxTokens: 8000,
    supabase,
  });

  const parsed = parseJsonResponse<{ mode?: string; ops?: unknown; resume?: unknown }>(response.text);
  let next: Resume | null;
  if (parsed.mode === "full") {
    if (!isResumeShape(parsed.resume)) throw new Error("AI 回傳的格式不對");
    next = parsed.resume;
    pinBackground(next, background);
    pinEntryFacts(next, targetEntries);
  } else {
    next = applyResumePatch(target, parsed.ops ?? []);
    if (!next) throw new Error("AI 回傳的修改對不上目前的內容");
  }
  if (targetLanguage === "zh") polishChinese(next);
  return { ...next, education: next.education ?? target.education, layout: target.layout };
}
