// Firecrawl 抓回來的職缺頁面是 Markdown，直接貼進 JD 欄位會滿是 ####、**、[文字](網址)、\- 這些符號，
// 使用者看了很亂，JD 條件清單照原文擷取時也會夾帶符號。這裡轉成乾淨的純文字，保留段落跟條列結構。

export function markdownToText(markdown: string): string {
  const lines = markdown
    .replace(/\r\n?/g, "\n")
    // 圖片整個拿掉；連結只留文字
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    // HTML 標籤（<br>、<span> 之類）
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/?[a-z][^>]*>/gi, "")
    .split("\n");

  const out: string[] = [];
  for (const raw of lines) {
    let line = raw.trimEnd();
    // 分隔線、表格的分隔列
    if (/^\s*([-*_=]\s*){3,}$/.test(line)) continue;
    if (/^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line)) continue;
    // 表格列：拿掉直線，欄位用兩個空白隔開
    if (/^\s*\|.*\|\s*$/.test(line)) {
      line = line
        .trim()
        .replace(/^\||\|$/g, "")
        .split("|")
        .map((c) => c.trim())
        .filter(Boolean)
        .join("  ");
    }
    line = line
      // 標題的 #、引用的 >
      .replace(/^\s{0,3}#{1,6}\s*/, "")
      .replace(/^\s*>+\s?/, "")
      // 條列符號統一成「- 」，保留縮排
      .replace(/^(\s*)[*+•]\s+/, "$1- ")
      // 粗體、斜體、刪除線、行內程式碼
      .replace(/(\*\*|__)(.+?)\1/g, "$2")
      .replace(/(^|[^\w*])\*(?!\s)([^*\n]+?)\*(?!\w)/g, "$1$2")
      .replace(/(^|[^\w_])_(?!\s)([^_\n]+?)_(?!\w)/g, "$1$2")
      .replace(/~~(.+?)~~/g, "$1")
      .replace(/`([^`]+)`/g, "$1")
      // Markdown 的跳脫字元，例如 \- \# \*
      .replace(/\\([\\`*_{}[\]()#+\-.!|>~])/g, "$1")
      // 沒有配對到的零星 ** 或 #
      .replace(/\*{2,}/g, "")
      .replace(/\s+#+\s*$/, "");
    out.push(line);
  }

  return out
    .join("\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
