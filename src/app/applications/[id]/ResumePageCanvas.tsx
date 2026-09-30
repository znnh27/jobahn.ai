"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ResumePaper } from "@/app/ResumePaper";
import type { GeneratedResume } from "@/lib/resumes/generateResume";
import { contactParts, hasRequiredContact, pickName, type ResumeContact } from "@/lib/resumes/contact";
import { pdfKey, ptToPx, resolveMetrics, type PdfFit, type ResumeSectionKey } from "@/lib/resumes/typography";

type Resume = GeneratedResume["resume"];
type ExperienceEntry = Resume["work_experience"][number];

const LABELS: Record<string, Record<string, string>> = {
  en: {
    summary: "PROFESSIONAL SUMMARY",
    experience: "PROFESSIONAL EXPERIENCE",
    leadership: "LEADERSHIP EXPERIENCE / PROJECTS",
    education: "EDUCATION",
    skills: "ADDITIONAL INFORMATION",
    computer: "Computer:",
  },
  zh: {
    summary: "專業摘要",
    experience: "工作經歷",
    leadership: "領導經驗／專案",
    education: "學歷",
    skills: "其他資訊",
    computer: "技能：",
  },
};

function getLabels(language: string) {
  return LABELS[language] ?? LABELS.en;
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
  onChangeBullets: (section: ResumeSectionKey, index: number, bullets: string[]) => void;
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
  onChangeBullets,
}: ResumePageCanvasProps) {
  const labels = getLabels(language);
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
              {parts.map((p, i) => (
                <span key={i}>
                  {i > 0 && " / "}
                  <strong>{p.label}:</strong> {p.value}
                </span>
              ))}
            </div>
          </div>
        ) : (
          // 履歷沒有姓名跟聯絡資訊是大忌，缺的時候直接在抬頭位置顯示醒目的提示。
          <button type="button" className="resume-contact-missing" onClick={onEditContact}>
            ⚠ 履歷還沒有姓名跟聯絡資訊，點這裡填寫
          </button>
        )}

        <SectionHeader id="summary">{labels.summary}</SectionHeader>
        <EditableParagraph
          pdfKeyValue={pdfKey.summary()}
          value={resume.summary}
          editable={editable}
          onCommit={onChangeSummary}
        />

        <SectionHeader id="experience">{labels.experience}</SectionHeader>
        {resume.work_experience.map((exp, i) => (
          <ExperienceBlock
            key={i}
            section="work_experience"
            index={i}
            entry={exp}
            editable={editable}
            onChangeBullets={(bullets) => onChangeBullets("work_experience", i, bullets)}
          />
        ))}

        {resume.leadership.length > 0 && (
          <>
            <SectionHeader id="leadership">{labels.leadership}</SectionHeader>
            {resume.leadership.map((exp, i) => (
              <ExperienceBlock
                key={i}
                section="leadership"
                index={i}
                entry={exp}
                editable={editable}
                onChangeBullets={(bullets) => onChangeBullets("leadership", i, bullets)}
              />
            ))}
          </>
        )}

        <SectionHeader id="education">{labels.education}</SectionHeader>
        {resume.education.map((edu, i) => (
          <div key={i} className="resume-block">
            <Row pdfKeyValue={pdfKey.school(i)} left={edu.school} right={edu.location} />
            {(edu.detail || edu.period) && (
              <Row
                pdfKeyValue={pdfKey.eduDetail(i)}
                left={edu.detail ?? ""}
                right={edu.period ?? ""}
                variant="muted"
              />
            )}
          </div>
        ))}

        <SectionHeader id="skills">{labels.skills}</SectionHeader>
        <div data-pdf-key={pdfKey.skills()}>
          <span className="resume-skills-label">{labels.computer} </span>
          <EditableSpan value={resume.skills.join(", ")} editable={editable} onCommit={onChangeSkills} />
        </div>
      </div>
    </ResumePaper>
  );
}

function SectionHeader({ id, children }: { id: string; children: string }) {
  return (
    <div className="resume-section-header" data-pdf-key={pdfKey.header(id)}>
      {children}
    </div>
  );
}

