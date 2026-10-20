// 履歷字級（單位 pt），照一份實際投遞過的參考履歷抓的：
// 英文內文 11pt、行距至少 14pt；中文內文 10pt、固定行距 16pt；姓名 18pt。
// 聯絡資訊參考檔只有 8pt 太小，這裡放大到 10pt。
// 畫布（ResumePageCanvas 用 CSS 變數套）、Word、PDF 三邊都用 resolveMetrics() 算出來的同一組數字。
// 「超出一頁」是量下載用的 PDF 決定的（measureResumePdf.tsx），Word 盡量跟 PDF 對齊。

export interface ResumeTypography {
  name: number;
  contact: number;
  header: number;
  body: number;
  /** 一行的高度（pt）。 */
  line: number;
}

export const RESUME_TYPOGRAPHY: Record<"en" | "zh", ResumeTypography> = {
  en: { name: 18, contact: 10, header: 12, body: 11, line: 14 },
  zh: { name: 18, contact: 10, header: 11, body: 10, line: 16 },
};

export function getTypography(language: string): ResumeTypography {
  return language === "zh" ? RESUME_TYPOGRAPHY.zh : RESUME_TYPOGRAPHY.en;
}

/** pt → 96 dpi 畫布上的 px。 */
export function ptToPx(pt: number): number {
  return (pt * 96) / 72;
}

// ---------- 使用者可調的排版：內文字級 + 間距 ----------

export type ResumeSpacing = "tight" | "normal" | "loose";

/** 存在每個語言版本的履歷 JSON 裡（resume.layout），沒有就用預設值。 */
export interface ResumeLayoutSettings {
  /** 內文（bullet）字級，其他字級跟著等比縮放。 */
  bodyPt: number;
  spacing: ResumeSpacing;
  /** 抬頭聯絡資訊的字級。沒設就跟著內文等比縮放；網址很長、斷行難看時使用者可以單獨調小。 */
  contactPt?: number;
}

export const BODY_PT_MIN = 9;
export const BODY_PT_MAX = 12;
export const BODY_PT_STEP = 0.5;
export const CONTACT_PT_MIN = 7;
export const CONTACT_PT_MAX = 12;

export const SPACING_OPTIONS: { value: ResumeSpacing; label: string }[] = [
  { value: "tight", label: "緊湊" },
  { value: "normal", label: "標準" },
  { value: "loose", label: "寬鬆" },
];

// 間距只動「段落之間」的距離跟一點點行距，字級不變也能擠掉一兩行。
// 英文 Word 的 Calibri 自然行高大約是字級的 1.22 倍，行距再壓就會被 Word 撐開、跟 PDF 對不上，所以緊湊只壓 4%。
const SPACING_FACTORS: Record<ResumeSpacing, { gap: number; line: number }> = {
  tight: { gap: 0.5, line: 0.96 },
  normal: { gap: 1, line: 1 },
  loose: { gap: 1.5, line: 1.08 },
};

// 預設（標準間距、預設字級）時各段落之間的距離，單位 pt。
const BASE_GAPS = {
  /** 聯絡資訊上下。 */
  contactBefore: 2,
  contactAfter: 6,
  /** 區塊標題（PROFESSIONAL EXPERIENCE 等）上方、底線下方。 */
  sectionBefore: 8,
  sectionAfter: 3,
  /** 每段經歷／學歷之間。 */
  block: 5,
};

export function defaultLayoutSettings(language: string): ResumeLayoutSettings {
  return { bodyPt: getTypography(language).body, spacing: "normal" };
}

/** 讀 resume.layout，缺的、超出範圍的都修正回合法值。 */
export function readLayoutSettings(raw: unknown, language: string): ResumeLayoutSettings {
  const fallback = defaultLayoutSettings(language);
  const r = (raw ?? {}) as Partial<ResumeLayoutSettings>;
  const bodyPt =
    typeof r.bodyPt === "number" && Number.isFinite(r.bodyPt)
      ? Math.min(BODY_PT_MAX, Math.max(BODY_PT_MIN, Math.round(r.bodyPt / BODY_PT_STEP) * BODY_PT_STEP))
      : fallback.bodyPt;
  const spacing = r.spacing && r.spacing in SPACING_FACTORS ? r.spacing : fallback.spacing;
  const contactPt =
    typeof r.contactPt === "number" && Number.isFinite(r.contactPt)
      ? Math.min(CONTACT_PT_MAX, Math.max(CONTACT_PT_MIN, Math.round(r.contactPt / BODY_PT_STEP) * BODY_PT_STEP))
      : undefined;
  return contactPt === undefined ? { bodyPt, spacing } : { bodyPt, spacing, contactPt };
}

