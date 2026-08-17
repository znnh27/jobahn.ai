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
    <div className="mt-8 space-y-4 rounded-lg border border-neutral-200 bg-white p-6">
      <div>
        <h2 className="text-lg font-semibold text-neutral-900">履歷修改完成了，接下來幫你寫求職信</h2>
      </div>

      {!draft && (
        <div className="space-y-3">
          <fieldset>
            <legend className="text-sm font-medium text-neutral-700">要生成哪個語言版本</legend>
            <div className="mt-2 flex gap-4">
              {["en", "zh"].map((lang) => (
                <label key={lang} className="flex items-center gap-2 text-sm text-neutral-700">
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
            className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
          >
            {isPending ? "生成中，請稍候…" : "生成求職信"}
          </button>
        </div>
      )}

      {draft && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_280px]">
          <div className="space-y-3">
            <div className="flex gap-2">
              {selectedLangs.map((lang) => (
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

            <textarea
              value={draft[activeLang] ?? ""}
              onChange={(e) => setDraft((prev) => (prev ? { ...prev, [activeLang]: e.target.value } : prev))}
              rows={16}
              className="block w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
            />

            <div className="flex flex-wrap items-center gap-2 border-t border-neutral-100 pt-4">
              {!completed ? (
                <>
                  <button
                    onClick={handleSave}
                    disabled={isPending}
                    className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
                  >
                    儲存
                  </button>
                  <button
                    onClick={handleRecheck}
                    disabled={isPending}
                    className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
                  >
                    {isPending ? "處理中…" : "重新比對職缺符合度"}
                  </button>
                  <button
                    onClick={handleFinalize}
                    disabled={isPending}
                    className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm text-white hover:bg-neutral-800 disabled:opacity-50"
                  >
                    定案
                  </button>
                </>
              ) : (
                <>
                  <button
                    onClick={() => handleCopy(draft[activeLang] ?? "")}
                    className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm text-white hover:bg-neutral-800"
                  >
                    複製求職信
                  </button>
                  <Link
                    href="/"
                    className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-50"
                  >
                    回首頁
                  </Link>
                </>
              )}
              {message && <span className="self-center text-sm text-neutral-500">{message}</span>}
            </div>
          </div>

          <div className="rounded-lg border border-neutral-200 p-4">
            <h3 className="text-sm font-semibold text-neutral-900">JD 符合度清單</h3>
            <ul className="mt-2 space-y-2 text-sm">
              {(checklist[resumeLanguages.includes(activeLang) ? activeLang : resumeLanguages[0]] ?? []).map(
                (item, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <span>{item.covered ? "✅" : "⚠️"}</span>
                    <span className="text-neutral-700">
                      {item.item}
                      {item.covered && item.source && (
                        <span className="ml-1 text-xs text-neutral-400">
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