function Row({
  pdfKeyValue,
  left,
  right,
  variant,
}: {
  pdfKeyValue: string;
  left: string;
  right: string | null;
  variant?: "muted" | "role";
}) {
  return (
    <div className={`resume-row ${variant ? `resume-row--${variant}` : ""}`} data-pdf-key={pdfKeyValue}>
      <span className="resume-row-left">{left}</span>
      {right && <span className="resume-row-right">{right}</span>}
    </div>
  );
}

function ExperienceBlock({
  section,
  index,
  entry,
  editable,
  onChangeBullets,
}: {
  section: ResumeSectionKey;
  index: number;
  entry: ExperienceEntry;
  editable: boolean;
  onChangeBullets: (bullets: string[]) => void;
}) {
  return (
    <div className="resume-block">
      <Row pdfKeyValue={pdfKey.org(section, index)} left={entry.org} right={entry.location} />
      <Row pdfKeyValue={pdfKey.role(section, index)} left={entry.role} right={entry.period} variant="role" />
      <EditableBulletList
        bulletKey={(j) => pdfKey.bullet(section, index, j)}
        bullets={entry.bullets}
        editable={editable}
        onChange={onChangeBullets}
      />
    </div>
  );
}

function EditableParagraph({
  pdfKeyValue,
  value,
  editable,
  onCommit,
}: {
  pdfKeyValue: string;
  value: string;
  editable: boolean;
  onCommit: (text: string) => void;
}) {
  return (
    <div
      data-pdf-key={pdfKeyValue}
      contentEditable={editable}
      suppressContentEditableWarning
      onBlur={(e) => onCommit(e.currentTarget.textContent ?? "")}
      className={`resume-editable ${editable ? "resume-editable--editable" : ""}`}
    >
      {value}
    </div>
  );
}

function EditableSpan({
  value,
  editable,
  onCommit,
}: {
  value: string;
  editable: boolean;
  onCommit: (text: string) => void;
}) {
  return (
    <span
      contentEditable={editable}
      suppressContentEditableWarning
      onBlur={(e) => onCommit(e.currentTarget.textContent ?? "")}
      className={`resume-editable ${editable ? "resume-editable--editable" : ""}`}
    >
      {value}
    </span>
  );
}

function EditableBulletList({
  bulletKey,
  bullets,
  editable,
  onChange,
}: {
  bulletKey: (index: number) => string;
  bullets: string[];
  editable: boolean;
  onChange: (bullets: string[]) => void;
}) {
  const refs = useRef<Array<HTMLDivElement | null>>([]);
  // 用 {index, token} 而不是單純的 index：token 每次都遞增成新物件，確保就算兩次都要 focus
  // 同一個 index，effect 依賴也一定會變化而重新觸發，不用在 effect 裡把狀態設回 null。
  const [focusRequest, setFocusRequest] = useState<{ index: number; token: number } | null>(null);
  const tokenRef = useRef(0);

  useEffect(() => {
    if (focusRequest === null) return;
    const el = refs.current[focusRequest.index];
    if (el) {
      el.focus();
      const range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
    }
  }, [focusRequest]);

  function requestFocus(index: number) {
    tokenRef.current += 1;
    setFocusRequest({ index, token: tokenRef.current });
  }

  function commitBulletText(index: number, text: string) {
    const next = [...bullets];
    next[index] = text;
    onChange(next);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>, index: number) {
    if (e.key === "Enter") {
      e.preventDefault();
      const text = e.currentTarget.textContent ?? "";
      const next = [...bullets];
      next[index] = text;
      next.splice(index + 1, 0, "");
      requestFocus(index + 1);
      onChange(next);
    } else if (e.key === "Backspace") {
      const text = e.currentTarget.textContent ?? "";
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
          <div
            ref={(el) => {
              refs.current[i] = el;
            }}
            contentEditable={editable}
            suppressContentEditableWarning
            onBlur={(e) => commitBulletText(i, e.currentTarget.textContent ?? "")}
            onKeyDown={(e) => handleKeyDown(e, i)}
            className={`resume-editable ${editable ? "resume-editable--editable" : ""}`}
          >
            {b}
          </div>
        </div>
      ))}
    </div>
  );
}
