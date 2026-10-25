// 寫作準則：中文字跟英文、數字之間加一個半形空格（例如「我有 3 台 iPhone」）。AI 偶爾會漏，
// 這裡用程式補：只在「中文字緊接英文字母或數字」的地方加，標點、符號（%、$、/）旁邊不動。

const CJK = "\\u4e00-\\u9fff\\u3400-\\u4dbf";

export function addCjkSpacing(text: string): string {
  return text
    .replace(new RegExp(`([${CJK}])([A-Za-z0-9])`, "gu"), "$1 $2")
    .replace(new RegExp(`([A-Za-z0-9%])([${CJK}])`, "gu"), "$1 $2");
}
