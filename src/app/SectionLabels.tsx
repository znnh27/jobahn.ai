"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import {
  getSectionLabels,
  SECTION_LABEL_MAX_LENGTH,
  type CustomSectionLabels,
  type SectionLabelKey,
} from "@/lib/resumes/sectionLabels";
import { saveSectionLabelAction } from "./sectionLabelActions";

// 履歷區塊標題（專業摘要、工作經歷…）：使用者可以直接點畫布上的標題改，全帳號共用。
// 經歷資料庫、履歷畫布各自在最外層放一個 Provider，裡面的元件用 useSectionLabels 拿標題，
// 不用一層一層傳 props。沒有 Provider 的地方就用預設標題、不能改。

type AllCustom = Record<"zh" | "en", CustomSectionLabels>;

interface SectionLabelsContextValue {
  custom: AllCustom;
  save: (language: "zh" | "en", key: SectionLabelKey, value: string) => Promise<string | null>;
}

const SectionLabelsContext = createContext<SectionLabelsContextValue | null>(null);

export function SectionLabelsProvider({
  initial,
  onChange,
  children,
}: {
  initial: AllCustom;
  /** 標題改了（例如履歷畫布要重新量是不是一頁）。 */
  onChange?: () => void;
  children: ReactNode;
}) {
  const [custom, setCustom] = useState<AllCustom>(initial);

  async function save(language: "zh" | "en", key: SectionLabelKey, value: string) {
    const result = await saveSectionLabelAction(language, key, value);
    if (result.error || !result.labels) return result.error ?? "儲存失敗";
    setCustom((prev) => ({ ...prev, [language]: result.labels! }));
    onChange?.();
    return null;
  }

  return <SectionLabelsContext.Provider value={{ custom, save }}>{children}</SectionLabelsContext.Provider>;
}

export function useSectionLabels(language: string): Record<string, string> {
  const ctx = useContext(SectionLabelsContext);
  const lang = language === "zh" ? "zh" : "en";
  return getSectionLabels(language, ctx?.custom[lang]);
}

/**
 * 可以直接點來改的區塊標題。Enter 或點別的地方就存；清空就恢復預設。
 * 用 span 包在原本的標題元素裡，外層的 class（resume-section-header 等）、data-pdf-key 都不用動。
 */
export function SectionTitle({
  language,
  labelKey,
  editable = true,
}: {
  language: string;
  labelKey: SectionLabelKey;
  editable?: boolean;
}) {
  const ctx = useContext(SectionLabelsContext);
  const labels = useSectionLabels(language);
  const value = labels[labelKey];
  const [error, setError] = useState<string | null>(null);
  const canEdit = editable && ctx !== null && (language === "zh" || language === "en");

  if (!canEdit) return <>{value}</>;

  return (
    <>
      <span
        contentEditable
        // 鍵盤 Cmd/Ctrl + Z 用：跟存好的內容一樣才算「沒在打字」（見 app/useUndoShortcuts.ts）。
        data-committed={value}
        suppressContentEditableWarning
        spellCheck={false}
        title="點一下可以改標題，清空就恢復預設"
        className="resume-editable resume-editable--editable section-title-editable"
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            e.currentTarget.blur();
          } else if (e.key === "Escape") {
            e.currentTarget.textContent = value;
            e.currentTarget.blur();
          }
        }}
        onBlur={async (e) => {
          const el = e.currentTarget;
          const text = (el.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, SECTION_LABEL_MAX_LENGTH);
          if (text === value) return;
          const err = await ctx.save(language as "zh" | "en", labelKey, text);
          setError(err);
          // 清空（恢復預設）或存檔失敗時，React 看到的值可能沒變、不會重畫，自己把文字放回去。
          if (err || !text) el.textContent = err ? value : getDefault(language, labelKey);
        }}
      >
        {value}
      </span>
      {error && <span className="section-title-error">沒有存到（{error}）</span>}
    </>
  );
}

function getDefault(language: string, key: SectionLabelKey) {
  return getSectionLabels(language)[key];
}
