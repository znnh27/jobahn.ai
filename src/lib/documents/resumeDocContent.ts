import "server-only";
import type { GeneratedResume } from "@/lib/resumes/generateResume";
import type { ResumeContact } from "@/lib/resumes/contact";
import { getSectionLabels, type CustomSectionLabels } from "@/lib/resumes/sectionLabels";

// 姓名、聯絡資訊的型別跟格式放在 lib/resumes/contact.ts（畫布、求職信也要用，不能是 server-only）。
export type { ResumeContact } from "@/lib/resumes/contact";
export { pickName, contactParts, buildContactLine, CONTACT_SEPARATOR } from "@/lib/resumes/contact";

export interface ResumeDocInput {
  contact: ResumeContact;
  resume: GeneratedResume["resume"];
  language: string;
  /** 使用者改過的區塊標題（這個語言的），沒改過的用預設。 */
  labels?: CustomSectionLabels;
}


export function getLabels(language: string, custom?: CustomSectionLabels) {
  return getSectionLabels(language, custom);
}
