// 履歷各區塊的標題。畫布、經歷資料庫、Word／PDF 共用同一份，畫面跟下載的檔案才會一致。
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
    leadership: "領導經驗／專案",
    education: "學歷",
    skills: "其他資訊",
    computer: "技能：",
    languages: "語言：",
  },
};

export function getSectionLabels(language: string): Record<string, string> {
  return SECTION_LABELS[language] ?? SECTION_LABELS.en;
}
