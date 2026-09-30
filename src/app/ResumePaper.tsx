"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import { ptToPx, resolveMetrics, type ResumeLayoutSettings } from "@/lib/resumes/typography";

// 履歷畫布跟經歷資料庫共用的「一張 A4 紙」：
// - 寬度固定 794px（A4 在 96 dpi），視窗比較窄時整張用 transform 等比縮小，不改變換行位置。
// - 字級、行距、間距照 typography.ts 的 resolveMetrics() 算，用 CSS 變數套到紙上（design-system.css 的 .resume-*）。

const PAGE_WIDTH_PX = 794;

export function ResumePaper({
  language,
  layout,
  pageRef: externalRef,
  children,
}: {
  language: string;
  layout: ResumeLayoutSettings | undefined;
  /** 外面需要量紙上元素位置時（例如履歷頁畫分頁虛線）傳進來。 */
  pageRef?: RefObject<HTMLDivElement | null>;
  children: ReactNode;
}) {
  const frameRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const pageRef = externalRef ?? innerRef;
  const [scale, setScale] = useState(1);
  const [pageHeight, setPageHeight] = useState<number | null>(null);

  // 外框高度跟著縮放比例縮，下面的內容才不會被蓋住或留一大片空白。
  useEffect(() => {
    const frame = frameRef.current;
    const page = pageRef.current;
    if (!frame || !page) return;
    const update = () => {
      const s = Math.min(1, frame.clientWidth / PAGE_WIDTH_PX);
      setScale(s);
      setPageHeight(page.offsetHeight * s);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(frame);
    observer.observe(page);
    return () => observer.disconnect();
  }, [pageRef]);

  const m = resolveMetrics(language, layout);
  const px = (pt: number) => `${ptToPx(pt)}px`;
  const vars = {
    "--resume-name": px(m.name),
    "--resume-contact": px(m.contact),
    "--resume-contact-line": px((m.contact * m.line) / m.body),
    "--resume-header": px(m.header),
    "--resume-header-line": px((m.header * m.line) / m.body),
    "--resume-body": px(m.body),
    "--resume-line": px(m.line),
    "--resume-contact-before": px(m.contactBefore),
    "--resume-contact-after": px(m.contactAfter),
    "--resume-section-before": px(m.sectionBefore),
    "--resume-section-after": px(m.sectionAfter),
    "--resume-block": px(m.block),
    "--resume-scale": scale,
  } as CSSProperties;

  return (
    <div className="resume-page-frame" ref={frameRef} style={pageHeight ? { height: pageHeight } : undefined}>
      <div ref={pageRef} className={`resume-page resume-page--${language === "zh" ? "zh" : "en"}`} style={vars}>
        {children}
      </div>
    </div>
  );
}
