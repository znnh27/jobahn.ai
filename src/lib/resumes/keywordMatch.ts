import type { GeneratedResume } from "./generateResume";

// 履歷頁「關鍵字命中」：JD 關鍵字（jdKeywords.ts 挑好的）有沒有逐字出現在履歷裡。
// 純程式比對、不用 AI，在瀏覽器裡跑，改履歷就即時更新。
// 比對規則：不分大小寫；全半形、多餘空白、中英文之間的空白不算差異（「A/B Testing」跟「A/B testing」、「SQL 分析」跟「SQL分析」都算有）。
// 英文字前後要是字的邊界，避免「SQL」被「NoSQL」、「PM」被「PMP」誤判成有。

type Resume = GeneratedResume["resume"];

export interface KeywordMatch {
  matched: string[];
  missing: string[];
}

const CJK = "\\u3400-\\u9fff\\uf900-\\ufaff";
const CJK_BEFORE_LATIN = new RegExp(`([${CJK}]) (?=[a-z0-9])`, "g");
const LATIN_BEFORE_CJK = new RegExp(`([a-z0-9]) (?=[${CJK}])`, "g");

/** 全半形統一、不分大小寫、連續空白合成一個；中文跟英數字之間的空白拿掉（排版會自動加，比對時不該算差異）。 */
function normalize(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(CJK_BEFORE_LATIN, "$1")
    .replace(LATIN_BEFORE_CJK, "$1")
    .trim();
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** 履歷攤平成一段文字：摘要、職稱、每條 bullet、學歷、技能、語言。 */
function resumeText(resume: Resume): string {
  const sections = [...(resume.work_experience ?? []), ...(resume.leadership ?? [])];
  return [
    resume.summary ?? "",
    ...sections.flatMap((s) => [s.role, ...(s.bullets ?? [])]),
    ...(resume.education ?? []).map((e) => `${e.school} ${e.detail ?? ""}`),
    ...(resume.skills ?? []),
    ...(resume.languages ?? []),
  ].join("\n");
}

/** 英文最後一個字去掉 -s、-es、-ing、-ed（字太短的不動，避免把 SaaS、AWS 這類縮寫切壞）。 */
function stemLastWord(text: string): string {
  const match = text.match(/([a-z]+)$/);
  if (!match) return text;
  const word = match[1];
  if (word.length <= 4 || word === word.toUpperCase()) return text;
  const stem = word.replace(/(ing|ed|es|s)$/, "");
  return stem.length >= 3 ? text.slice(0, -word.length) + stem : text;
}

export function matchKeywords(keywords: string[], resume: Resume): KeywordMatch {
  const haystack = normalize(resumeText(resume));
  const matched: string[] = [];
  const missing: string[] = [];
  for (const keyword of keywords) {
    const needle = normalize(keyword);
    if (!needle) continue;
    // 開頭結尾是英數字的，前後不能緊接著其他英數字（SQL 不能算進 NoSQL）。
    // 英文最後一個字容許單複數、-ing、-ed 的變化（A/B tests 跟 A/B testing 算同一個），ATS 搜尋大多也會這樣處理。
    const endsWithWord = /[a-z]$/.test(needle);
    const body = endsWithWord ? escapeRegExp(stemLastWord(needle)) + "(?:s|es|ing|ed)?" : escapeRegExp(needle);
    const pattern = new RegExp(
      `${/^[a-z0-9]/.test(needle) ? "(?<![a-z0-9])" : ""}${body}${/[a-z0-9]$/.test(needle) ? "(?![a-z0-9])" : ""}`,
    );
    (pattern.test(haystack) ? matched : missing).push(keyword);
  }
  return { matched, missing };
}
