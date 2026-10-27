// 生成出來的經歷地點、日期照經歷資料庫原文：AI 會自己「潤飾」，例如把 Taipei City, Taiwan 寫成台北市、
// Nov. 2024 寫成 2024年11月（2026-10-27 Z 回報，同一份資料別的應徵都是英文）。跟學歷照抄（pinBackground）同一個道理。
// - 地點：一律換回資料庫的；資料庫沒寫就保留 AI 的。
// - 日期：資料庫可能有好幾種寫法（period_variants），AI 用的是其中一種就保留，不是就換成第一種。
//   同一間公司在資料庫有好幾筆（例如換過職位）時，對不出是哪一筆，日期不動。
// - 公司名稱只比對括號前面：AI 會把括號裡的公司說明縮短（「網際威信股份有限公司（金融科技公司，銀行系統與…）」
//   變成「（金融科技公司）」）。括號前也被改過字、對不到資料庫的經歷不動。
// 只在經歷資料庫跟履歷同語言時用；從另一個語言轉寫的，日期、地點本來就要轉成那個語言的寫法。

interface EntryFacts {
  org_name: string;
  location: string | null;
  period_variants: unknown;
}

interface ResumeEntry {
  org: string;
  period: string;
  location: string | null;
}

/** 比對日期：全半形、空白、大小寫的差異不算。 */
function looseKey(text: string): string {
  return text.normalize("NFKC").replace(/\s+/g, "").toLowerCase();
}

/** 比對公司名稱：只看括號前面的名稱。 */
function orgKey(org: string): string {
  return looseKey(org.normalize("NFKC").replace(/\(.*$/, ""));
}

function readPeriods(variants: unknown): string[] {
  if (!Array.isArray(variants)) return [];
  return variants
    .map((v) => (v && typeof v === "object" ? (v as { period?: unknown }).period : null))
    .filter((p): p is string => typeof p === "string" && p.trim().length > 0);
}

export function pinEntryFacts<R extends { work_experience?: ResumeEntry[]; leadership?: ResumeEntry[] }>(
  resume: R,
  entries: EntryFacts[],
): R {
  const byOrg = new Map<string, EntryFacts[]>();
  for (const entry of entries) {
    const key = orgKey(entry.org_name);
    byOrg.set(key, [...(byOrg.get(key) ?? []), entry]);
  }
  for (const item of [...(resume.work_experience ?? []), ...(resume.leadership ?? [])]) {
    const matches = byOrg.get(orgKey(item.org ?? ""));
    if (!matches) continue;
    const locations = [...new Set(matches.map((e) => e.location).filter((l): l is string => !!l))];
    if (locations.length === 1) item.location = locations[0];
    const periods = matches.flatMap((e) => readPeriods(e.period_variants));
    const kept = periods.some((p) => looseKey(p) === looseKey(item.period ?? ""));
    if (!kept && matches.length === 1 && periods.length > 0) item.period = periods[0];
  }
  return resume;
}
