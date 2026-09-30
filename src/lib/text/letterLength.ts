// 求職信長度：中文算字數（不含空白），英文算單字數。畫面上顯示的字數跟「字數上限」檢查用同一套算法。

export function letterLength(text: string, lang: string): number {
  if (lang === "zh") return text.replace(/\s/g, "").length;
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

export function letterLengthUnit(lang: string): string {
  return lang === "zh" ? "字" : "words";
}

/**
 * 求職信字數上限可以填的範圍。下限是「四段式求職信至少要這麼長才寫得完整」：
 * 上限設 50 字時 AI 只能擠出電報式的句子（真實發生過），所以中文至少 200 字、英文至少 120 words。
 */
export const WORD_LIMIT_MAX = 3000;

export function wordLimitMin(lang: string): number {
  return lang === "zh" ? 200 : 120;
}

export function isValidWordLimit(lang: string, n: number): boolean {
  return Number.isInteger(n) && n >= wordLimitMin(lang) && n <= WORD_LIMIT_MAX;
}