/**
 * 使用者在經歷資料庫調的排版，存在 profile_data.data.resume_layout（{ zh: {...}, en: {...} }）。
 * 經歷資料庫照這個顯示，之後新生成的履歷也用它當預設值。
 */
export function readLayoutDefaults(profileData: unknown): Partial<Record<"zh" | "en", ResumeLayoutSettings>> {
  const raw = ((profileData ?? {}) as { resume_layout?: Record<string, unknown> }).resume_layout ?? {};
  const out: Partial<Record<"zh" | "en", ResumeLayoutSettings>> = {};
  for (const lang of ["zh", "en"] as const) {
    if (raw[lang]) out[lang] = readLayoutSettings(raw[lang], lang);
  }
  return out;
}

export interface ResumeMetrics extends ResumeTypography {
  contactBefore: number;
  contactAfter: number;
  sectionBefore: number;
  sectionAfter: number;
  block: number;
}

/** 依語言跟使用者的排版設定，算出這份履歷實際要用的字級、行距、間距（pt）。 */
export function resolveMetrics(language: string, raw?: unknown): ResumeMetrics {
  const base = getTypography(language);
  const settings = readLayoutSettings(raw, language);
  const scale = settings.bodyPt / base.body;
  const f = SPACING_FACTORS[settings.spacing];
  const round = (n: number) => Math.round(n * 100) / 100;
  return {
    name: round(base.name * scale),
    // 抬頭字級取到 0.5pt，排版選單上顯示、加減才會是整齊的數字。
    contact: settings.contactPt ?? Math.round(base.contact * scale * 2) / 2,
    header: round(base.header * scale),
    body: settings.bodyPt,
    line: round(base.line * scale * f.line),
    contactBefore: round(BASE_GAPS.contactBefore * scale * f.gap),
    contactAfter: round(BASE_GAPS.contactAfter * scale * f.gap),
    sectionBefore: round(BASE_GAPS.sectionBefore * scale * f.gap),
    sectionAfter: round(BASE_GAPS.sectionAfter * scale * f.gap),
    block: round(BASE_GAPS.block * scale * f.gap),
  };
}

// ---------- 分頁標記 ----------
// 畫布跟 PDF 上的每一行內容都掛同一個 key（畫布是 data-pdf-key，PDF 是 View 的 data-k），
// 量 PDF 得知「第一個掉到第二頁的是哪一條」之後，畫布就能把紅色虛線畫在那一條上方。

export type ResumeSectionKey = "work_experience" | "leadership";

export const pdfKey = {
  name: () => "name",
  contact: () => "contact",
  header: (id: string) => `h:${id}`,
  summary: () => "summary",
  org: (section: ResumeSectionKey, i: number) => `${section}:${i}:org`,
  role: (section: ResumeSectionKey, i: number) => `${section}:${i}:role`,
  bullet: (section: ResumeSectionKey, i: number, j: number) => `${section}:${i}:b:${j}`,
  school: (i: number) => `education:${i}:school`,
  eduDetail: (i: number) => `education:${i}:detail`,
  skills: () => "skills",
  languages: () => "languages",
};

/** 量 PDF 的結果。 */
export interface PdfFit {
  pages: number;
  /** 第二頁之後的內容總高度（pt），0 = 一頁塞得下。 */
  overflowPt: number;
  /** 第一個（或第一個被切開的）落到第二頁的內容。 */
  breakAt: { key: string; linesBefore: number } | null;
  /** 第一頁內容區用了幾成（0–1，超出一頁就是 1）。生成履歷時用來判斷要不要補內容。 */
  fillRatio: number;
}
