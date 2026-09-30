import "server-only";

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

function looksChinese(text: string): boolean {
  const cjk = (text.match(/[一-鿿]/g) ?? []).length;
  const latin = (text.match(/[A-Za-z]/g) ?? []).length;
  return cjk > latin;
}

/** 查不到、逾時、或出錯都回傳 null：求職信照樣生成，只是動機段改用職位內容來寫。 */
export async function researchCompany(companyName: string, jobDescription: string): Promise<CompanyResearch | null> {
  const apiKey = process.env.FIRECRAWL_API_KEY;
  const company = companyName.trim();
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
          (p.markdown?.trim() || p.description?.trim() || "").slice(0, PAGE_CHAR_LIMIT),
        ].join("\n"),
      )
      .join("\n\n");
    return { material, sources: pages.map((p) => p.url!) };
  } catch {
    return null;
  }
}
