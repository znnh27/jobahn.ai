"use client";

import { Fragment, createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { ResumePaper } from "@/app/ResumePaper";
import type { GeneratedResume } from "@/lib/resumes/generateResume";
import { contactParts, hasRequiredContact, pickName, type ResumeContact } from "@/lib/resumes/contact";
import { pdfKey, ptToPx, resolveMetrics, type PdfFit, type ResumeSectionKey } from "@/lib/resumes/typography";
import { SectionTitle } from "@/app/SectionLabels";
import { joinList } from "@/lib/resumes/background";
import { cleanBulletText, insertLineBreak, isComposing, placeCaret, splitAtCaret } from "@/app/bulletEditing";
import type { ProofreadIssue } from "@/lib/resumes/proofreadTypes";
import { markedText } from "./ProofreadMarks";

type Resume = GeneratedResume["resume"];
type ExperienceEntry = Resume["work_experience"][number];


/**
 * 校稿時被點選的那張建議卡要標在哪幾格（key 是 proofreadTypes.ts 的格子代號，技能全部算 "skills"）。
 * 有標記的那一格改成唯讀、顯示刪除線跟綠底，按套用或略過之後畫布重新掛載就回到可以編輯。
 */
const MarksContext = createContext<Map<string, ProofreadIssue[]>>(new Map());

/**
 * 打字當下就存檔（2026-10-28 拿掉「儲存」按鈕後）：每一格平常是失焦才把內容交出去（onCommit），
 * 打完字沒點別的地方就重新整理會不見。打字時也呼叫同一個 onCommit，但先把 live 標成 true，
 * 頁面看到 live 就只排程存檔、不更新畫面狀態（contentEditable 重新渲染游標會跑掉），失焦時才正式記進上一步。
 */
const LiveContext = createContext<RefObject<boolean> | null>(null);

function useLiveCommit() {
  const liveRef = useContext(LiveContext);
  return (commit: () => void) => {
    if (!liveRef) return;
    liveRef.current = true;
    try {
      commit();
    } finally {
      liveRef.current = false;
    }
  };
}

/** 畫布寬 794px 對應 A4 寬（96 dpi），紙本身見 ResumePaper。 */
const PAGE_WIDTH_PX = 794;

interface ResumePageCanvasProps {
  resume: Resume;
  language: string;
  contact: ResumeContact;
  editable: boolean;
  /** 量 PDF 得知第一個掉到第二頁的內容，紅色虛線畫在它上方；沒超出一頁是 null。 */
  pageBreak: PdfFit["breakAt"];
  /** 點抬頭（或還沒填時的提示）打開履歷抬頭表單。 */
  onEditContact: () => void;
  onChangeSummary: (text: string) => void;
  onChangeSkills: (text: string) => void;
  onChangeLanguages: (text: string) => void;
  onChangeBullets: (section: ResumeSectionKey, index: number, bullets: string[]) => void;
  onChangeEntryField: (section: ResumeSectionKey, index: number, field: EntryField, value: string) => void;
  onChangeEducationField: (index: number, field: EducationField, value: string) => void;
  /** 把整段經歷從這份履歷拿掉（經歷資料庫不受影響）。 */
  onRemoveEntry: (section: ResumeSectionKey, index: number) => void;
  /** 校稿：被點選的建議要標在哪幾格，沒有就不標。 */
  marks?: Map<string, ProofreadIssue[]>;
  /** 打字當下呼叫 onCommit 時設成 true（見 LiveContext）。 */
  liveEdit?: RefObject<boolean>;
}

export function ResumePageCanvas({
  resume,
  language,
  contact,
  editable,
  pageBreak,
  onEditContact,
  onChangeSummary,
  onChangeSkills,
  onChangeLanguages,
  onChangeBullets,
  onChangeEntryField,
  onChangeEducationField,
  onRemoveEntry,
  marks,
  liveEdit,
}: ResumePageCanvasProps) {
  const name = pickName(contact, language);
  const parts = contactParts(contact, language);
  const pageRef = useRef<HTMLDivElement>(null);
  const [breakTop, setBreakTop] = useState<number | null>(null);
  const lineHeightPt = resolveMetrics(language, resume.layout).line;

  // 紅色虛線畫在「PDF 上第一個掉到第二頁的內容」上方；那一條被切成兩半時，畫在第一頁放得下的那幾行之後。
  // 內容編輯時高度會變，所以跟著頁面大小重算。
  useLayoutEffect(() => {
    const page = pageRef.current;
    if (!page || !pageBreak) {
      setBreakTop(null);
      return;
    }
    const place = () => {
      const el = page.querySelector<HTMLElement>(`[data-pdf-key="${pageBreak.key}"]`);
      if (!el) return setBreakTop(null);
      const s = page.getBoundingClientRect().width / PAGE_WIDTH_PX || 1;
      const top = (el.getBoundingClientRect().top - page.getBoundingClientRect().top) / s;
      setBreakTop(top + pageBreak.linesBefore * ptToPx(lineHeightPt));
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(page);
    return () => observer.disconnect();
  }, [pageBreak, lineHeightPt]);

  return (
    <LiveContext.Provider value={liveEdit ?? null}>
    <MarksContext.Provider value={marks ?? EMPTY_MARKS}>
    <ResumePaper language={language} layout={resume.layout} pageRef={pageRef}>
      {breakTop !== null && (
        <div className="resume-page-break" style={{ top: breakTop }} aria-hidden="true">
          <span>PDF 第一頁到這裡</span>
        </div>
      )}
      <div data-resume-content>
        {hasRequiredContact(contact) ? (
          <div
            className="resume-contact-edit"
            role="button"
            tabIndex={0}
            title="點一下修改姓名與聯絡資訊"
            onClick={onEditContact}
            onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onEditContact()}
          >
            <div className="resume-name" data-pdf-key={pdfKey.name()}>
              {name}
            </div>
            <div className="resume-contact" data-pdf-key={pdfKey.contact()}>
              {/* 一組「標籤: 內容」是 inline-block，放不下時整組換行，跟 PDF／Word 一樣只在「 / 」斷行。
                  「/」前面用不換行空白，換行時「/」留在上一行尾端。 */}
              {parts.map((p, i) => (
                <Fragment key={i}>
                  {i > 0 && "\u00a0/ "}
                  <span className="resume-contact-item">
                    <strong>{p.label}:</strong> {p.value}
                  </span>
                </Fragment>
              ))}
            </div>
          </div>
        ) : (
          // 履歷沒有姓名跟聯絡資訊是大忌，缺的時候直接在抬頭位置顯示醒目的提示。
          <button type="button" className="resume-contact-missing" onClick={onEditContact}>
            ⚠ 履歷還沒有姓名跟聯絡資訊，點這裡填寫
          </button>
        )}

        <SectionHeader id="summary"><SectionTitle language={language} labelKey="summary" editable={editable} /></SectionHeader>
        <EditableParagraph
          fieldId="summary"
          pdfKeyValue={pdfKey.summary()}
          value={resume.summary}
          editable={editable}
          onCommit={onChangeSummary}
        />

        <SectionHeader id="experience"><SectionTitle language={language} labelKey="experience" editable={editable} /></SectionHeader>
        {resume.work_experience.map((exp, i) => (
          <ExperienceBlock
            key={i}
            section="work_experience"
            index={i}
            entry={exp}
            editable={editable}
            onChangeBullets={(bullets) => onChangeBullets("work_experience", i, bullets)}
            onChangeField={(field, value) => onChangeEntryField("work_experience", i, field, value)}
            onRemove={() => onRemoveEntry("work_experience", i)}
          />
        ))}

        {resume.leadership.length > 0 && (
          <>
            <SectionHeader id="leadership"><SectionTitle language={language} labelKey="leadership" editable={editable} /></SectionHeader>
            {resume.leadership.map((exp, i) => (
              <ExperienceBlock
                key={i}
                section="leadership"
                index={i}
                entry={exp}
                editable={editable}
                onChangeBullets={(bullets) => onChangeBullets("leadership", i, bullets)}
                onChangeField={(field, value) => onChangeEntryField("leadership", i, field, value)}
                onRemove={() => onRemoveEntry("leadership", i)}
              />
            ))}
          </>
        )}

        <SectionHeader id="education"><SectionTitle language={language} labelKey="education" editable={editable} /></SectionHeader>
        {/* 學歷跟經歷的公司、職稱一樣可以直接點了改，只改這份履歷，經歷資料庫不受影響。 */}
        {resume.education.map((edu, i) => (
          <div key={i} className="resume-block">
            <div className="resume-row" data-pdf-key={pdfKey.school(i)}>
              <EditableSpan
                className="resume-row-left"
                value={edu.school}
                editable={editable}
                onCommit={(v) => onChangeEducationField(i, "school", v)}
              />
              {(edu.location || editable) && (
                <EditableSpan
                  className="resume-row-right"
                  value={edu.location ?? ""}
                  editable={editable}
                  onCommit={(v) => onChangeEducationField(i, "location", v)}
                />
              )}
            </div>
            {(edu.detail || edu.period) && (
              <div className="resume-row resume-row--muted" data-pdf-key={pdfKey.eduDetail(i)}>
                <EditableSpan
                  className="resume-row-left"
                  value={edu.detail ?? ""}
                  editable={editable}
                  onCommit={(v) => onChangeEducationField(i, "detail", v)}
                />
                <EditableSpan
                  className="resume-row-right"
                  value={edu.period ?? ""}
                  editable={editable}
                  onCommit={(v) => onChangeEducationField(i, "period", v)}
                />
              </div>
            )}
          </div>
        ))}

        <SectionHeader id="skills"><SectionTitle language={language} labelKey="skills" editable={editable} /></SectionHeader>
        <div data-pdf-key={pdfKey.skills()}>
          <span className="resume-skills-label"><SectionTitle language={language} labelKey="computer" editable={editable} />{" "}</span>
          <EditableSpan fieldId="skills" value={joinList(resume.skills, language)} editable={editable} onCommit={onChangeSkills} />
        </div>
        {(resume.languages ?? []).length > 0 && (
          <div data-pdf-key={pdfKey.languages()}>
            <span className="resume-skills-label"><SectionTitle language={language} labelKey="languages" editable={editable} />{" "}</span>
            <EditableSpan
              value={joinList(resume.languages ?? [], language)}
              editable={editable}
              onCommit={onChangeLanguages}
            />
          </div>
        )}
      </div>
    </ResumePaper>
    </MarksContext.Provider>
    </LiveContext.Provider>
  );
}

const EMPTY_MARKS = new Map<string, ProofreadIssue[]>();

function SectionHeader({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <div className="resume-section-header" data-pdf-key={pdfKey.header(id)}>
      {children}
    </div>
  );
}

/** 公司、地點、職稱、期間都可以直接點擊修改（例如公司名後面的說明太長，自己刪短）。 */
export type EntryField = "org" | "location" | "role" | "period";

/** 學歷：學校、地點、科系那一行、期間。 */
export type EducationField = "school" | "location" | "detail" | "period";

function ExperienceBlock({
  section,
  index,
  entry,
  editable,
  onChangeBullets,
  onChangeField,
  onRemove,
}: {
  section: ResumeSectionKey;
  index: number;
  entry: ExperienceEntry;
  editable: boolean;
  onChangeBullets: (bullets: string[]) => void;
  onChangeField: (field: EntryField, value: string) => void;
  onRemove: () => void;
}) {
  return (
    <div className="resume-block resume-entry">
      {/* 「刪除」不是履歷內容：放在紙的右邊界外，滑到這段才出現，不影響排版跟 PDF。 */}
      {editable && (
        <button
          type="button"
          className="resume-entry-remove"
          onClick={onRemove}
          title="從這份履歷刪除這段經歷（經歷資料庫不受影響，可以按「上一步」退回）"
          aria-label={`從這份履歷刪除「${entry.org}」這段經歷`}
        >
          刪除
        </button>
      )}
      <div className="resume-row" data-pdf-key={pdfKey.org(section, index)}>
        <EditableSpan className="resume-row-left" value={entry.org} editable={editable} onCommit={(v) => onChangeField("org", v)} />
        {(entry.location || editable) && (
          <EditableSpan
            className="resume-row-right"
            value={entry.location ?? ""}
            editable={editable}
            onCommit={(v) => onChangeField("location", v)}
          />
        )}
      </div>
      <div className="resume-row resume-row--role" data-pdf-key={pdfKey.role(section, index)}>
        <EditableSpan
          fieldId={`${section}.${index}.role`}
          className="resume-row-left"
          value={entry.role}
          editable={editable}
          onCommit={(v) => onChangeField("role", v)}
        />
        <EditableSpan
          className="resume-row-right"
          value={entry.period}
          editable={editable}
          onCommit={(v) => onChangeField("period", v)}
        />
      </div>
      <EditableBulletList
        fieldId={(j) => `${section}.${index}.bullets.${j}`}
        bulletKey={(j) => pdfKey.bullet(section, index, j)}
        bullets={entry.bullets}
        editable={editable}
        onChange={onChangeBullets}
      />
    </div>
  );
}

function EditableParagraph({
  fieldId,
  pdfKeyValue,
  value,
  editable,
  onCommit,
}: {
  fieldId: string;
  pdfKeyValue: string;
  value: string;
  editable: boolean;
  onCommit: (text: string) => void;
}) {
  const marks = useContext(MarksContext).get(fieldId);
  const live = useLiveCommit();
  if (marks)
    return (
      <div key="marked" data-pdf-key={pdfKeyValue} className="resume-editable proofread-marked">
        {markedText(value, marks)}
      </div>
    );
  return (
    <div
      data-pdf-key={pdfKeyValue}
      contentEditable={editable}
      // 鍵盤 Cmd/Ctrl + Z 用：跟存好的內容一樣才算「沒在打字」（見 app/useUndoShortcuts.ts）。
      data-committed={value}
      suppressContentEditableWarning
      onBlur={(e) => onCommit(e.currentTarget.textContent ?? "")}
      onInput={(e) => {
        const text = e.currentTarget.textContent ?? "";
        live(() => onCommit(text));
      }}
      className={`resume-editable ${editable ? "resume-editable--editable" : ""}`}
    >
      {value}
    </div>
  );
}

function EditableSpan({
  fieldId,
  value,
  editable,
  onCommit,
  className = "",
}: {
  /** 校稿標記用的格子代號；學歷、公司名這些不校稿的格子不用給。 */
  fieldId?: string;
  value: string;
  editable: boolean;
  onCommit: (text: string) => void;
  className?: string;
}) {
  const marks = useContext(MarksContext).get(fieldId ?? "");
  const live = useLiveCommit();
  if (marks)
    return (
      <span key="marked" className={`resume-editable proofread-marked ${className}`}>
        {markedText(value, marks)}
      </span>
    );
  return (
    <span
      contentEditable={editable}
      // 鍵盤 Cmd/Ctrl + Z 用：跟存好的內容一樣才算「沒在打字」（見 app/useUndoShortcuts.ts）。
      data-committed={value}
      suppressContentEditableWarning
      onBlur={(e) => onCommit(e.currentTarget.textContent ?? "")}
      onInput={(e) => {
        const text = e.currentTarget.textContent ?? "";
        live(() => onCommit(text));
      }}
      className={`resume-editable ${editable ? "resume-editable--editable" : ""} ${className}`}
    >
      {value}
    </span>
  );
}

function EditableBulletList({
  fieldId,
  bulletKey,
  bullets,
  editable,
  onChange,
}: {
  fieldId: (index: number) => string;
  bulletKey: (index: number) => string;
  bullets: string[];
  editable: boolean;
  onChange: (bullets: string[]) => void;
}) {
  const refs = useRef<Array<HTMLDivElement | null>>([]);
  const marks = useContext(MarksContext);
  const live = useLiveCommit();
  // 用 {index, token} 而不是單純的 index：token 每次都遞增成新物件，確保就算兩次都要 focus
  // 同一個 index，effect 依賴也一定會變化而重新觸發，不用在 effect 裡把狀態設回 null。
  const [focusRequest, setFocusRequest] = useState<{ index: number; atStart: boolean; token: number } | null>(null);
  const tokenRef = useRef(0);

  useEffect(() => {
    if (focusRequest === null) return;
    const el = refs.current[focusRequest.index];
    if (el) placeCaret(el, focusRequest.atStart);
  }, [focusRequest]);

  function requestFocus(index: number, atStart = false) {
    tokenRef.current += 1;
    setFocusRequest({ index, atStart, token: tokenRef.current });
  }

  function commitBulletText(index: number, text: string) {
    const next = [...bullets];
    next[index] = cleanBulletText(text);
    onChange(next);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>, index: number) {
    // 中文輸入法選字時按的 Enter 是確認選字，不是換點。
    if (isComposing(e)) return;
    if (e.key === "Enter" && e.shiftKey) {
      // Shift + Enter：同一點裡換行，不新增一點。
      e.preventDefault();
      insertLineBreak(e.currentTarget);
    } else if (e.key === "Enter") {
      // Enter：游標後面的文字移到新的一點（游標在最後就是新增空白的一點）。
      e.preventDefault();
      const [before, after] = splitAtCaret(e.currentTarget);
      const next = [...bullets];
      next[index] = cleanBulletText(before);
      next.splice(index + 1, 0, cleanBulletText(after));
      requestFocus(index + 1, true);
      onChange(next);
    } else if (e.key === "Backspace") {
      const text = cleanBulletText(e.currentTarget.textContent ?? "");
      if (text === "" && bullets.length > 1) {
        e.preventDefault();
        const next = bullets.filter((_, i) => i !== index);
        requestFocus(Math.max(0, index - 1));
        onChange(next);
      }
    }
  }

  return (
    <div className="resume-bullets">
      {bullets.map((b, i) => (
        <div key={i} className="resume-bullet" data-pdf-key={bulletKey(i)}>
          <span className="resume-bullet-dot">{"•"}</span>
          {marks.has(fieldId(i)) ? (
            <div className="resume-editable resume-bullet-text proofread-marked">{markedText(b, marks.get(fieldId(i))!)}</div>
          ) : (
            <div
              ref={(el) => {
                refs.current[i] = el;
              }}
              contentEditable={editable}
              // 鍵盤 Cmd/Ctrl + Z 用：跟存好的內容一樣才算「沒在打字」（見 app/useUndoShortcuts.ts）。
              data-committed={b}
              suppressContentEditableWarning
              onBlur={(e) => commitBulletText(i, e.currentTarget.textContent ?? "")}
              onInput={(e) => {
                const text = e.currentTarget.textContent ?? "";
                live(() => commitBulletText(i, text));
              }}
              onKeyDown={(e) => handleKeyDown(e, i)}
              className={`resume-editable resume-bullet-text ${editable ? "resume-editable--editable" : ""}`}
            >
              {b}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

