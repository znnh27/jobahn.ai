import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { askClaude } from "@/lib/ai/askClaude";
import { parseAiJson } from "@/lib/ai/parseAiJson";
import { toTraditional } from "@/lib/text/toTraditional";
import { mergeLanguageBackground, readBackground, readLanguageBackground, type LanguageBackground } from "./background";

// 沒有現成履歷、用 AI 問答寫第一份的人，經歷聊完之後再問三個固定問題（學歷、技能、語言），
// 把口語回答整理成經歷資料庫的學歷／技能／語言格式存起來。問題是固定的（不用 AI 出題），
// 只有最後整理答案時呼叫一次 AI。只會新增，不會刪掉已經有的內容。

export interface BackgroundAnswers {
  education: string;
  skills: string;
  languages: string;
}

const SYSTEM_PROMPT = `你是履歷資料整理助手。使用者用口語回答了自己的學歷、技能、語言能力，請整理成履歷用的格式。

規則：
1. 依使用者回答用的語言放進 "zh" 或 "en"（中文回答放 zh、英文回答放 en），不要翻譯成另一個語言，另一個語言給空陣列。
2. education：每間學校一筆。school 只放校名（城市、國家放 location）；detail 放學位、科系、輔修、交換等，科系名稱照使用者講的寫，不要換成別的說法；period 照使用者講的整理成「2014.09 – 2018.06」或「Sep. 2014 – Jun. 2018」這種格式，沒講就 null。
3. skills：工具、軟體、專業技能，一項一個字串；工具名、專有名詞保留原文（Figma、SQL）。不要把語言能力放進來，也不要放「領導力、溝通能力」這類軟實力。
4. languages：一個語言一個字串，程度寫在括號裡，例如「英文（流利，多益 900）」「German (B2)」。
5. 使用者跳過、或回答「沒有」的項目給空陣列。不要編造使用者沒講的內容。
6. 中文一律用繁體、台灣用語；中文字跟英文、數字之間加一個半形空格（例如「多益 945 分」「B2 等級」）。
7. 只輸出 JSON，不要有其他文字、不要用 markdown code fence 包起來：
{ "zh": { "education": [{ "school": string, "detail": string|null, "period": string|null, "location": string|null }], "skills": string[], "languages": string[] }, "en": { 同上 } }`;

/** 整理回答並併進經歷資料庫，回傳新增了幾項。 */
export async function saveBackgroundAnswers(params: {
  supabase: SupabaseClient;
  userId: string;
  answers: BackgroundAnswers;
}): Promise<number> {
  const { supabase, userId, answers } = params;
  const response = await askClaude({
    userId,
    feature: "background_interview",
    systemPrompt: SYSTEM_PROMPT,
    userPrompt: [
      `學歷（學校、科系、期間）：${answers.education.trim() || "（跳過）"}`,
      `技能（會用的工具、專業技能）：${answers.skills.trim() || "（跳過）"}`,
      `語言能力：${answers.languages.trim() || "（跳過）"}`,
    ].join("\n"),
    maxTokens: 2000,
    supabase,
  });

  const cleaned = toTraditional(
    response.text
      .trim()
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/```\s*$/i, ""),
  );
  let parsed: Record<string, unknown>;
  try {
    parsed = parseAiJson(cleaned, "backgroundInterview");
  } catch {
    throw new Error("AI 回傳的內容不是有效的 JSON，整理失敗");
  }

  const { data: profile } = await supabase.from("profile_data").select("data").eq("user_id", userId).maybeSingle();
  const existing = readBackground(profile?.data);
  const merged = {
    zh: mergeLanguageBackground(existing.zh, readLanguageBackground(parsed.zh)),
    en: mergeLanguageBackground(existing.en, readLanguageBackground(parsed.en)),
  };
  const { error } = await supabase
    .from("profile_data")
    .upsert({ user_id: userId, data: { ...(profile?.data ?? {}), background: merged } });
  if (error) throw new Error(`儲存失敗：${error.message}`);

  const count = (b: LanguageBackground) => b.education.length + b.skills.length + b.languages.length;
  return count(merged.zh) + count(merged.en) - count(existing.zh) - count(existing.en);
}
