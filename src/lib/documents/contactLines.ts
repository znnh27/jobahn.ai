import "server-only";
import { CONTACT_SEPARATOR, type ResumeContactExtra } from "@/lib/resumes/contact";
import { measureWidth } from "./wrapCjkText";

// 抬頭聯絡資訊（E-mail / Phone / LinkedIn 網址…）自己排行：一組「標籤: 內容」不會被拆到兩行，
// 只在「 / 」的地方換行，換行時「/」留在上一行尾端（跟畫布一樣）。PDF 跟 Word 都照這裡算出來的分行，兩邊才會一樣；
// 畫布用 inline-block 讓瀏覽器照同樣的規則排（design-system.css 的 .resume-contact-item）。
// 單一組本身就比一行還長（例如超長網址）時，只能讓它自己斷行，這時候請使用者調小抬頭字級。

function itemWidth(part: ResumeContactExtra, fontSize: number): number {
  return measureWidth(`${part.label}: `, fontSize, true) + measureWidth(part.value, fontSize);
}

export function groupContactLines(
  parts: ResumeContactExtra[],
  fontSize: number,
  maxWidthPt: number,
): ResumeContactExtra[][] {
  const separatorWidth = measureWidth(CONTACT_SEPARATOR, fontSize);
  const trailingWidth = measureWidth(CONTACT_SEPARATOR.trimEnd(), fontSize);
  const lines: ResumeContactExtra[][] = [];
  let current: ResumeContactExtra[] = [];
  let width = 0;
  for (const [index, part] of parts.entries()) {
    const w = itemWidth(part, fontSize);
    // 後面還有下一組的話，這一組後面要接「 /」，也要放得下。
    const trailing = index < parts.length - 1 ? trailingWidth : 0;
    if (current.length > 0 && width + separatorWidth + w + trailing > maxWidthPt) {
      lines.push(current);
      current = [];
      width = 0;
    }
    width += (current.length > 0 ? separatorWidth : 0) + w;
    current.push(part);
  }
  if (current.length > 0) lines.push(current);
  return lines;
}
