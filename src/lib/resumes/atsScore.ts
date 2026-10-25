// ATS 分數由程式照固定公式算，不讓 AI 打分（AI 打的分數同一份內容每次都會差幾分）。
// 公式：必要條件每項 2 分、加分條件每項 1 分，已寫到的加總 ÷ 滿分 × 100；部分符合算一半
// （科系要求商管、使用者輔修商管；或一項裡綁了好幾個條件、做到一半以上但沒全部做到）。
// 每一項是必要還是加分，在第一次建立 JD 條件清單時由 AI 標好，之後固定不變。
// 履歷頁的分數只算「硬實力」（經歷、技能、學歷、語言、證照）：軟實力（主動積極、正直誠信…）履歷證明不了、
// 工作條件（出差、外派…）是意願不是能力，這兩類交給求職信，只在求職信頁的適配度算進去（2026-10-24 Z 定案）。
// AI 判定沒寫到卻說不出缺什麼（缺口空白）的項目標成 invalid，不算進分數，請使用者重新評分。
// 前端（顯示每個語言各自的分數）跟後端（存進資料庫）都用這一份。

export type JdImportance = "required" | "preferred";

/** requirement＝硬實力（要有事實佐證）；trait＝軟實力、人格特質；condition＝出差、外派這類工作條件。 */
export type JdItemKind = "requirement" | "trait" | "condition";

export interface ScorableItem {
  covered: boolean;
  source?: "resume" | "cover_letter" | null;
  /** 舊資料沒有這個欄位，當成必要條件。 */
  importance?: JdImportance | null;
  /** 沒有完全符合、但有相關條件撐著（例如輔修），算一半分數。 */
  partial?: boolean | null;
  /** 舊資料沒有這個欄位，當成硬實力。 */
  kind?: JdItemKind | null;
  /** AI 判斷有問題（判定沒寫到卻沒寫缺口），不算進分數。 */
  invalid?: boolean | null;
}

/** 這一項算不算進履歷頁的分數：只有硬實力，而且判斷沒問題。 */
export function countsForResume(item: ScorableItem): boolean {
  return (item.kind ?? "requirement") === "requirement" && !item.invalid;
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
 * 算分數。onlyResume = true 時只算硬實力、而且只算履歷本身寫到的（履歷頁），
 * false 時所有類別、履歷＋求職信合起來算（求職信頁）。沒有可以算的項目回傳 null。
 */
export function computeAtsScore(items: ScorableItem[], onlyResume = true): number | null {
  // 履歷頁只算硬實力；求職信頁軟實力、工作條件也算（求職信可以補）。判斷有問題的兩邊都不算。
  const pool = items.filter((i) => (onlyResume ? countsForResume(i) : !i.invalid));
  if (pool.length === 0) return null;
  const total = pool.reduce((sum, i) => sum + weightOf(i), 0);
  const got = pool.reduce((sum, i) => {
    if (onlyResume ? coveredByResume(i) : i.covered) return sum + weightOf(i);
    return i.partial ? sum + weightOf(i) / 2 : sum;
  }, 0);
  return Math.round((got / total) * 100);
}
