import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { askClaude } from "@/lib/ai/askClaude";
import { toTraditional } from "@/lib/text/toTraditional";
import { readBackground, readLanguageBackground, type LanguageBackground, type ResumeLanguage } from "./background";

// 某個語言還沒有學歷、技能、語言能力（例如只上傳過英文履歷，要產出中文履歷）時，
// 從另一個語言翻過來，存回經歷資料庫的這個語言。只翻一次：之後生成都照存下來的版本，
// 使用者在經歷資料庫改過的寫法也會被保留，不會每次生成都被 AI 換掉。
// Summary 不翻：它只是生成時的參考素材，不會直接出現在履歷上。

type TranslatableField = "education" | "skills" | "languages";
const FIELDS: TranslatableField[] = ["education", "skills", "languages"];

const SYSTEM_PROMPT = `你是履歷翻譯助手，把使用者的學歷、技能、語言能力翻成另一個語言的履歷寫法。

規則：
1. 校名用學校官方的中文／英文名稱（例如 National Taiwan University ↔ 國立臺灣大學）；不確定官方名稱就保留原文，不要自己編。
2. 學位、科系、輔修用該校官方的系名寫法；不確定就照字面直譯，不要換成意思不同的系名，也不要增減內容。
3. 期間、地點轉成目標語言的寫法（例如 Sep. 2014 – Jun. 2018 ↔ 2014.09 – 2018.06、Taipei ↔ 台北）。
4. 技能：工具、軟體、程式語言、專有名詞（Figma、SQL、A/B Testing）保留原文；一般能力才翻譯。
5. 語言能力：格式維持「語言（程度）」，中文用全形括號，英文用半形括號。檢定名稱與分數照抄。
6. 中文一律用繁體、台灣用語；中文字跟英文、數字之間加一個半形空格（例如「多益 945 分」「B2 等級」）。
7. 只輸出 JSON，只包含要翻譯的欄位，不要有其他文字、不要用 markdown code fence 包起來：
{ "education": [{ "school": string, "detail": string|null, "period": string|null, "location": string|null }], "skills": string[], "languages": string[] }`;

export async function ensureBackgroundLanguage(params: {
  supabase: SupabaseClient;
  userId: string;
  language: ResumeLanguage;
}): Promise<LanguageBackground> {
  const { supabase, userId, language } = params;
  const { data: profile } = await supabase.from("profile_data").select("data").eq("user_id", userId).maybeSingle();
  const all = readBackground(profile?.data);
  const target = all[language];
  const other = all[language === "zh" ? "en" : "zh"];

  const missing = FIELDS.filter((f) => target[f].length === 0 && other[f].length > 0);
  if (missing.length === 0) return target;

  const response = await askClaude({
    userId,
    feature: "background_translate",
    systemPrompt: SYSTEM_PROMPT,
    userPrompt: [
      `目標語言：${language === "zh" ? "繁體中文" : "English"}`,
      `===== 要翻譯的內容 =====`,
      JSON.stringify(Object.fromEntries(missing.map((f) => [f, other[f]])), null, 2),
    ].join("\n\n"),
    maxTokens: 2000,
    supabase,
  });

  const cleaned = response.text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "");
  let parsed: unknown;
  try {
    parsed = JSON.parse(language === "zh" ? toTraditional(cleaned) : cleaned);
  } catch {
    return target; // 翻譯失敗就維持原樣，生成時 AI 會依來源轉換規則自己處理。
  }
  const translated = readLanguageBackground(parsed);
  const merged: LanguageBackground = { ...target };
  for (const f of missing) {
    if (f === "education") merged.education = translated.education;
    else merged[f] = translated[f];
  }

  await supabase
    .from("profile_data")
    .upsert({ user_id: userId, data: { ...(profile?.data ?? {}), background: { ...all, [language]: merged } } });
  return merged;
}
