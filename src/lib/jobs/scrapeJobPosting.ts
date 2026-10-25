import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { askClaude } from "@/lib/ai/askClaude";
import { toTraditional } from "@/lib/text/toTraditional";
import { markdownToText } from "./markdownToText";

// 新增應徵時「抓取內容」：把職缺連結變成乾淨的 JD 文字，順便帶回公司名稱跟職稱（表單空白的欄位會自動填上）。
//
// 以前是請 Firecrawl 把整頁轉成文字，選單、廣告、推薦職缺、智能客服、登入提示全部混進來；
// 104 的頁面還是先載入空殼、再用 JavaScript 補內容，常常連工作內容本身都沒抓到。現在分兩條路：
// 1. 104：直接拿 104 自己提供頁面內容的資料（/job/ajax/content/{id}），整理好的結構化欄位，乾淨又穩定。
//    這個網址直接連會被 Cloudflare 擋（403），要透過 Firecrawl 抓。
// 2. 其他網站：Firecrawl 只抓主要內容，再請 AI 挑出職缺本身的內容（原文照抄、不改寫），刪掉雜訊。
//    要登入才看得到的頁面（例如 LinkedIn）直接說清楚，不回傳一堆雜訊。

export interface ScrapedJob {
  text: string;
  companyName: string | null;
  jobTitle: string | null;
}

const FIRECRAWL_SCRAPE = "https://api.firecrawl.dev/v1/scrape";
const PASTE_INSTEAD = "這個網站不支援自動抓取（通常是要登入才看得到的網站），請直接複製職缺內容貼到下面";
/** 已知抓不到的網站（要登入、Firecrawl 不支援），直接說，不浪費一次抓取。 */
const UNSUPPORTED_HOSTS = ["linkedin.com", "facebook.com", "instagram.com", "threads.net"];
/** 給 AI 篩選的頁面最多留多少字，避免 prompt 太長。 */
const PAGE_CHAR_LIMIT = 20000;

interface FirecrawlScrapeResponse {
  success: boolean;
  data?: { markdown?: string; rawHtml?: string };
  error?: string;
}

async function firecrawlScrape(body: Record<string, unknown>): Promise<NonNullable<FirecrawlScrapeResponse["data"]>> {
  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (!apiKey) throw new Error("尚未設定 FIRECRAWL_API_KEY，無法抓取職缺頁面");
  const response = await fetch(FIRECRAWL_SCRAPE, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60000),
  });
  const result: FirecrawlScrapeResponse = await response.json();
  if (!response.ok || !result.success || !result.data) {
    // Firecrawl 不支援的網站（社群平台這類）會回一大段英文，換成白話。
    if (/do not support this site/i.test(result.error ?? "")) throw new Error(PASTE_INSTEAD);
    throw new Error(`抓取職缺頁面失敗：${result.error ?? response.statusText}`);
  }
  return result.data;
}

export async function scrapeJobPosting(
  url: string,
  ctx: { supabase: SupabaseClient; userId: string },
): Promise<ScrapedJob> {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw new Error("職缺連結格式不正確");
  }
  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
    throw new Error("職缺連結格式不正確");
  }

  if (UNSUPPORTED_HOSTS.some((h) => parsedUrl.hostname === h || parsedUrl.hostname.endsWith(`.${h}`))) {
    throw new Error(PASTE_INSTEAD);
  }

  const jobId104 = parsedUrl.hostname.endsWith("104.com.tw") ? parsedUrl.pathname.match(/^\/job\/([a-z0-9]+)/i)?.[1] : null;
  if (jobId104) return scrape104(jobId104);
  return scrapeGeneric(parsedUrl.toString(), ctx);
}

// ---------- 104 ----------

type Item = string | { description?: string; name?: string; [key: string]: unknown };

/** 104 的清單欄位有時是字串、有時是 { description } 物件，統一轉成文字。 */
function listText(items: unknown): string {
  if (!Array.isArray(items)) return "";
  return (items as Item[])
    .map((item) => {
      if (typeof item === "string") return item;
      if (item.description) return item.description;
      if (item.name) return item.name;
      return Object.values(item)
        .filter((v): v is string => typeof v === "string" && !/^\d+$/.test(v))
        .join(" ");
    })
    .filter(Boolean)
    .join("、");
}

function line(label: string, value: unknown): string | null {
  const text = typeof value === "string" ? value.trim() : "";
  return text ? `${label}：${text}` : null;
}

