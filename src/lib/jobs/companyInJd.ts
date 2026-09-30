// 檢查使用者填的公司名稱有沒有出現在 JD 裡。
// 真實發生過：公司名稱填 A 公司，JD 卻貼成 B 公司的職缺，求職信就寫給了 B 公司。
// 加了「上網研究公司」之後更危險：會用 A 公司的文化去寫投給 B 公司的信。
// 純字串比對、不花 AI 額度；有些 JD 本來就不寫公司名，所以只拿來提醒，不擋。

// 公司名稱後面常見的法律形式，JD 裡通常不會寫全，比對前拿掉。
const COMPANY_SUFFIXES = [
  "股份有限公司",
  "有限公司",
  "公司",
  "inc",
  "incorporated",
  "corp",
  "corporation",
  "co",
  "ltd",
  "limited",
  "llc",
  "gmbh",
  "plc",
];

function normalize(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

function stripSuffixes(name: string): string {
  let words = name.toLowerCase().split(/[\s,.]+/).filter(Boolean);
  while (words.length > 1 && COMPANY_SUFFIXES.includes(words[words.length - 1])) words = words.slice(0, -1);
  let joined = normalize(words.join(""));
  for (const suffix of COMPANY_SUFFIXES) {
    if (/[^a-z]/.test(suffix) && joined.endsWith(suffix) && joined.length > suffix.length) {
      joined = joined.slice(0, -suffix.length);
      break;
    }
  }
  return joined;
}

/**
 * 沒填公司名稱或 JD 是空的：null（不檢查）。其他回傳 JD 裡有沒有出現這個公司名稱。
 * 全名找不到時，再試第一個字（例如「Acme & Partners」只要 JD 有 Acme 就算）；
 * 第一個字太短（AI、Bank 這種到處都有的字）不算數，避免誤判成有出現。
 */
export function companyMentionedInJd(
  companyName: string | null | undefined,
  jobDescription: string | null | undefined,
): boolean | null {
  const company = stripSuffixes(companyName ?? "");
  const jd = normalize(jobDescription ?? "");
  if (!company || !jd) return null;
  if (jd.includes(company)) return true;
  const firstWord = normalize((companyName ?? "").trim().split(/[\s&,]+/)[0] ?? "");
  const longEnough = /[\u4e00-\u9fff]/.test(firstWord) ? firstWord.length >= 2 : firstWord.length >= 5;
  return longEnough && firstWord !== company && jd.includes(firstWord);
}
