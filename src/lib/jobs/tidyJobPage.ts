import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { askClaude } from "@/lib/ai/askClaude";
import { parseAiJson } from "@/lib/ai/parseAiJson";
import { toTraditional } from "@/lib/text/toTraditional";

// 新增應徵的「AI 整理內容」：使用者在職缺頁全選複製、整頁貼進 JD 欄位，按按鈕後請 AI 挑出職缺本身
// （原文照抄、不改寫），順便帶回公司名稱跟職稱（表單空白的欄位會自動填上）。
//
// 2026-10-27 以前是「貼職缺連結自動抓取」（104 讀結構化資料、其他網站透過 Firecrawl 抓）。
// 104 開始擋掉所有非瀏覽器的讀取（職缺頁跟資料介面都回 403），改成使用者自己複製整頁，任何求職網站都適用。

export interface TidiedJob {
  text: string;
  companyName: string | null;
  jobTitle: string | null;
}

/** 給 AI 篩選的內容最多留多少字，避免 prompt 太長。 */
const PAGE_CHAR_LIMIT = 20000;

const EXTRACT_SYSTEM_PROMPT = `你負責從求職網站的頁面內容裡，挑出「職缺本身」的內容。內容是使用者在職缺頁全選複製、整頁貼上的文字，混著選單、廣告、推薦職缺、其他職缺、登入提示、分享按鈕、頁尾、翻譯提示這類雜訊。

規則：
1. 只留職缺本身：職稱、工作內容／職責、條件要求、加分條件、工作條件（工作地點、出差外派、上班時間、遠端、待遇、可上班日）。公司福利、公司介紹、其他職缺、推薦職缺、廣告一律刪掉。
2. 原文照抄：不改寫、不翻譯、不摘要、不補充頁面上沒有的內容。只刪雜訊、整理分段。
3. 分段：原文有自己的段落標題就照原文；沒有的話用【工作內容】【條件要求】【工作條件】分段。條列用「1.」或「-」，不要用 markdown 的 #、**、[]() 這類符號。
4. 內容根本不是職缺（例如首頁、搜尋結果、只有登入提示），blocked 設成 true，text 給空字串。已經是乾淨的 JD、沒有雜訊，就原樣整理分段後回傳。
5. company 是招募的公司名稱、title 是職稱，頁面上找不到就給 null。

只輸出 JSON，不要其他文字、不要 markdown code fence：
{ "blocked": boolean, "company": string | null, "title": string | null, "text": string }`;

/** AI 失敗回傳 null（維持使用者貼的原文），判斷不是職缺內容回傳 "blocked"。 */
export async function tidyJobPage(
  pageText: string,
  ctx: { supabase: SupabaseClient; userId: string },
): Promise<TidiedJob | "blocked" | null> {
  let parsed: { blocked?: boolean; company?: string | null; title?: string | null; text?: string };
  try {
    const response = await askClaude({
      userId: ctx.userId,
      feature: "job_scrape_extract",
      systemPrompt: EXTRACT_SYSTEM_PROMPT,
      userPrompt: `===== 頁面內容 =====\n${pageText.slice(0, PAGE_CHAR_LIMIT)}`,
      maxTokens: 4000,
      temperature: 0,
      supabase: ctx.supabase,
    });
    parsed = parseAiJson(response.text, "tidyJobPage");
  } catch {
    return null;
  }
  if (parsed.blocked || !parsed.text?.trim()) return "blocked";
  const clean = (v: string | null | undefined) => (typeof v === "string" && v.trim() ? toTraditional(v.trim()) : null);
  return { text: parsed.text.trim(), companyName: clean(parsed.company), jobTitle: clean(parsed.title) };
}
