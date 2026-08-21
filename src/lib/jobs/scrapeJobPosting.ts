import "server-only";

interface FirecrawlScrapeResponse {
  success: boolean;
  data?: { markdown?: string };
  error?: string;
}

export async function scrapeJobPosting(url: string): Promise<string> {
  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (!apiKey) {
    throw new Error("尚未設定 FIRECRAWL_API_KEY，無法抓取職缺頁面");
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw new Error("職缺連結格式不正確");
  }
  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
    throw new Error("職缺連結格式不正確");
  }

  const response = await fetch("https://api.firecrawl.dev/v1/scrape", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ url: parsedUrl.toString(), formats: ["markdown"] }),
  });

  const result: FirecrawlScrapeResponse = await response.json();

  if (!response.ok || !result.success) {
    throw new Error(`抓取職缺頁面失敗：${result.error ?? response.statusText}`);
  }

  const markdown = result.data?.markdown?.trim();
  if (!markdown) {
    throw new Error("抓取成功，但頁面沒有可用的文字內容");
  }

  return markdown;
}
