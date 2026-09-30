import "server-only";
import * as OpenCC from "opencc-js";

// AI 回覆偶爾會混進簡體字（prompt 寫了「全程繁體」也擋不乾淨），所以中文輸出一律再用 OpenCC
// 轉一次台灣繁體。只轉字形（cn → tw），不換用詞，避免把使用者原本的說法改掉；英文、數字不受影響。
const convert = OpenCC.Converter({ from: "cn", to: "tw" });

export function toTraditional(text: string): string;
export function toTraditional(text: string | null): string | null;
export function toTraditional(text: string | null): string | null {
  return text === null ? null : convert(text);
}
