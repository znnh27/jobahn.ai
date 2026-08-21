import "server-only";
import type { GeneratedResume } from "@/lib/resumes/generateResume";

export interface ResumeContact {
  name_zh: string | null;
  name_en: string | null;
  email: string | null;
  phone: string | null;
  linkedin: string | null;
  portfolio: string | null;
}

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

export function pickName(contact: ResumeContact, language: string): string {
  const primary = language === "zh" ? contact.name_zh : contact.name_en;
  return primary || contact.name_zh || contact.name_en || "";
}

export function buildContactLine(contact: ResumeContact): string {
  const parts: string[] = [];
  if (contact.email) parts.push(`Email: ${contact.email}`);
  if (contact.phone) parts.push(`Phone: ${contact.phone}`);
  if (contact.linkedin) parts.push(`LinkedIn: ${contact.linkedin}`);
  if (contact.portfolio) parts.push(`Portfolio: ${contact.portfolio}`);
  return parts.join("   /   ");
}
