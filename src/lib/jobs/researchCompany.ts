import "server-only";
import { searchableCompanyName } from "./companyInJd";

// 寫求職信「為什麼想加入這間公司」那段之前，先上網查這間公司的文化、價值觀、徵才頁面。
// 每次生成都重新查，不沿用上一次（也不沿用別的職缺）的資料。
// 用 Firecrawl search 搜一次、順便抓前 2 個結果的內文：大約 4 credits。
// 沒設 FIRECRAWL_API_KEY（例如別人自己架的版本）時整個功能不出現，見 isCompanyResearchAvailable()。

const RESULT_LIMIT = 2;
/** 每頁最多留多少字給 AI，避免 prompt 太長。 */
const PAGE_CHAR_LIMIT = 3000;
const TIMEOUT_MS = 30000;

interface FirecrawlSearchResponse {
  success: boolean;
  data?: { url?: string; title?: string; description?: string; markdown?: string }[];
  error?: string;
}

export interface CompanyResearch {
  /** 給 AI 看的素材（每頁標明來源網址）。 */
  material: string;
  sources: string[];
}

export function isCompanyResearchAvailable(): boolean {
  return !!process.env.FIRECRAWL_API_KEY;
}

// 公司介紹段落常見的開頭。104、1111 這類頁面前面一大段都是選單，從這些字開始取，AI 才拿得到公司介紹。
const INTRO_MARKERS = [
  "公司簡介",
  "公司介紹",
  "經營理念",
  "企業文化",
  "關於我們",
  "關於公司",
  "About us",
  "About Us",
  "Our culture",
  "Our Culture",
  "Our mission",
  "Our values",
];

/** 拿掉圖片、連結網址、選單碎片，從公司介紹那段開始取。 */
function extractIntro(markdown: string): string {
  const cleaned = markdown
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\\$/gm, "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 1)
    .join("\n");
  const starts = INTRO_MARKERS.map((m) => cleaned.indexOf(m)).filter((i) => i >= 0);
  const from = starts.length > 0 ? Math.min(...starts) : 0;
  return cleaned.slice(from, from + PAGE_CHAR_LIMIT);
}

function looksChinese(text: string): boolean {
  const cjk = (text.match(/[一-鿿]/g) ?? []).length;
  const latin = (text.match(/[A-Za-z]/g) ?? []).length;
  return cjk > latin;
}

/** 查不到、逾時、或出錯都回傳 null：求職信照樣生成，只是動機段改用職位內容來寫。 */
export async function researchCompany(companyName: string, jobDescription: string): Promise<CompanyResearch | null> {
  const apiKey = process.env.FIRECRAWL_API_KEY;
  // 「中租控股_中租迪和股份有限公司」整串丟去搜效果很差，改搜「中租迪和」。
  const company = searchableCompanyName(companyName);
  if (!apiKey || !company) return null;

  const query = looksChinese(jobDescription)
    ? `${company} 企業文化 價值觀 徵才`
    : `${company} company culture values careers`;

  try {
    const response = await fetch("https://api.firecrawl.dev/v1/search", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        query,
        limit: RESULT_LIMIT,
        scrapeOptions: { formats: ["markdown"], onlyMainContent: true },
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const result: FirecrawlSearchResponse = await response.json();
    if (!response.ok || !result.success) return null;

    const pages = (result.data ?? []).filter((p) => p.url && (p.markdown?.trim() || p.description?.trim()));
    if (pages.length === 0) return null;

    const material = pages
      .map((p) =>
        [
          `----- 來源：${p.url}${p.title ? `（${p.title}）` : ""} -----`,
          p.markdown?.trim() ? extractIntro(p.markdown) : (p.description?.trim() ?? "").slice(0, PAGE_CHAR_LIMIT),
        ].join("\n"),
      )
      .join("\n\n");
    return { material, sources: pages.map((p) => p.url!) };
  } catch {
    return null;
  }
}
