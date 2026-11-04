// 求職信長度：跟求職網站一樣算字元，空格、標點、換行都算（2026-11-04 從「英文算 words、中文不含空白」改過來，
// 原本的算法跟網站對不上，英文填的上限會被當成 words，等於沒限制到）。署名下面的聯絡方式那一行不算（見 withoutContactLine）。
// 畫面上顯示的字數、生成時的「字數上限」、「跟 AI 聊」要求的字數都用同一套算法。

export function letterLength(text: string): number {
  return [...text.replace(/\r\n/g, "\n")].length;
}

export const LETTER_LENGTH_UNIT = "字";

/**
 * 字數不算署名下面的聯絡方式那一行：求職網站本身有聯絡資料欄位，貼上去時會拿掉（2026-11-04 Z）。
 * 信裡找不到那一行（使用者自己改過）就整封算。
 */
export function withoutContactLine(letter: string, contactLine: string): string {
  const at = contactLine ? letter.lastIndexOf(contactLine) : -1;
  if (at < 0) return letter;
  return `${letter.slice(0, at).replace(/\n$/, "")}${letter.slice(at + contactLine.length)}`.trimEnd();
}

/** 英文平均一個 word 大約 6 個字元（含後面的空格），給 AI 抓篇幅用。 */
export function approxWords(chars: number): number {
  return Math.round(chars / 6);
}

/** 告訴 AI 的上限打 9 折：AI 數字元不準，常常多寫一點，留緩衝。程式檢查還是用原本的上限。 */
export function promptLimit(limit: number): number {
  return Math.floor(limit * 0.9);
}

/**
 * AI 寫完由程式量長度，超過上限就把實際字數告訴 AI 請它縮短，最多重寫 2 次（以前只重寫 1 次，常常還是超過）。
 * 還是超過就照樣回傳 over: true，由畫面提醒使用者，不會悄悄交出來。生成求職信跟「跟 AI 聊」共用。
 */
export async function shortenUntilFits<T>(
  first: T,
  limit: number,
  measure: (result: T) => number,
  retry: (previous: T, length: number) => Promise<T>,
): Promise<{ result: T; length: number; over: boolean }> {
  let result = first;
  let length = measure(result);
  for (let attempt = 0; attempt < 2 && length > limit; attempt++) {
    result = await retry(result, length);
    length = measure(result);
  }
  return { result, length, over: length > limit };
}

/**
 * 求職信字數上限可以填的範圍。下限是「四段式求職信至少要這麼長才寫得完整」：
 * 上限設 50 字時 AI 只能擠出電報式的句子（真實發生過），所以中文至少 200 字、英文至少 700 字（大約 120 words）。
 */
export const WORD_LIMIT_MAX = 5000;

export function wordLimitMin(lang: string): number {
  return lang === "zh" ? 200 : 700;
}

export function isValidWordLimit(lang: string, n: number): boolean {
  return Number.isInteger(n) && n >= wordLimitMin(lang) && n <= WORD_LIMIT_MAX;
}
