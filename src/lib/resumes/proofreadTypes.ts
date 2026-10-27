import type { GeneratedResume } from "./generateResume";
import { addCjkSpacing } from "@/lib/text/cjkSpacing";
import { toFullWidthPunctuation } from "@/lib/text/fullWidthPunctuation";

// 「校稿」（履歷頁、求職信頁）的資料格式跟套用方式。伺服器、畫面都會用，所以不放 server-only 的東西。
// 檢查本身在 proofread.ts。

type Resume = GeneratedResume["resume"];

export type ProofreadCategory = "typo" | "format" | "fact" | "consistency";

export const PROOFREAD_CATEGORY_LABEL: Record<ProofreadCategory, string> = {
  typo: "錯字文法",
  format: "格式",
  fact: "事實",
  consistency: "前後不一",
};

export interface ProofreadIssue {
  id: string;
  category: ProofreadCategory;
  /** 履歷：問題在哪一格（見 resumeFields）；求職信是 null。 */
  field: string | null;
  /** 畫面上顯示的位置，例如「摘要」「網際威信 第 2 條」；求職信是 null。 */
  where: string | null;
  /** 原文裡有問題的那一段，一字不差。 */
  quote: string;
  /** 換成這段；空字串是刪掉；null 是沒辦法直接改（例如缺一個數字），只提醒。 */
  replacement: string | null;
  reason: string;
}

export interface ResumeField {
  id: string;
  label: string;
  text: string;
}

type EntrySection = "work_experience" | "leadership";

/** 位置標籤用的短公司名：拿掉括號說明跟「股份有限公司」，「網際威信股份有限公司 （金融科技公司）」→「網際威信」。 */
function shortOrg(org: string): string {
  return org.replace(/\s*[（(][^）)]*[）)]/g, "").replace(/(股份)?有限公司.*$/, "").trim() || org;
}

/** 履歷裡可以校稿的每一格（摘要、職稱、bullet、技能），依畫面上由上到下的順序。學歷、語言是照資料一字不改放的，不校。 */
export function resumeFields(resume: Resume): ResumeField[] {
  const fields: ResumeField[] = [];
  if (resume.summary) fields.push({ id: "summary", label: "摘要", text: resume.summary });
  for (const section of ["work_experience", "leadership"] as EntrySection[]) {
    resume[section].forEach((entry, i) => {
      if (entry.role) fields.push({ id: `${section}.${i}.role`, label: `${shortOrg(entry.org)} 職稱`, text: entry.role });
      entry.bullets.forEach((bullet, j) =>
        fields.push({ id: `${section}.${i}.bullets.${j}`, label: `${shortOrg(entry.org)} 第 ${j + 1} 條`, text: bullet }),
      );
    });
  }
  resume.skills.forEach((skill, k) => fields.push({ id: `skills.${k}`, label: "技能", text: skill }));
  return fields;
}

/** 把某一格換成新的文字；bullet、技能換成空的就整條拿掉。 */
function setResumeField(resume: Resume, id: string, text: string): Resume {
  const parts = id.split(".");
  if (parts[0] === "summary") return { ...resume, summary: text };
  if (parts[0] === "skills") {
    const k = Number(parts[1]);
    return {
      ...resume,
      skills: text.trim() ? resume.skills.map((s, i) => (i === k ? text : s)) : resume.skills.filter((_, i) => i !== k),
    };
  }
  const section = parts[0] as EntrySection;
  const i = Number(parts[1]);
  const items = [...resume[section]];
  if (parts[2] === "role") {
    items[i] = { ...items[i], role: text };
  } else {
    const j = Number(parts[3]);
    const bullets = items[i].bullets;
    items[i] = {
      ...items[i],
      bullets: text.trim() ? bullets.map((b, k) => (k === j ? text : b)) : bullets.filter((_, k) => k !== j),
    };
  }
  return { ...resume, [section]: items };
}

