// 中文句子裡的標點一律用全形（寫作準則：不能半形逗號、句號混雜）。AI 偶爾還是會混進半形，
// 這裡用程式再修一次：只動「緊接在中文字後面」的標點，英文句子、數字（1,200、2.1）、網址、Email 都不會被改到。

const CJK = "[\\u4e00-\\u9fff\\u3000-\\u303f\\uff00-\\uffef]";

const RULES: [RegExp, string][] = [
  [new RegExp(`(${CJK})\\s*,\\s*`, "gu"), "$1，"],
  // 逗號後面緊接中文字也算（例如「提升到 4.6,用戶」），數字裡的千分位逗號後面是數字，不會被改到。
  [new RegExp(`\\s*,\\s*(?=${CJK})`, "gu"), "，"],
  [new RegExp(`(${CJK})\\s*;\\s*`, "gu"), "$1；"],
  [new RegExp(`(${CJK})\\s*:\\s*`, "gu"), "$1："],
  [new RegExp(`(${CJK})\\s*!`, "gu"), "$1！"],
  [new RegExp(`(${CJK})\\s*\\?`, "gu"), "$1？"],
  // 句號：中文字後面接「.」、而且後面是空白或結尾才算句號（避免動到 App.js 這類字）。
  [new RegExp(`(${CJK})\\.(?:[ \\t]+|(?=\\n|$))`, "gmu"), "$1。"],
  // 括號：前面是中文字的半形括號整組換成全形。
  [new RegExp(`(${CJK})\\s*\\(([^()\\n]*)\\)`, "gu"), "$1（$2）"],
];

export function toFullWidthPunctuation(text: string): string {
  return RULES.reduce((t, [re, to]) => t.replace(re, to), text);
}
