"use client";

import { useEffect, useRef, useState } from "react";
import type { GeneratedResume } from "@/lib/resumes/generateResume";
import type { ResumeContact } from "@/lib/documents/resumeDocContent";

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

function pickName(contact: ResumeContact, language: string): string {
  const primary = language === "zh" ? contact.name_zh : contact.name_en;
  return primary || contact.name_zh || contact.name_en || "";
}

function buildContactLine(contact: ResumeContact): string {
  const parts: string[] = [];
  if (contact.email) parts.push(`Email: ${contact.email}`);
  if (contact.phone) parts.push(`Phone: ${contact.phone}`);
  if (contact.linkedin) parts.push(`LinkedIn: ${contact.linkedin}`);
  if (contact.portfolio) parts.push(`Portfolio: ${contact.portfolio}`);
  return parts.join("   /   ");
}

interface ResumePageCanvasProps {
  resume: Resume;
  language: string;
  contact: ResumeContact;
  editable: boolean;
  onChangeSummary: (text: string) => void;
  onChangeSkills: (text: string) => void;
  onChangeBullets: (section: "work_experience" | "leadership", index: number, bullets: string[]) => void;
}

export function ResumePageCanvas({
  resume,
  language,
  contact,
  editable,
  onChangeSummary,
  onChangeSkills,
  onChangeBullets,
}: ResumePageCanvasProps) {
  const labels = getLabels(language);
  const name = pickName(contact, language);
  const contactLine = buildContactLine(contact);

  return (
    <div className="resume-page mx-auto w-[794px] max-w-full bg-white p-12 text-[14.67px] leading-snug text-neutral-900 shadow-md">
      <div className="text-center text-2xl font-bold">{name}</div>
      <div className="mt-1 mb-3 text-center text-[10.67px] text-neutral-500">{contactLine}</div>

      <SectionHeader>{labels.summary}</SectionHeader>
      <EditableParagraph
        value={resume.summary}
        editable={editable}
        onCommit={onChangeSummary}
      />

      <SectionHeader>{labels.experience}</SectionHeader>
      {resume.work_experience.map((exp, i) => (
        <ExperienceBlock
          key={i}
          entry={exp}
          editable={editable}
          onChangeBullets={(bullets) => onChangeBullets("work_experience", i, bullets)}
        />
      ))}

      {resume.leadership.length > 0 && (
        <>
          <SectionHeader>{labels.leadership}</SectionHeader>
          {resume.leadership.map((exp, i) => (
            <ExperienceBlock
              key={i}
              entry={exp}
              editable={editable}
              onChangeBullets={(bullets) => onChangeBullets("leadership", i, bullets)}
            />
          ))}
        </>
      )}

      <SectionHeader>{labels.education}</SectionHeader>
      {resume.education.map((edu, i) => (
        <div key={i} className="mt-2">
          <Row left={edu.school} right={edu.location} bold />
          {(edu.detail || edu.period) && (
            <Row left={edu.detail ?? ""} right={edu.period ?? ""} italic muted />
          )}
        </div>
      ))}

      <SectionHeader>{labels.skills}</SectionHeader>
      <div className="mt-1">
        <span className="font-bold">{labels.computer} </span>
        <EditableSpan
          value={resume.skills.join(", ")}
          editable={editable}
          onCommit={onChangeSkills}
        />
      </div>
    </div>
  );
}

function SectionHeader({ children }: { children: string }) {
  return (
    <div className="mt-3 mb-1 border-b border-neutral-900 pb-0.5 text-[14.67px] font-bold">
      {children}
    </div>
  );
}

function Row({
  left,
  right,
  bold,
  italic,
  muted,
}: {
  left: string;
  right: string | null;
  bold?: boolean;
  italic?: boolean;
  muted?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span
        className={`${bold ? "font-bold" : ""} ${italic ? "italic" : ""} ${muted ? "text-neutral-500" : ""}`}
      >
        {left}
      </span>
      {right && (
        <span
          className={`shrink-0 ${bold ? "font-bold" : ""} ${italic ? "italic" : ""} ${muted ? "text-neutral-500" : ""}`}
        >
          {right}
        </span>
      )}
    </div>
  );
}

function ExperienceBlock({
  entry,
  editable,
  onChangeBullets,
}: {
  entry: ExperienceEntry;
  editable: boolean;
  onChangeBullets: (bullets: string[]) => void;
}) {
  return (
    <div className="mt-2">
      <Row left={entry.org} right={entry.location} bold />
      <Row left={entry.role} right={entry.period} bold italic />
      <EditableBulletList bullets={entry.bullets} editable={editable} onChange={onChangeBullets} />
    </div>
  );
}

function EditableParagraph({
  value,
  editable,
  onCommit,
}: {
  value: string;
  editable: boolean;
  onCommit: (text: string) => void;
}) {
  return (
    <div
      contentEditable={editable}
      suppressContentEditableWarning
      onBlur={(e) => onCommit(e.currentTarget.textContent ?? "")}
      className={editable ? "rounded-sm outline-none focus:bg-amber-50" : ""}
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
      className={editable ? "rounded-sm outline-none focus:bg-amber-50" : ""}
    >
      {value}
    </span>
  );
}

function EditableBulletList({
  bullets,
  editable,
  onChange,
}: {
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
    <div className="mt-0.5">
      {bullets.map((b, i) => (
        <div key={i} className="flex gap-1.5 pl-3">
          <span className="select-none">{"•"}</span>
          <div
            ref={(el) => {
              refs.current[i] = el;
            }}
            contentEditable={editable}
            suppressContentEditableWarning
            onBlur={(e) => commitBulletText(i, e.currentTarget.textContent ?? "")}
            onKeyDown={(e) => handleKeyDown(e, i)}
            className={`flex-1 ${editable ? "rounded-sm outline-none focus:bg-amber-50" : ""}`}
          >
            {b}
          </div>
        </div>
      ))}
    </div>
  );
}