/**
 * 原文在 text 裡實際的樣子（畫布上標示、套用都用這個找）：先套用了格式卡（補空格、換全形標點）的話，同一句的其他建議要照補過的樣子找。
 * 都找不到回 null。
 */
export function locate(text: string, issue: ProofreadIssue): { quote: string; replacement: string | null } | null {
  const fixed = (t: string) => addCjkSpacing(toFullWidthPunctuation(t));
  if (text.includes(issue.quote)) return { quote: issue.quote, replacement: issue.replacement };
  const quote = fixed(issue.quote);
  if (!text.includes(quote)) return null;
  return { quote, replacement: issue.replacement === null ? null : fixed(issue.replacement) };
}

/** 一段文字裡把 quote 換成 replacement；找不到 quote（使用者已經改過）回 null。 */
export function applyToText(text: string, issue: ProofreadIssue): string | null {
  const found = locate(text, issue);
  if (!found || found.replacement === null) return null;
  const next = text.replace(found.quote, found.replacement);
  // 整句刪掉時，順手收掉留下的連續空白、空行。
  return issue.replacement === "" ? next.replace(/[ \t]{2,}/g, " ").replace(/\n{3,}/g, "\n\n") : next;
}

/** 這項建議現在在履歷的哪一格：先找 AI 指的那一格，找不到再全部找一次（套用過別項、刪掉一條之後，後面的 bullet 位置會往前移）。 */
function findResumeField(resume: Resume, issue: ProofreadIssue): ResumeField | null {
  const fields = resumeFields(resume);
  return fields.find((f) => f.id === issue.field && locate(f.text, issue)) ?? fields.find((f) => locate(f.text, issue)) ?? null;
}

/** 畫布上要標在哪幾格：key 是格子代號，技能在畫布上是同一行，全部算 "skills"（見 ResumePageCanvas）。 */
export function resumeMarks(resume: Resume, issues: ProofreadIssue[]): Map<string, ProofreadIssue[]> {
  const marks = new Map<string, ProofreadIssue[]>();
  for (const issue of issues) {
    const field = findResumeField(resume, issue);
    if (!field) continue;
    const key = field.id.startsWith("skills.") ? "skills" : field.id;
    marks.set(key, [...(marks.get(key) ?? []), issue]);
  }
  return marks;
}

/**
 * 套用到履歷：先找 AI 指的那一格，找不到再全部找一次（套用過別項、刪掉一條之後，後面的 bullet 位置會往前移）。
 * 原文已經不在了回 null。
 */
export function applyToResume(resume: Resume, issue: ProofreadIssue): Resume | null {
  const target = findResumeField(resume, issue);
  if (!target) return null;
  const next = applyToText(target.text, issue);
  return next === null ? null : setResumeField(resume, target.id, next.trim());
}

/**
 * 建議清單上的卡片：格式問題合成一張（key 是 "format"），其他一項一張（key 是 id），照清單順序。
 * 畫面上點哪一張，畫布就標出那張卡的建議（見 ProofreadMarks.tsx）。
 */
export const FORMAT_CARD = "format";

export function proofreadCardKeys(issues: ProofreadIssue[]): string[] {
  const others = issues.filter((i) => i.category !== "format").map((i) => i.id);
  return issues.some((i) => i.category === "format") ? [FORMAT_CARD, ...others] : others;
}

export function issuesForCard(issues: ProofreadIssue[], key: string | null): ProofreadIssue[] {
  if (key === FORMAT_CARD) return issues.filter((i) => i.category === "format");
  return issues.filter((i) => i.id === key);
}

/** 處理掉一張卡之後要選哪一張：同一個位置的下一張，沒有就上一張。 */
export function nextCardKey(keysBefore: string[], removed: string, keysAfter: string[]): string | null {
  const at = keysBefore.indexOf(removed);
  const after = keysBefore.slice(at + 1).find((k) => keysAfter.includes(k));
  const before = [...keysBefore.slice(0, Math.max(0, at))].reverse().find((k) => keysAfter.includes(k));
  return after ?? before ?? null;
}
