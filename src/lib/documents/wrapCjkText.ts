import "server-only";
import path from "node:path";
import { openSync, type Font } from "fontkit";

// react-pdf 的自動換行對中文完全不友善：整段沒有空白的中文字會被當成一個超長「單字」，
// 要嘛直接超出頁面右邊界不換行，要嘛被內建斷字邏輯拆成一個個字之後在每個斷點畫一個「-」，
// 中文本來就不該出現這種連字號。所以中文內容改成自己先量字寬、算好斷行位置，用真正的換行字元
// 一行一行交給 react-pdf，讓它不需要再自動斷行。

const CJK_OR_WHITESPACE_TOKEN = /[一-鿿　-〿＀-￯]|\s+|[^一-鿿　-〿＀-￯\s]+/gu;

let cachedFont: Font | null = null;

function getFont(): Font {
  if (!cachedFont) {
    // 單一 .otf 檔一定回傳 Font（不是給 .ttc 合集用的 FontCollection）
    cachedFont = openSync(
      path.join(process.cwd(), "public", "fonts", "NotoSansTC-Regular.otf"),
    ) as Font;
  }
  return cachedFont;
}

function measureWidth(text: string, fontSize: number): number {
  if (!text) return 0;
  const font = getFont();
  const run = font.layout(text);
  return (run.advanceWidth / font.unitsPerEm) * fontSize;
}

export function wrapCjkText(text: string, fontSize: number, maxWidthPt: number): string {
  const tokens = text.match(CJK_OR_WHITESPACE_TOKEN) ?? [text];
  const lines: string[] = [];
  let current = "";

  for (const token of tokens) {
    const candidate = current + token;
    if (current && measureWidth(candidate, fontSize) > maxWidthPt) {
      lines.push(current.trimEnd());
      current = token.trim() === "" ? "" : token;
    } else {
      current = candidate;
    }
  }
  if (current.trim() !== "") lines.push(current.trimEnd());

  return lines.join("\n");
}
