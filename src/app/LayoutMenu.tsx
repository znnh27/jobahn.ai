"use client";

import { useEffect, useRef, useState } from "react";
import { LangSwitch } from "@/app/LangSwitch";
import { Spinner } from "@/app/ProgressBar";
import { MinusIcon, PlusIcon } from "@/app/icons";
import { InfoTip } from "@/app/InfoTip";
import {
  BODY_PT_MAX,
  BODY_PT_MIN,
  BODY_PT_STEP,
  CONTACT_PT_MAX,
  CONTACT_PT_MIN,
  SPACING_OPTIONS,
  resolveMetrics,
  type PdfFit,
  type ResumeLayoutSettings,
} from "@/lib/resumes/typography";

// 工具列上的「Aa」排版按鈕：點開調上下間距、內文字級、抬頭字級。履歷頁底下還會顯示量 PDF 的結果；
// 經歷資料庫沒有下載檔案，不傳 fit 就不顯示。
// 點面板以外的地方或按 Esc 就關閉。
export function LayoutMenu({
  language,
  layout,
  onChange,
  fit,
  measuring,
}: {
  language: string;
  layout: ResumeLayoutSettings;
  onChange: (next: ResumeLayoutSettings) => void;
  fit?: PdfFit | null;
  measuring?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function close(e: Event) {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !ref.current?.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  const stepBodyPt = (delta: number) =>
    onChange({ ...layout, bodyPt: Math.min(BODY_PT_MAX, Math.max(BODY_PT_MIN, layout.bodyPt + delta)) });
  // 沒單獨調過抬頭字級時，顯示目前跟著內文縮放的值，從這個值開始加減。
  const contactPt = resolveMetrics(language, layout).contact;
  const stepContactPt = (delta: number) =>
    onChange({
      ...layout,
      contactPt: Math.min(CONTACT_PT_MAX, Math.max(CONTACT_PT_MIN, Math.round((contactPt + delta) * 2) / 2)),
    });

  return (
    <div className="layout-menu" ref={ref}>
      <button
        type="button"
        className="icon-btn layout-menu-trigger"
        aria-label="排版（字級、上下間距）"
        title="排版（字級、上下間距）"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="layout-menu-glyph" aria-hidden="true">
          Aa
        </span>
      </button>

      {open && (
        <div className="layout-menu-panel" role="dialog" aria-label="履歷排版">
          <div className="layout-menu-row">
            <span className="layout-menu-label">上下間距</span>
            <LangSwitch
              ariaLabel="上下間距"
              options={SPACING_OPTIONS}
              value={layout.spacing}
              onChange={(spacing) => onChange({ ...layout, spacing })}
            />
          </div>

          <div className="layout-menu-row">
            <span className="layout-menu-label">
              內文字級
              <InfoTip label="內文字級的說明">只改列點和摘要的字，標題、姓名會跟著等比放大縮小。</InfoTip>
            </span>
            <div className="layout-menu-stepper">
              <button
                type="button"
                className="icon-btn"
                aria-label="字級縮小"
                disabled={layout.bodyPt <= BODY_PT_MIN}
                onClick={() => stepBodyPt(-BODY_PT_STEP)}
              >
                <MinusIcon />
              </button>
              <span className="layout-menu-value">{layout.bodyPt} pt</span>
              <button
                type="button"
                className="icon-btn"
                aria-label="字級放大"
                disabled={layout.bodyPt >= BODY_PT_MAX}
                onClick={() => stepBodyPt(BODY_PT_STEP)}
              >
                <PlusIcon />
              </button>
            </div>
          </div>

          <div className="layout-menu-row">
            <span className="layout-menu-label">
              抬頭字級
              <InfoTip label="抬頭字級的說明">
                姓名下面那行聯絡資訊的字級。網址很長、斷行不好看時可以單獨調小；沒調的話跟著內文字級等比縮放。
              </InfoTip>
            </span>
            <div className="layout-menu-stepper">
              <button
                type="button"
                className="icon-btn"
                aria-label="抬頭字級縮小"
                disabled={contactPt <= CONTACT_PT_MIN}
                onClick={() => stepContactPt(-BODY_PT_STEP)}
              >
                <MinusIcon />
              </button>
              <span className="layout-menu-value">{contactPt} pt</span>
              <button
                type="button"
                className="icon-btn"
                aria-label="抬頭字級放大"
                disabled={contactPt >= CONTACT_PT_MAX}
                onClick={() => stepContactPt(BODY_PT_STEP)}
              >
                <PlusIcon />
              </button>
            </div>
          </div>

          {fit !== undefined && (
            <p className="layout-menu-status" role="status">
              {measuring ? (
                <>
                  <Spinner />
                  計算 PDF 頁數…
                </>
              ) : fit ? (
                fit.pages <= 1 ? (
                  "PDF：一頁 ✓"
                ) : (
                  `PDF：${fit.pages} 頁`
                )
              ) : null}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
