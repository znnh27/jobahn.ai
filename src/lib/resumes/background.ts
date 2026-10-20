// 經歷以外的履歷內容：Professional Summary、學歷、技能、語言能力。每個語言各一份，
// 存在 profile_data.data.background。上傳履歷時解析進來（mergeIntoExperienceDb.ts），
// 經歷資料庫頁可以直接編輯，生成履歷時當素材（generateResume.ts）。

export interface EducationItem {
  school: string;
  /** 學位、科系、輔修等，例如「B.A. in German Language and Culture, Minor in Finance」。 */
  detail: string | null;
  period: string | null;
  location: string | null;
}

export interface LanguageBackground {
  /** 每份履歷的 Summary 都留一種寫法，生成時當參考素材，不會原封不動照抄。 */
  summaries: string[];
  education: EducationItem[];
  skills: string[];
  /** 一個語言一條，程度寫在括號裡，例如「German (B2)」「中文（母語）」。 */
  languages: string[];
}

export type ResumeLanguage = "zh" | "en";
export type ProfileBackground = Record<ResumeLanguage, LanguageBackground>;

export const EMPTY_LANGUAGE_BACKGROUND: LanguageBackground = { summaries: [], education: [], skills: [], languages: [] };

function strings(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.filter((s): s is string => typeof s === "string" && s.trim() !== "").map((s) => s.trim()) : [];
}

function nullableString(raw: unknown): string | null {
  return typeof raw === "string" && raw.trim() ? raw.trim() : null;
}

function readEducation(raw: unknown): EducationItem[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((e) => {
      const item = (e ?? {}) as Record<string, unknown>;
      return {
        school: nullableString(item.school) ?? "",
        detail: nullableString(item.detail),
        period: nullableString(item.period),
        location: nullableString(item.location),
      };
    })
    .filter((e) => e.school);
}

export function readLanguageBackground(raw: unknown): LanguageBackground {
  const b = (raw ?? {}) as Record<string, unknown>;
  return {
    summaries: strings(b.summaries),
    education: readEducation(b.education),
    skills: strings(b.skills),
    languages: strings(b.languages),
  };
}

/** 從 profile_data.data 讀出 background，缺的欄位補空陣列。 */
export function readBackground(profileData: unknown): ProfileBackground {
  const raw = ((profileData ?? {}) as { background?: Record<string, unknown> }).background ?? {};
  return { zh: readLanguageBackground(raw.zh), en: readLanguageBackground(raw.en) };
}

export function isEmptyBackground(b: LanguageBackground): boolean {
  return !b.summaries.length && !b.education.length && !b.skills.length && !b.languages.length;
}

/** 兩個語言都還沒有學歷、技能、語言（例如沒有履歷、只跟 AI 聊過經歷的人）。 */
export function lacksBackground(profileData: unknown): boolean {
  const all = readBackground(profileData);
  return [all.zh, all.en].every((b) => !b.education.length && !b.skills.length && !b.languages.length);
}

/** 比對用：忽略大小寫、空白、標點，「Figma」「figma 」算同一個。 */
export function normalize(text: string): string {
  return text.toLowerCase().replace(/[\s\p{P}]/gu, "");
}

function unionStrings(existing: string[], incoming: string[]): string[] {
  const seen = new Set(existing.map(normalize));
  const result = [...existing];
  for (const s of incoming) {
    const key = normalize(s);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(s);
  }
  return result;
}

/** 同一間學校只留一筆：新內容補上舊資料缺的欄位，舊資料已經有的不覆蓋。 */
function mergeEducation(existing: EducationItem[], incoming: EducationItem[]): EducationItem[] {
  const result = existing.map((e) => ({ ...e }));
  for (const item of incoming) {
    const match = result.find((e) => normalize(e.school) === normalize(item.school));
    if (!match) {
      result.push(item);
      continue;
    }
    match.detail ??= item.detail;
    match.period ??= item.period;
    match.location ??= item.location;
  }
  return result;
}

/** 上傳新履歷時用：只會新增，不會刪掉或改掉已經有的內容。 */
export function mergeLanguageBackground(existing: LanguageBackground, incoming: LanguageBackground): LanguageBackground {
  return {
    summaries: unionStrings(existing.summaries, incoming.summaries),
    education: mergeEducation(existing.education, incoming.education),
    skills: unionStrings(existing.skills, incoming.skills),
    languages: unionStrings(existing.languages, incoming.languages),
  };
}

/**
 * 逗號分隔的文字轉成清單（畫布上技能、語言是一行文字編輯）。中文全形逗號、頓號也算。
 * 括號裡的逗號不切，「English (Fluent, TOEIC 900)」要留成一條。
 */
export function splitList(text: string): string[] {
  const items: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of text) {
    if ("(（".includes(ch)) depth++;
    if (")）".includes(ch)) depth = Math.max(0, depth - 1);
    if (depth === 0 && ",，、".includes(ch)) {
      items.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  items.push(current);
  return items.map((s) => s.trim()).filter(Boolean);
}

/** 清單接成一行：中文用「、」，英文用「, 」。跟 splitList 對應（兩種都切得開）。 */
export function joinList(items: string[], language: string): string {
  return items.join(language === "zh" ? "、" : ", ");
}
