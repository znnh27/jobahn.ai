"use client";

import { useState } from "react";
import { getSectionLabels } from "@/lib/resumes/sectionLabels";
import { joinList, type EducationItem, type LanguageBackground } from "@/lib/resumes/background";
import { translateBackgroundAction, updateBackgroundAction, type BackgroundEdit } from "./actions";

// 經歷以外的履歷內容（Summary、學歷、技能、語言），排在經歷資料庫畫布的經歷上方／下方，
// 跟正式履歷同一個順序。上傳履歷時解析進來，這裡可以直接點擊編輯。

function useSave(language: "zh" | "en") {
  const [error, setError] = useState<string | null>(null);
  async function save(edit: BackgroundEdit) {
    const result = await updateBackgroundAction(language, edit);
    setError(result.error ? `沒有存到（${result.error}）` : null);
  }
  return { save, error };
}

/** Summary 排在最上面。每份履歷的 Summary 都留一種寫法，生成履歷時拿來參考。 */
export function SummarySection({ background, language }: { background: LanguageBackground; language: "zh" | "en" }) {
  const { save, error } = useSave(language);
  if (background.summaries.length === 0) return null;
  const labels = getSectionLabels(language);

  return (
    <>
      <div className="resume-section-header">{labels.summary}</div>
      {background.summaries.map((text, i) => (
        <div key={`${i}:${text}`} className="exp-background-item">
          <EditableSpan
            className=""
            value={text}
            onCommit={(v) => save({ kind: "summary", index: i, text: v })}
          />
          <button type="button" className="exp-variant-remove" onClick={() => save({ kind: "removeSummary", index: i })}>
            刪除
          </button>
        </div>
      ))}
      {error && <p className="exp-background-error">{error}</p>}
    </>
  );
}

/** 學歷、技能、語言排在經歷下面。 */
export function EducationSkillsSection({
  background,
  otherBackground,
  language,
}: {
  background: LanguageBackground;
  /** 另一個語言的資料：這個語言還沒有、另一個語言有的時候，可以一鍵翻過來。 */
  otherBackground: LanguageBackground;
  language: "zh" | "en";
}) {
  const { save, error } = useSave(language);
  const labels = getSectionLabels(language);
  const [translating, setTranslating] = useState(false);
  const [translateError, setTranslateError] = useState<string | null>(null);
  const canTranslate = (["education", "skills", "languages"] as const).some(
    (f) => background[f].length === 0 && otherBackground[f].length > 0,
  );

  async function translate() {
    setTranslating(true);
    setTranslateError(null);
    const result = await translateBackgroundAction(language);
    if (result.error) setTranslateError(`翻譯失敗（${result.error}）`);
    setTranslating(false);
  }

  return (
    <>
      {canTranslate && (
        <div className="exp-background-translate">
          <span>
            {language === "zh" ? "英文版有學歷、技能或語言，中文版還沒有。" : "中文版有學歷、技能或語言，英文版還沒有。"}
          </span>
          <button type="button" className="btn btn-secondary" disabled={translating} onClick={translate}>
            {translating ? "翻譯中…" : language === "zh" ? "從英文版翻成中文" : "從中文版翻成英文"}
          </button>
          {translateError && <span className="exp-background-error">{translateError}</span>}
        </div>
      )}
      <div className="resume-section-header">{labels.education}</div>
      {background.education.map((edu, i) => (
        <EducationBlock
          key={`${i}:${edu.school}`}
          edu={edu}
          onCommit={(field, value) => save({ kind: "education", index: i, field, value })}
          onRemove={() => save({ kind: "removeEducation", index: i })}
        />
      ))}
      <button
        type="button"
        className="exp-background-add"
        onClick={() => save({ kind: "addEducation", school: language === "zh" ? "學校名稱" : "School name" })}
      >
        ＋ 新增學歷
      </button>

      <div className="resume-section-header">{labels.skills}</div>
      <div>
        <span className="resume-skills-label">{labels.computer} </span>
        <EditableSpan
          className=""
          value={joinList(background.skills, language)}
          placeholder={language === "zh" ? "例如 Figma, SQL（用逗號分開）" : "e.g. Figma, SQL (comma-separated)"}
          onCommit={(v) => save({ kind: "skills", text: v })}
        />
      </div>
      <div>
        <span className="resume-skills-label">{labels.languages} </span>
        <EditableSpan
          className=""
          value={joinList(background.languages, language)}
          placeholder={language === "zh" ? "例如 英文（流利）, 德文（B2）" : "e.g. English (Fluent), German (B2)"}
          onCommit={(v) => save({ kind: "languages", text: v })}
        />
      </div>
      {error && <p className="exp-background-error">{error}</p>}
    </>
  );
}

function EducationBlock({
  edu,
  onCommit,
  onRemove,
}: {
  edu: EducationItem;
  onCommit: (field: keyof EducationItem, value: string) => void;
  onRemove: () => void;
}) {
  return (
    <div className="resume-block exp-background-item">
      <div>
        <div className="resume-row">
          <EditableSpan className="resume-row-left" value={edu.school} onCommit={(v) => onCommit("school", v)} />
          <EditableSpan
            className="resume-row-right"
            value={edu.location ?? ""}
            placeholder="地點"
            onCommit={(v) => onCommit("location", v)}
          />
        </div>
        <div className="resume-row resume-row--muted">
          <EditableSpan
            className="resume-row-left"
            value={edu.detail ?? ""}
            placeholder="學位、科系、輔修"
            onCommit={(v) => onCommit("detail", v)}
          />
          <EditableSpan
            className="resume-row-right"
            value={edu.period ?? ""}
            placeholder="期間"
            onCommit={(v) => onCommit("period", v)}
          />
        </div>
      </div>
      <button type="button" className="exp-variant-remove" onClick={onRemove}>
        刪除
      </button>
    </div>
  );
}

function EditableSpan({
  value,
  onCommit,
  className,
  placeholder,
}: {
  value: string;
  onCommit: (text: string) => void;
  className: string;
  /** 沒有內容時顯示的提示（CSS :empty::before），空白的欄位才點得到。 */
  placeholder?: string;
}) {
  return (
    <span
      contentEditable
      suppressContentEditableWarning
      data-placeholder={placeholder}
      onBlur={(e) => {
        const text = e.currentTarget.textContent ?? "";
        if (text !== value) onCommit(text);
      }}
      className={`resume-editable resume-editable--editable ${className}`}
    >
      {value}
    </span>
  );
}
