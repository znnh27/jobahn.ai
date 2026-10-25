// 履歷各區塊的標題。畫布、經歷資料庫、Word／PDF 共用同一份，畫面跟下載的檔案才會一致。
// 使用者可以點標題自己改（存在 profile_data.data.section_labels，全帳號共用、中英文分開），
// 沒改過的、或改成空白的，用這裡的預設值。
export const SECTION_LABELS: Record<string, Record<string, string>> = {
  en: {
    summary: "PROFESSIONAL SUMMARY",
    experience: "PROFESSIONAL EXPERIENCE",
    leadership: "LEADERSHIP EXPERIENCE / PROJECTS",
    education: "EDUCATION",
    skills: "ADDITIONAL INFORMATION",
    computer: "Computer:",
    languages: "Languages:",
  },
  zh: {
    summary: "專業摘要",
    experience: "工作經歷",
    leadership: "領導經驗與專案",
    education: "學歷",
    skills: "其他資訊",
    computer: "技能：",
    languages: "語言：",
  },
};

export type SectionLabelKey = "summary" | "experience" | "leadership" | "education" | "skills" | "computer" | "languages";

export const SECTION_LABEL_KEYS: SectionLabelKey[] = [
  "summary",
  "experience",
  "leadership",
  "education",
  "skills",
  "computer",
  "languages",
];

/** 使用者改過的標題（只存改過的那幾個）。 */
export type CustomSectionLabels = Partial<Record<SectionLabelKey, string>>;

export const SECTION_LABEL_MAX_LENGTH = 60;

export function readCustomSectionLabels(profile: unknown): Record<"zh" | "en", CustomSectionLabels> {
  const raw = (profile as { section_labels?: unknown } | null)?.section_labels as Record<string, unknown> | undefined;
  const pick = (lang: "zh" | "en"): CustomSectionLabels => {
    const src = raw?.[lang] as Record<string, unknown> | undefined;
    const out: CustomSectionLabels = {};
    for (const key of SECTION_LABEL_KEYS) {
      const v = src?.[key];
      if (typeof v === "string" && v.trim()) out[key] = v.trim().slice(0, SECTION_LABEL_MAX_LENGTH);
    }
    return out;
  };
  return { zh: pick("zh"), en: pick("en") };
}

export function getSectionLabels(language: string, custom?: CustomSectionLabels): Record<string, string> {
  return { ...(SECTION_LABELS[language] ?? SECTION_LABELS.en), ...custom };
}
