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
let notoBold: Font | null = null;
let carlito: Font | null = null;
let carlitoBold: Font | null = null;

function fonts(bold: boolean): { noto: Font; carlito: Font } {
  // 單一字型檔一定回傳 Font（不是給 .ttc 合集用的 FontCollection）
  if (bold) {
    notoBold ??= openSync(path.join(fontsDir(), "NotoSansTC-Bold.otf")) as Font;
    carlitoBold ??= openSync(path.join(fontsDir(), "carlito", "Carlito-Bold.ttf")) as Font;
    return { noto: notoBold, carlito: carlitoBold };
  }
  noto ??= openSync(path.join(fontsDir(), "NotoSansTC-Regular.otf")) as Font;
  carlito ??= openSync(path.join(fontsDir(), "carlito", "Carlito-Regular.ttf")) as Font;
  return { noto, carlito };
}

/** 用 PDF 實際的字型量一段文字的寬度（pt）。抬頭聯絡資訊排行也用這個（contactLines.ts）。 */
export function measureWidth(text: string, fontSize: number, bold = false): number {
  if (!text) return 0;
  const f = fonts(bold);
  let width = 0;
  for (const ch of text) {
    const font = f.carlito.hasGlyphForCodePoint(ch.codePointAt(0) ?? 0) ? f.carlito : f.noto;
    width += (font.layout(ch).advanceWidth / font.unitsPerEm) * fontSize;
  }
  return width;
}

// 交給 react-pdf 的每一行最後都接著一個換行字元，react-pdf 斷行時會把它的寬度算進這一行。兩個字型都沒有
// 換行字元的字形，react-pdf 會用第一個字型（Carlito）的替代字形，大約半個字寬。不扣掉的話，接近滿版的那一行
// react-pdf 會判定塞不下、自己再斷一次，用英文斷字邏輯硬斷還補一個「-」（2026-10-29 摘要排出「30%-」再換行）。
function newlineWidth(fontSize: number): number {
  const { carlito } = fonts(false);
  return (carlito.layout("\n").advanceWidth / carlito.unitsPerEm) * fontSize;
}

// 避頭點：這些標點不能出現在行首，碰到了就把前一個字一起帶到下一行。
const NO_LINE_START = /^[，。、；：！？）」』〉》】〕％…—～,.;:!?)\]}%]/u;
// 避尾點：開頭的括號、引號不能留在行尾，跟著下一行走。
const NO_LINE_END = /[（「『〈《【〔(\[{]$/u;

interface Piece {
  text: string;
  width: number;
}

export function wrapCjkText(text: string, fontSize: number, maxWidthPt: number): string {
  // 使用者自己換的行（bullet 裡按 Shift + Enter）保留，每一行各自折行。
  if (text.includes("\n")) {
    return text
      .split("\n")
      .map((line) => wrapCjkText(line, fontSize, maxWidthPt))
      .join("\n");
  }
  const tokens = text.match(CJK_OR_WHITESPACE_TOKEN) ?? [text];
  const reserve = newlineWidth(fontSize);
  const lines: string[] = [];
  let current: Piece[] = [];
  const widthOf = (pieces: Piece[]) => pieces.reduce((sum, p) => sum + p.width, 0);
  const textOf = (pieces: Piece[]) => pieces.map((p) => p.text).join("");

  tokens.forEach((token, i) => {
    const piece = { text: token, width: measureWidth(token, fontSize) };
    const blank = token.trim() === "";
    // 最後一段後面不會接換行字元，不用預留。
    const limit = i === tokens.length - 1 ? maxWidthPt : maxWidthPt - reserve;
    if (current.length === 0 || widthOf(current) + piece.width <= limit) {
      current.push(piece);
      return;
    }
    // 要換行了：下一行開頭不能是避頭點、這一行結尾不能是避尾點，不合的字從這一行搬到下一行。
    const carry: Piece[] = [];
    if (!blank && NO_LINE_START.test(token)) {
      while (current.length > 1) {
        const last = current.pop()!;
        carry.unshift(last);
        if (last.text.trim() !== "" && !NO_LINE_START.test(last.text)) break;
      }
    }
    while (current.length > 1 && NO_LINE_END.test(current[current.length - 1].text)) {
      carry.unshift(current.pop()!);
    }
    lines.push(textOf(current).trimEnd());
    current = blank ? carry : [...carry, piece];
    while (current.length > 0 && current[0].text.trim() === "") current.shift();
  });
  if (textOf(current).trim() !== "") lines.push(textOf(current).trimEnd());

  return lines.join("\n");
}
