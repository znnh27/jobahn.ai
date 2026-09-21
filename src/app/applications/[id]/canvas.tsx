"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { generateAction, rescoreAction, saveDraftAction, finalizeResumeAction } from "./actions";
import { ResumePageCanvas } from "./ResumePageCanvas";
import { JdGapDialog } from "./JdGapDialog";
import type { GeneratedResume } from "@/lib/resumes/generateResume";
import type { ResumeContact } from "@/lib/documents/resumeDocContent";

type ResumeMap = Record<string, GeneratedResume["resume"]>;
type ChecklistMap = Record<string, GeneratedResume["jd_match_checklist"]>;
type GapsMap = Record<string, string[]>;

interface CanvasProps {
  applicationId: string;
  languages: string[];
  initialDraft: ResumeMap | null;
  initialChecklist: ChecklistMap;
  initialAtsScore: number | null;
  initialGaps: GapsMap;
  initialFinalized: boolean;
  contact: ResumeContact;
}

const LANG_LABEL: Record<string, string> = { en: "英文", zh: "中文" };

const ATS_BANDS = [
  { min: 85, max: 100, label: "優秀", desc: "幾乎沒有明顯缺口，可以直接投遞", dot: "ats-band-excellent", text: "ats-band-excellent" },
  { min: 70, max: 84, label: "良好", desc: "已經可以投遞，缺口項目有空再補強", dot: "ats-band-good", text: "ats-band-good" },
  { min: 50, max: 69, label: "及格邊緣", desc: "有明顯缺口，建議先補強再投遞", dot: "ats-band-borderline", text: "ats-band-borderline" },
  { min: 0, max: 49, label: "落差大", desc: "跟 JD 落差明顯，建議大幅修改後再投", dot: "ats-band-weak", text: "ats-band-weak" },
] as const;

function getAtsBand(score: number) {
  return ATS_BANDS.find((b) => score >= b.min && score <= b.max) ?? ATS_BANDS[ATS_BANDS.length - 1];
}

