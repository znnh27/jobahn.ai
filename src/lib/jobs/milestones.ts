// 求職進度（首頁應徵紀錄表格的四個勾選框）跟上方漏斗的計算。畫面、server action 共用。
// 「回覆 get」是 2026-10-27 加的：公司有任何回應就算（HR 來信、電話初談、約時間），正式面試排定才算「面試 get」。
// 日期一律用台北時間顯示、算天數。

export type MilestoneKey = "submitted" | "replied" | "interview" | "offer";

export const MILESTONES: {
  key: MilestoneKey;
  label: string;
  field: "submitted_at" | "replied_at" | "interview_at" | "offer_at";
}[] = [
  { key: "submitted", label: "投出去了", field: "submitted_at" },
  { key: "replied", label: "回覆 get", field: "replied_at" },
  { key: "interview", label: "面試 get", field: "interview_at" },
  { key: "offer", label: "Offer get!", field: "offer_at" },
];

/**
 * 漏斗箭頭滑過時的說明（2026-10-27 Z 定案文案）：這段轉換率偏低，通常是哪裡出問題、可以檢查什麼。
 * key 是箭頭指向的那一關。
 */
export const FUNNEL_STEP_TIPS: Partial<Record<MilestoneKey, string[]>> = {
  replied: ["回覆率看的是履歷有沒有打中職缺", "偏低的話，檢查關鍵字、成果有沒有數字，或是不是投得太廣"],
  interview: ["這段通常是 HR 電話初談", "偏低的話，檢查自我介紹、期望薪資、到職日這些基本問題怎麼回答"],
  offer: ["看的是面試表現跟職位適不適合", "偏低的話，回想卡在哪一題，準備作品或案例說明"],
};

const TAIPEI = "Asia/Taipei";

/** 台北時間的 yyyy-mm-dd（給 <input type="date"> 跟算天數用）。 */
export function taipeiDateKey(iso: string): string {
  // en-CA 的日期格式剛好是 yyyy-mm-dd。
  return new Intl.DateTimeFormat("en-CA", { timeZone: TAIPEI, year: "numeric", month: "2-digit", day: "2-digit" }).format(
    new Date(iso),
  );
}

/** 表格顯示用：2026/10/23。 */
export function formatTaipeiDate(iso: string): string {
  return taipeiDateKey(iso).replaceAll("-", "/");
}

/** 勾選框旁邊的短日期：10/23。 */
export function formatTaipeiShortDate(iso: string): string {
  const [, m, d] = taipeiDateKey(iso).split("-");
  return `${Number(m)}/${Number(d)}`;
}

/** 使用者在日期選擇器選的 yyyy-mm-dd，存成台北中午（避免換時區時跳到前一天或後一天）。 */
export function dateKeyToIso(dateKey: string): string {
  return new Date(`${dateKey}T12:00:00+08:00`).toISOString();
}

/** 兩個時間差幾天（用台北的日期算，不看幾點）。 */
function daysBetween(fromIso: string, toIso: string): number {
  const a = Date.parse(`${taipeiDateKey(fromIso)}T00:00:00Z`);
  const b = Date.parse(`${taipeiDateKey(toIso)}T00:00:00Z`);
  return Math.round((b - a) / 86400000);
}

export interface MilestoneRow {
  submitted_at: string | null;
  replied_at: string | null;
  interview_at: string | null;
  offer_at: string | null;
}

export interface FunnelStage {
  key: MilestoneKey;
  label: string;
  count: number;
  /** 從上一關到這一關的轉換率（0–100）。第一關、或上一關是 0 筆，是 null。 */
  rate: number | null;
  /** 從上一關到這一關平均幾天。第一關、或沒有任何一筆兩關都有日期的，是 null。 */
  avgDays: number | null;
}

/**
 * 漏斗：每一關有幾筆，跟上一關比的轉換率、平均天數（投出去 → 面試、面試 → Offer）。
 * 平均天數只算兩關都有日期、而且順序合理（不是負的）的紀錄。
 */
export function computeFunnel(rows: MilestoneRow[]): FunnelStage[] {
  // 走到後面的關卡，就算前面的沒勾也算有經過（例如加「回覆 get」之前就勾了面試的舊紀錄），轉換率才不會超過 100%。
  const reached = (r: MilestoneRow, i: number) => MILESTONES.slice(i).some((m) => r[m.field]);
  return MILESTONES.map(({ key, label, field }, i) => {
    const count = rows.filter((r) => reached(r, i)).length;
    if (i === 0) return { key, label, count, rate: null, avgDays: null };
    const prevField = MILESTONES[i - 1].field;
    const prevCount = rows.filter((r) => reached(r, i - 1)).length;
    const spans = rows
      .filter((r) => r[prevField] && r[field])
      .map((r) => daysBetween(r[prevField]!, r[field]!))
      .filter((d) => d >= 0);
    return {
      key,
      label,
      count,
      rate: prevCount > 0 ? Math.round((count / prevCount) * 100) : null,
      avgDays: spans.length > 0 ? Math.round(spans.reduce((a, b) => a + b, 0) / spans.length) : null,
    };
  });
}

/** 這筆應徵目前走到哪一關（給「求職進度」欄的標籤用）。 */
export function currentStage(row: MilestoneRow): MilestoneKey | null {
  if (row.offer_at) return "offer";
  if (row.interview_at) return "interview";
  if (row.replied_at) return "replied";
  if (row.submitted_at) return "submitted";
  return null;
}
