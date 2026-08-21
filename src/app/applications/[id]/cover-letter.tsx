"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import {
  generateCoverLetterAction,
  recheckWithCoverLetterAction,
  saveCoverLetterDraftAction,
  finalizeCoverLetterAction,
} from "./actions";
import type { GeneratedResume } from "@/lib/resumes/generateResume";

type ChecklistMap = Record<string, GeneratedResume["jd_match_checklist"]>;

interface CoverLetterProps {
  applicationId: string;
  resumeLanguages: string[];
  initialCoverLetterLanguages: string[];
  initialDraft: Record<string, string> | null;
  initialChecklist: ChecklistMap;
  initialCompleted: boolean;
}

const LANG_LABEL: Record<string, string> = { en: "英文", zh: "中文" };

export function CoverLetter({
  applicationId,
  resumeLanguages,
  initialCoverLetterLanguages,
  initialDraft,
  initialChecklist,
  initialCompleted,
}: CoverLetterProps) {
  const [selectedLangs, setSelectedLangs] = useState<string[]>(
    initialCoverLetterLanguages.length > 0 ? initialCoverLetterLanguages : resumeLanguages,
  );
  const [draft, setDraft] = useState<Record<string, string> | null>(initialDraft);
  const [checklist, setChecklist] = useState<ChecklistMap>(initialChecklist);
  const [completed, setCompleted] = useState(initialCompleted);
  const [activeLang, setActiveLang] = useState(selectedLangs[0]);
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function toggleLang(lang: string) {
    setSelectedLangs((prev) =>
      prev.includes(lang) ? prev.filter((l) => l !== lang) : [...prev, lang],
    );
  }

  function handleGenerate() {
    setMessage(null);
    startTransition(async () => {
      const result = await generateCoverLetterAction(applicationId, selectedLangs);
      if (result.error || !result.data) {
        setMessage(`錯誤：${result.error}`);
        return;
      }
      setDraft(result.data.cover_letter_draft);
      setActiveLang(selectedLangs[0]);
      setMessage("求職信生成完成");
    });
  }

  function handleRecheck() {
    if (!draft) return;
    setMessage(null);
    startTransition(async () => {
      const result = await recheckWithCoverLetterAction(applicationId, draft);
      if (result.error || !result.data) {
        setMessage(`錯誤：${result.error}`);
        return;
      }
      setChecklist(result.data.jd_match_checklist);
      setMessage("已重新比對職缺符合度");
    });
  }

  function handleSave() {
    if (!draft) return;
    setMessage(null);
    startTransition(async () => {
      const result = await saveCoverLetterDraftAction(applicationId, draft);
      setMessage(result.error ? `錯誤：${result.error}` : "已儲存");
    });
  }

  function handleFinalize() {
    if (!draft) return;
    setMessage(null);
    startTransition(async () => {
      const result = await finalizeCoverLetterAction(applicationId, draft);
      if (result.error) {
        setMessage(`錯誤：${result.error}`);
        return;
      }
      setCompleted(true);
      setMessage("已定案");
    });
  }

  function handleCopy(text: string) {
    navigator.clipboard.writeText(text);
    setMessage("已複製到剪貼簿");
  }

  return (
    <div className="card stack mt-8">
      <h2 className="heading-card--lg">履歷修改完成了，接下來幫你寫求職信</h2>

      {!draft && (
        <div className="stack">
          <fieldset>
            <legend className="label">要生成哪個語言版本</legend>
            <div className="checkbox-row">
              {["en", "zh"].map((lang) => (
                <label key={lang} className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={selectedLangs.includes(lang)}
                    onChange={() => toggleLang(lang)}
                  />
                  {LANG_LABEL[lang]}
                </label>
              ))}
            </div>
          </fieldset>
          <button
            onClick={handleGenerate}
            disabled={isPending || selectedLangs.length === 0}
            className="btn btn-primary"
          >
            {isPending ? "生成中，請稍候…" : "生成求職信"}
          </button>
        </div>
      )}

      {draft && (
        <div className="cover-letter-layout">
          <div className="stack">
            <div className="toolbar-inline">
              {selectedLangs.map((lang) => (
                <button
                  key={lang}
                  onClick={() => setActiveLang(lang)}
                  className={activeLang === lang ? "btn-toggle--active" : "btn-toggle"}
                >
                  {LANG_LABEL[lang] ?? lang}
                </button>
              ))}
            </div>

            <textarea
              value={draft[activeLang] ?? ""}
              onChange={(e) => setDraft((prev) => (prev ? { ...prev, [activeLang]: e.target.value } : prev))}
              rows={16}
              className="textarea"
            />

            <div className="form-toolbar">
              {!completed ? (
                <>
                  <button onClick={handleSave} disabled={isPending} className="btn btn-secondary">
                    儲存
                  </button>
                  <button onClick={handleRecheck} disabled={isPending} className="btn btn-secondary">
                    {isPending ? "處理中…" : "重新比對職缺符合度"}
                  </button>
                  <button onClick={handleFinalize} disabled={isPending} className="btn btn-primary">
                    定案
                  </button>
                </>
              ) : (
                <>
                  <button onClick={() => handleCopy(draft[activeLang] ?? "")} className="btn btn-primary">
                    複製求職信
                  </button>
                  <Link href="/" className="btn btn-secondary">
                    回首頁
                  </Link>
                </>
              )}
              {message && <span className="text-muted">{message}</span>}
            </div>
          </div>

          <div className="card card--sm">
            <h3 className="heading-card">JD 符合度清單</h3>
            <ul className="checklist">
              {(checklist[resumeLanguages.includes(activeLang) ? activeLang : resumeLanguages[0]] ?? []).map(
                (item, i) => (
                  <li key={i} className="checklist-item">
                    <span>{item.covered ? "✅" : "⚠️"}</span>
                    <span className="checklist-item-text">
                      {item.item}
                      {item.covered && item.source && (
                        <span className="checklist-item-source">
                          （{item.source === "resume" ? "履歷" : "求職信"}）
                        </span>
                      )}
                    </span>
                  </li>
                ),
              )}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