function AtsScoreLegend({ score }: { score: number | null }) {
  const currentBand = score !== null ? getAtsBand(score) : null;
  return (
    <div className="ats-scale">
      <div className="ats-scale-bar">
        <div className="ats-scale-bar-segment ats-scale-bar-segment--weak" />
        <div className="ats-scale-bar-segment ats-scale-bar-segment--borderline" />
        <div className="ats-scale-bar-segment ats-scale-bar-segment--good" />
        <div className="ats-scale-bar-segment ats-scale-bar-segment--excellent" />
      </div>
      <ul className="ats-scale-legend">
        {ATS_BANDS.map((b) => (
          <li
            key={b.label}
            className={`ats-scale-legend-item ${currentBand?.label === b.label ? `ats-scale-legend-item--current ${b.text}` : ""}`}
          >
            <span className={`ats-scale-dot ${b.dot}`} />
            <span>
              {b.min}–{b.max} 分・{b.label}：{b.desc}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Canvas({
  applicationId,
  languages,
  initialDraft,
  initialChecklist,
  initialAtsScore,
  initialGaps,
  initialFinalized,
  contact,
}: CanvasProps) {
  const [draft, setDraft] = useState<ResumeMap | null>(initialDraft);
  const [checklist, setChecklist] = useState<ChecklistMap>(initialChecklist);
  const [atsScore, setAtsScore] = useState<number | null>(initialAtsScore);
  const [gaps, setGaps] = useState<GapsMap>(initialGaps);
  const [finalized, setFinalized] = useState(initialFinalized);
  const [activeLang, setActiveLang] = useState(languages[0]);
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [gapDialogText, setGapDialogText] = useState<string | null>(null);

  function handleGenerate() {
    setMessage(null);
    startTransition(async () => {
      const result = await generateAction(applicationId);
      if (result.error || !result.data) {
        setMessage(`錯誤：${result.error}`);
        return;
      }
      setDraft(result.data.resume_draft);
      setChecklist(result.data.jd_match_checklist);
      setAtsScore(result.data.ats_score);
      setGaps(result.data.ats_gaps);
      setMessage("生成完成");
    });
  }

  function updateResume(lang: string, updater: (r: GeneratedResume["resume"]) => GeneratedResume["resume"]) {
    setDraft((prev) => (prev ? { ...prev, [lang]: updater(prev[lang]) } : prev));
  }

  function handleRescore() {
    if (!draft) return;
    setMessage(null);
    startTransition(async () => {
      const result = await rescoreAction(applicationId, draft);
      if (result.error || !result.data) {
        setMessage(`錯誤：${result.error}`);
        return;
      }
      setChecklist(result.data.jd_match_checklist);
      setAtsScore(result.data.ats_score);
      setGaps(result.data.ats_gaps);
      setMessage("已重新評分");
    });
  }

  function handleSave() {
    if (!draft) return;
    setMessage(null);
    startTransition(async () => {
      const result = await saveDraftAction(applicationId, draft);
      setMessage(result.error ? `錯誤：${result.error}` : "已儲存");
    });
  }

  function handleFinalize() {
    setMessage(null);
    startTransition(async () => {
      const result = await finalizeResumeAction(applicationId);
      if (result.error) {
        setMessage(`錯誤：${result.error}`);
        return;
      }
      setFinalized(true);
      setMessage("已定案，可以進到求職信步驟了");
    });
  }

  if (!draft) {
    return (
      <div className="card text-center">
        <p className="text-body">
          還沒有生成過履歷，按下面按鈕開始生成（會呼叫 AI，依語言版本數量可能要跑一陣子）。
        </p>
        <button onClick={handleGenerate} disabled={isPending} className="btn btn-primary mt-4">
          {isPending ? "生成中，請稍候…" : "生成履歷"}
        </button>
        {message && <p className="text-error mt-3">{message}</p>}
      </div>
    );
  }

  const resume = draft[activeLang];
  if (!resume) return null;

  return (
    <div className="canvas-layout">
      <div className="canvas-main">
        <div className="page-header">
          <div className="toolbar-inline">
            {languages.map((lang) => (
              <button
                key={lang}
                onClick={() => setActiveLang(lang)}
                className={activeLang === lang ? "btn-toggle--active" : "btn-toggle"}
              >
                {LANG_LABEL[lang] ?? lang}
              </button>
            ))}
          </div>
          {finalized && <span className="finalized-tag">已定案，畫布唯讀</span>}
        </div>

        <ResumePageCanvas
          resume={resume}
          language={activeLang}
          contact={contact}
          editable={!finalized}
          onChangeSummary={(text) => updateResume(activeLang, (r) => ({ ...r, summary: text }))}
          onChangeSkills={(text) =>
            updateResume(activeLang, (r) => ({
              ...r,
              skills: text.split(",").map((s) => s.trim()).filter(Boolean),
            }))
          }
          onChangeBullets={(section, index, bullets) =>
            updateResume(activeLang, (r) => {
              const items = [...r[section]];
              items[index] = { ...items[index], bullets };
              return { ...r, [section]: items };
            })
          }
        />

        {finalized ? (
          <div className="stack-tight">
            <div className="card-toolbar">
              <a
                href={`/applications/${applicationId}/resume-download?lang=${activeLang}&format=docx`}
                className="btn btn-secondary"
              >
                下載 Word
              </a>
              <a
                href={`/applications/${applicationId}/resume-download?lang=${activeLang}&format=pdf`}
                className="btn btn-secondary"
              >
                下載 PDF
              </a>
              <Link href="/experience" className="btn btn-secondary">
                查看經歷資料庫
              </Link>
              <Link href="/" className="link-muted">
                回首頁
              </Link>
            </div>
            <p className="text-muted-xs">已經幫你把這次用到的經歷記錄回經歷資料庫了。</p>
          </div>
        ) : (
          <div className="card-toolbar">
            <button onClick={handleSave} disabled={isPending} className="btn btn-secondary">
              儲存
            </button>
            <button onClick={handleRescore} disabled={isPending} className="btn btn-secondary">
              {isPending ? "處理中…" : "重新檢查評分"}
            </button>
            <button onClick={handleFinalize} disabled={isPending} className="btn btn-primary">
              定案
            </button>
            {message && <span className="text-muted">{message}</span>}
          </div>
        )}
      </div>

      <div className="canvas-sidebar">
        <div className="card card--sm">
          <h2 className="heading-card">ATS 評分（{LANG_LABEL[activeLang]}）</h2>
          <p className="ats-score-value">
            {atsScore ?? "—"}
            <span className="ats-score-max"> / 100</span>
            {atsScore !== null && (
              <span className={`ats-band-tag ${getAtsBand(atsScore).text}`}>
                {getAtsBand(atsScore).label}
              </span>
            )}
          </p>
          <AtsScoreLegend score={atsScore} />
          {(gaps[activeLang]?.length ?? 0) > 0 && (
            <div className="text-body mt-2">
              <p className="alert-title">缺口：</p>
              <ul className="list-disc">
                {gaps[activeLang].map((g, i) => (
                  <li key={i}>{g}</li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div className="card card--sm">
          <h2 className="heading-card">JD 符合度清單</h2>
          <ul className="checklist">
            {(checklist[activeLang] ?? []).map((item, i) => (
              <li key={i} className="checklist-item">
                <span>{item.covered ? "✅" : "⚠️"}</span>
                <span className="checklist-item-text">
                  {item.item}
                  {item.covered && item.source && (
                    <span className="checklist-item-source">（{item.source}）</span>
                  )}
                  {!item.covered && !finalized && (
                    <>
                      {" "}
                      <button
                        type="button"
                        className="link-muted"
                        onClick={() => setGapDialogText(item.item)}
                      >
                        讓 AI 幫你挖掘這段經驗
                      </button>
                    </>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {gapDialogText && (
        <JdGapDialog
          gapText={gapDialogText}
          language={activeLang}
          sections={[
            ...resume.work_experience.map((e, i) => ({
              section: "work_experience" as const,
              index: i,
              org: e.org,
              role: e.role,
            })),
            ...resume.leadership.map((e, i) => ({
              section: "leadership" as const,
              index: i,
              org: e.org,
              role: e.role,
            })),
          ]}
          onClose={() => setGapDialogText(null)}
          onCommitBullet={(section, index, bulletText) =>
            updateResume(activeLang, (r) => {
              const items = [...r[section]];
              items[index] = { ...items[index], bullets: [...items[index].bullets, bulletText] };
              return { ...r, [section]: items };
            })
          }
        />
      )}
    </div>
  );
}
