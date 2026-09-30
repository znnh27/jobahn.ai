import "server-only";
import { pdf } from "@react-pdf/renderer";
import { PAGE_PADDING_PT, ResumePdfDocument } from "./ResumePdfDocument";
import type { ResumeDocInput } from "./resumeDocContent";
import { resolveMetrics, type PdfFit } from "@/lib/resumes/typography";

// 「超出一頁」以下載的 PDF 為準：用跟下載完全一樣的程式排一次 PDF，讀 react-pdf 的排版結果
// （每個元素落在第幾頁、位置多高），算出超出多少、第一個掉到第二頁的是哪一條。
// 排版結果是 react-pdf 內部的資料（onRender 回傳的 _INTERNAL__LAYOUT__DATA_），升級 @react-pdf/renderer 時要確認還拿得到。

interface LayoutNode {
  box?: { top: number; height: number };
  props?: Record<string, unknown>;
  children?: LayoutNode[];
}

interface Placed {
  key: string;
  top: number;
  bottom: number;
}

/** 找出一頁上所有掛了 data-k 的內容（掛了 key 的就是一行內容，不用再往裡面找）。 */
function collectKeyed(node: LayoutNode, out: Placed[]) {
  const key = node.props?.["data-k"];
  if (typeof key === "string" && node.box) {
    if (node.box.height > 0) out.push({ key, top: node.box.top, bottom: node.box.top + node.box.height });
    return;
  }
  for (const child of node.children ?? []) collectKeyed(child, out);
}

async function renderLayout(input: ResumeDocInput): Promise<LayoutNode> {
  let layout: LayoutNode | null = null;
  const stream = await pdf(
    <ResumePdfDocument
      {...input}
      onRender={(p) => {
        layout = (p as { _INTERNAL__LAYOUT__DATA_?: LayoutNode })._INTERNAL__LAYOUT__DATA_ ?? null;
      }}
    />,
  ).toBuffer();
  stream.resume(); // 不需要 PDF 檔本身，讓串流自己跑完就好。
  if (!layout) throw new Error("讀不到 PDF 排版結果（@react-pdf/renderer 版本可能改了）");
  return layout;
}

export async function measureResumePdf(input: ResumeDocInput): Promise<PdfFit> {
  const layout = await renderLayout(input);
  const pages = (layout.children ?? []).map((page) => {
    const placed: Placed[] = [];
    collectKeyed(page, placed);
    return placed;
  });
  if (pages.length <= 1) return { pages: pages.length, overflowPt: 0, breakAt: null };

  const overflowPt = pages
    .slice(1)
    .reduce((sum, placed) => sum + Math.max(0, ...placed.map((p) => p.bottom - PAGE_PADDING_PT)), 0);

  const first = pages[1][0];
  let breakAt: PdfFit["breakAt"] = null;
  if (first) {
    // 同一條被切成兩半（前幾行在第一頁）：算出第一頁放了幾行，虛線畫在那一條的第幾行之後。
    const onFirstPage = pages[0].find((p) => p.key === first.key);
    const line = resolveMetrics(input.language, input.resume.layout).line;
    breakAt = {
      key: first.key,
      linesBefore: onFirstPage ? Math.round((onFirstPage.bottom - onFirstPage.top) / line) : 0,
    };
  }
  return { pages: pages.length, overflowPt: Math.round(overflowPt), breakAt };
}
