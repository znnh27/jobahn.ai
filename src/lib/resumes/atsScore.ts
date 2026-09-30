// ATS 分數由程式照固定公式算，不讓 AI 打分（AI 打的分數同一份內容每次都會差幾分）。
// 公式：必要條件每項 2 分、加分條件每項 1 分，已寫到的加總 ÷ 滿分 × 100。
// 每一項是必要還是加分，在第一次建立 JD 條件清單時由 AI 標好，之後固定不變。
// 前端（顯示每個語言各自的分數）跟後端（存進資料庫）都用這一份。

export type JdImportance = "required" | "preferred";

export interface ScorableItem {
  covered: boolean;
  source?: "resume" | "cover_letter" | null;
  /** 舊資料沒有這個欄位，當成必要條件。 */
  importance?: JdImportance | null;
}

const WEIGHT: Record<JdImportance, number> = { required: 2, preferred: 1 };

/** 這一項在「履歷本身」有沒有寫到。舊資料裡被求職信補上的項目，在履歷頁不算。 */
export function coveredByResume(item: ScorableItem): boolean {
  return item.covered && item.source !== "cover_letter";
}

function weightOf(item: ScorableItem): number {
  return WEIGHT[item.importance ?? "required"];
}

/**
 * 算分數。onlyResume = true 時只算履歷本身寫到的（履歷頁），
 * false 時履歷＋求職信合起來算（求職信頁）。清單是空的回傳 null。
 */
export function computeAtsScore(items: ScorableItem[], onlyResume = true): number | null {
  if (items.length === 0) return null;
  const total = items.reduce((sum, i) => sum + weightOf(i), 0);
  const got = items
    .filter((i) => (onlyResume ? coveredByResume(i) : i.covered))
    .reduce((sum, i) => sum + weightOf(i), 0);
  return Math.round((got / total) * 100);
}
