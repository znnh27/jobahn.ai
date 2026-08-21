"use client";

import { useState, useTransition } from "react";
import { generateAction, rescoreAction, saveDraftAction, finalizeResumeAction } from "./actions";
import { ResumePageCanvas } from "./ResumePageCanvas";
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
      <div className="rounded-lg border border-neutral-200 bg-white p-6 text-center">
        <p className="text-sm text-neutral-600">
          還沒有生成過履歷，按下面按鈕開始生成（會呼叫 AI，依語言版本數量可能要跑一陣子）。
        </p>
        <button
          onClick={handleGenerate}
          disabled={isPending}
          className="mt-4 rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
        >
          {isPending ? "生成中，請稍候…" : "生成履歷"}
        </button>
        {message && <p className="mt-3 text-sm text-red-600">{message}</p>}
      </div>
    );
  }

  const resume = draft[activeLang];
  if (!resume) return null;

  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-[794px_1fr]">
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex gap-2">
            {languages.map((lang) => (
              <button
                key={lang}
                onClick={() => setActiveLang(lang)}
                className={`rounded-md px-3 py-1.5 text-sm ${
                  activeLang === lang
                    ? "bg-neutral-900 text-white"
                    : "border border-neutral-300 text-neutral-600"
                }`}
              >
                {LANG_LABEL[lang] ?? lang}
              </button>
            ))}
          </div>
          {finalized && (
            <span className="rounded-md bg-green-50 px-2 py-1 text-xs text-green-700">
              已定案，畫布唯讀
            </span>
          )}
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

        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-neutral-200 bg-white p-3">
          <button
            onClick={handleSave}
            disabled={isPending}
            className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
          >
            儲存
          </button>
          <button
            onClick={handleRescore}
            disabled={isPending}
            className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
          >
            {isPending ? "處理中…" : "重新檢查評分"}
          </button>
          <button
            onClick={handleFinalize}
            disabled={isPending}
            className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm text-white hover:bg-neutral-800 disabled:opacity-50"
          >
            定案
          </button>
          {finalized && (
            <>
              <a
                href={`/applications/${applicationId}/resume-download?lang=${activeLang}&format=docx`}
                className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-50"
              >
                下載 Word
              </a>
              <a
                href={`/applications/${applicationId}/resume-download?lang=${activeLang}&format=pdf`}
                className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-50"
              >
                下載 PDF
              </a>
            </>
          )}
          {message && <span className="self-center text-sm text-neutral-500">{message}</span>}
        </div>
      </div>

      <div className="space-y-4">
        <div className="rounded-lg border border-neutral-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-neutral-900">ATS 評分（{LANG_LABEL[activeLang]}）</h2>
          <p className="mt-1 text-2xl font-semibold text-neutral-900">
            {atsScore ?? "—"}
            <span className="text-sm font-normal text-neutral-400"> / 100</span>
          </p>
          {(gaps[activeLang]?.length ?? 0) > 0 && (
            <div className="mt-2 text-sm text-neutral-600">
              <p className="font-medium">缺口：</p>
              <ul className="mt-1 list-disc space-y-1 pl-5">
                {gaps[activeLang].map((g, i) => (
                  <li key={i}>{g}</li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div className="rounded-lg border border-neutral-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-neutral-900">JD 符合度清單</h2>
          <ul className="mt-2 space-y-2 text-sm">
            {(checklist[activeLang] ?? []).map((item, i) => (
              <li key={i} className="flex items-start gap-2">
                <span>{item.covered ? "✅" : "⚠️"}</span>
                <span className="text-neutral-700">
                  {item.item}
                  {item.covered && item.source && (
                    <span className="ml-1 text-xs text-neutral-400">（{item.source}）</span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
