// 用程式判斷一段文字是中文還是英文，不問 AI。
// 中文句子常夾英文工具名（Figma、A/B 測試），英文句子偶爾有中文公司名，所以比的是「中文字數」對「英文單字數」：
// 中文字比英文單字多就算中文。

export type TextLanguage = "zh" | "en";

export function textLanguage(text: string): TextLanguage | null {
  const cjk = (text.match(/[㐀-鿿]/g) ?? []).length;
  const words = (text.match(/[A-Za-z]+/g) ?? []).length;
  if (cjk === 0 && words === 0) return null;
  return cjk > words ? "zh" : "en";
}

/**
 * 整份內容（例如一份上傳的履歷）的語言：逐行判斷，八成以上的行是同一個語言才算數；
 * 中英混合的內容（雙語履歷）回傳 null。
 */
export function contentLanguage(text: string): TextLanguage | null {
  let zh = 0;
  let en = 0;
  for (const line of text.split("\n")) {
    const lang = textLanguage(line);
    if (lang === "zh") zh += 1;
    else if (lang === "en") en += 1;
  }
  const total = zh + en;
  if (total === 0) return null;
  if (zh / total >= 0.8) return "zh";
  if (en / total >= 0.8) return "en";
  return null;
}