async function scrape104(jobId: string): Promise<ScrapedJob> {
  const data = await firecrawlScrape({
    url: `https://www.104.com.tw/job/ajax/content/${jobId}`,
    formats: ["rawHtml"],
    headers: { Referer: `https://www.104.com.tw/job/${jobId}` },
  });
  const json = data.rawHtml?.match(/\{[\s\S]*\}/)?.[0];
  let job: Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- 104 的回傳格式沒有公開型別
  try {
    job = JSON.parse(json ?? "").data;
  } catch {
    throw new Error("104 的職缺資料讀不到，可能職缺已經下架，請直接貼上 JD 內容");
  }
  if (!job?.jobDetail) throw new Error("104 的職缺資料讀不到，可能職缺已經下架，請直接貼上 JD 內容");

  const header = job.header ?? {};
  const detail = job.jobDetail ?? {};
  const condition = job.condition ?? {};
  const shifts = detail.workPeriod?.shifts ? Object.keys(detail.workPeriod.shifts).join("、") : "";
  const remote = detail.remoteWork
    ? [detail.remoteWork.type, detail.remoteWork.description].filter((v) => typeof v === "string" && v).join("，")
    : "";

  const requirements = [
    line("工作經歷", condition.workExp),
    line("學歷要求", condition.edu),
    line("科系要求", listText(condition.major)),
    line("語文條件", listText(condition.language)),
    line("擅長工具", listText(condition.specialty)),
    line("工作技能", listText(condition.skill)),
    line("具備證照", listText(condition.certificate)),
    line("其他條件", condition.other),
  ].filter(Boolean);

  const conditions = [
    line("工作待遇", detail.salary),
    line("上班地點", [detail.addressRegion, detail.addressDetail].filter(Boolean).join("")),
    line("出差外派", detail.businessTrip),
    line("上班時段", shifts),
    line("休假制度", detail.vacationPolicy),
    line("遠端工作", remote),
    line("管理責任", detail.manageResp),
    line("可上班日", detail.startWorkingDay),
  ].filter(Boolean);

  const text = [
    `【工作內容】\n${String(detail.jobDescription ?? "").trim()}`,
    requirements.length > 0 ? `【條件要求】\n${requirements.join("\n")}` : null,
    conditions.length > 0 ? `【工作條件】\n${conditions.join("\n")}` : null,
  ]
    .filter(Boolean)
    .join("\n\n");

  return {
    text,
    companyName: typeof header.custName === "string" && header.custName.trim() ? header.custName.trim() : null,
    jobTitle: typeof header.jobName === "string" && header.jobName.trim() ? header.jobName.trim() : null,
  };
}

// ---------- 其他網站 ----------

const EXTRACT_SYSTEM_PROMPT = `你負責從求職網站的頁面內容裡，挑出「職缺本身」的內容。頁面是網站轉成的文字，混著選單、廣告、推薦職缺、其他職缺、登入提示、分享按鈕、頁尾、翻譯提示這類雜訊。

規則：
1. 只留職缺本身：職稱、工作內容／職責、條件要求、加分條件、工作條件（工作地點、出差外派、上班時間、遠端、待遇、可上班日）。公司福利、公司介紹、其他職缺、推薦職缺、廣告一律刪掉。
2. 原文照抄：不改寫、不翻譯、不摘要、不補充頁面上沒有的內容。只刪雜訊、整理分段。
3. 分段：原文有自己的段落標題就照原文；沒有的話用【工作內容】【條件要求】【工作條件】分段。條列用「1.」或「-」，不要用 markdown 的 #、**、[]() 這類符號。
4. 頁面要登入才看得到職缺內容（只有登入提示、或內容明顯被截斷），blocked 設成 true，text 給空字串。頁面根本不是職缺（例如首頁、搜尋結果），一樣 blocked 設成 true。
5. company 是招募的公司名稱、title 是職稱，頁面上找不到就給 null。

只輸出 JSON，不要其他文字、不要 markdown code fence：
{ "blocked": boolean, "company": string | null, "title": string | null, "text": string }`;

async function scrapeGeneric(url: string, ctx: { supabase: SupabaseClient; userId: string }): Promise<ScrapedJob> {
  const data = await firecrawlScrape({ url, formats: ["markdown"], onlyMainContent: true });
  const markdown = data.markdown?.trim();
  if (!markdown) throw new Error("抓取成功，但頁面沒有可用的文字內容，請直接貼上 JD 內容");
  const pageText = markdownToText(markdown);

  let parsed: { blocked?: boolean; company?: string | null; title?: string | null; text?: string };
  try {
    const response = await askClaude({
      userId: ctx.userId,
      feature: "job_scrape_extract",
      systemPrompt: EXTRACT_SYSTEM_PROMPT,
      userPrompt: `===== 職缺網址 =====\n${url}\n\n===== 頁面內容 =====\n${pageText.slice(0, PAGE_CHAR_LIMIT)}`,
      maxTokens: 4000,
      temperature: 0,
      supabase: ctx.supabase,
    });
    parsed = JSON.parse(response.text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, ""));
  } catch {
    // AI 篩不了（額度用完、回傳格式不對）就退回只抓主要內容的版本，至少比整頁乾淨，使用者可以自己刪。
    return { text: pageText, companyName: null, jobTitle: null };
  }

  if (parsed.blocked || !parsed.text?.trim()) {
    throw new Error("這個頁面要登入才看得到完整的職缺內容（或不是職缺頁面），請直接複製職缺內容貼上");
  }
  const clean = (v: string | null | undefined) => (typeof v === "string" && v.trim() ? toTraditional(v.trim()) : null);
  return { text: parsed.text.trim(), companyName: clean(parsed.company), jobTitle: clean(parsed.title) };
}
