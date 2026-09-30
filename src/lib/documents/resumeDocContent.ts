import "server-only";
import type { GeneratedResume } from "@/lib/resumes/generateResume";
import type { ResumeContact } from "@/lib/resumes/contact";

// 姓名、聯絡資訊的型別跟格式放在 lib/resumes/contact.ts（畫布、求職信也要用，不能是 server-only）。
export type { ResumeContact } from "@/lib/resumes/contact";
export { pickName, contactParts, buildContactLine, CONTACT_SEPARATOR } from "@/lib/resumes/contact";

export interface ResumeDocInput {
  contact: ResumeContact;
  resume: GeneratedResume["resume"];
  language: string;
}

const LABELS: Record<string, Record<string, string>> = {
  en: {
    summary: "PROFESSIONAL SUMMARY",
    experience: "PROFESSIONAL EXPERIENCE",
    leadership: "LEADERSHIP EXPERIENCE / PROJECTS",
    education: "EDUCATION",
    skills: "ADDITIONAL INFORMATION",
    computer: "Computer:",
  },
  zh: {
    summary: "專業摘要",
    experience: "工作經歷",
    leadership: "領導經驗／專案",
    education: "學歷",
    skills: "其他資訊",
    computer: "技能：",
  },
};

export function getLabels(language: string) {
  return LABELS[language] ?? LABELS.en;
}
