import "server-only";
import path from "node:path";
import { openSync, type Font } from "fontkit";

// react-pdf 的自動換行對中文完全不友善：整段沒有空白的中文字會被當成一個超長「單字」，
// 要嘛直接超出頁面右邊界不換行，要嘛被內建斷字邏輯拆成一個個字之後在每個斷點畫一個「-」，
// 中文本來就不該出現這種連字號。所以中文內容改成自己先量字寬、算好斷行位置，用真正的換行字元
// 一行一行交給 react-pdf，讓它不需要再自動斷行。
// PDF 的字型是 Carlito 優先、沒有的字（中文）才用 Noto Sans TC（見 ResumePdfDocument），
// 量字寬也照這個規則，一個字一個字挑對應的字型量。

const CJK_OR_WHITESPACE_TOKEN = /[一-鿿　-〿＀-￯]|\s+|[^一-鿿　-〿＀-￯\s]+/gu;

const fontsDir = () => path.join(process.cwd(), "public", "fonts");
let noto: Font | null = null;
let carlito: Font | null = null;

function fonts(): { noto: Font; carlito: Font } {
  // 單一字型檔一定回傳 Font（不是給 .ttc 合集用的 FontCollection）
  noto ??= openSync(path.join(fontsDir(), "NotoSansTC-Regular.otf")) as Font;
  carlito ??= openSync(path.join(fontsDir(), "carlito", "Carlito-Regular.ttf")) as Font;
  return { noto, carlito };
}

function measureWidth(text: string, fontSize: number): number {
  if (!text) return 0;
  const f = fonts();
  let width = 0;
  for (const ch of text) {
    const font = f.carlito.hasGlyphForCodePoint(ch.codePointAt(0) ?? 0) ? f.carlito : f.noto;
    width += (font.layout(ch).advanceWidth / font.unitsPerEm) * fontSize;
  }
  return width;
}

export function wrapCjkText(text: string, fontSize: number, maxWidthPt: number): string {
  const tokens = text.match(CJK_OR_WHITESPACE_TOKEN) ?? [text];
  const lines: string[] = [];
  let current = "";
  let currentWidth = 0;

  for (const token of tokens) {
    const tokenWidth = measureWidth(token, fontSize);
    if (current && currentWidth + tokenWidth > maxWidthPt) {
      lines.push(current.trimEnd());
      const blank = token.trim() === "";
      current = blank ? "" : token;
      currentWidth = blank ? 0 : tokenWidth;
    } else {
      current += token;
      currentWidth += tokenWidth;
    }
  }
  if (current.trim() !== "") lines.push(current.trimEnd());

  return lines.join("\n");
}
