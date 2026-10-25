import "server-only";
import * as OpenCC from "opencc-js";

// AI 回覆偶爾會混進簡體字（prompt 寫了「全程繁體」也擋不乾淨），所以中文輸出一律再用 OpenCC
// 轉一次台灣繁體。只轉字形（cn → tw），不換用詞，避免把使用者原本的說法改掉；英文、數字不受影響。
const convert = OpenCC.Converter({ from: "cn", to: "tw" });

// 簡繁共用的字 OpenCC 也會轉成另一個字（台→臺、儀表板→儀錶板），台灣一般不這樣寫。
// 原文就是這些字的，轉完換回原文。
const KEEP_AS_IS = new Set(["台", "表"]);

export function toTraditional(text: string): string;
export function toTraditional(text: string | null): string | null;
export function toTraditional(text: string | null): string | null {
  if (text === null) return null;
  const converted = convert(text);
  const source = Array.from(text);
  const out = Array.from(converted);
  // OpenCC cn→tw 是一字對一字，長度不同就不換回，避免對錯位置。
  if (out.length !== source.length) return converted;
  return out.map((ch, i) => (KEEP_AS_IS.has(source[i]) ? source[i] : ch)).join("");
}
