"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MessageComposer } from "./MessageComposer";
import { TypingIndicator } from "./TypingIndicator";
import { saveBackgroundInterviewAction } from "./actions";

// AI 問答寫第一份履歷的人，經歷聊完之後補問學歷、技能、語言：三個固定問題一題一題問，
// 可以跳過，最後一次整理存進經歷資料庫。版面跟 AI 問答（ElicitationPanel）同一套。

const QUESTIONS = [
  {
    key: "education",
    text: "先補學歷：你讀哪間學校、什麼科系？大概哪幾年？有輔修、雙主修或交換也可以一起說。",
    placeholder: "例如：輔仁大學德文系，2016–2020，輔修金融與國際企業，大三去德國交換一年",
  },
  {
    key: "skills",
    text: "工作上會用到哪些工具或專業技能？想到什麼就列什麼。",
    placeholder: "例如：Figma、SQL、Google Analytics、A/B Test",
  },
  {
    key: "languages",
    text: "最後是語言能力：會哪些語言？程度大概如何，有考過檢定也可以寫。",
    placeholder: "例如：中文母語、英文流利（多益 900）、德文 B2",
  },
] as const;

type AnswerKey = (typeof QUESTIONS)[number]["key"];

export function BackgroundInterviewPanel({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<Record<AnswerKey, string>>({ education: "", skills: "", languages: "" });
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [step, saving, result]);

  async function answer(text: string) {
    const key = QUESTIONS[step].key;
    const next = { ...answers, [key]: text };
    setAnswers(next);
    setDraft("");
    if (step < QUESTIONS.length - 1) {
      setStep(step + 1);
      return;
    }
    setStep(QUESTIONS.length);
    await save(next);
  }

  async function save(all: Record<AnswerKey, string>) {
    setSaving(true);
    setError(null);
    const res = await saveBackgroundInterviewAction(all);
    setSaving(false);
    if (res.error) {
      setError(res.error);
      return;
    }
    setResult(
      res.added
        ? `已經把 ${res.added} 項學歷、技能、語言存進經歷資料庫了，之後生成履歷都會用到，也可以到經歷資料庫直接修改。`
        : "這次沒有新增內容。之後想補，可以到經歷資料庫直接填。",
    );
    onSaved();
  }

  return createPortal(
    <div className="elicitation-overlay" onClick={onClose}>
      <div className="elicitation-panel" onClick={(e) => e.stopPropagation()}>
        <div className="elicitation-header">
          <h2 className="heading-card">補上學歷、技能、語言</h2>
          <button type="button" className="elicitation-close" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="elicitation-messages" ref={listRef}>
          {QUESTIONS.slice(0, Math.min(step + 1, QUESTIONS.length)).map((q, i) => (
            <Fragment key={q.key}>
              <div className="elicitation-bubble elicitation-bubble--assistant">
                <p>{q.text}</p>
              </div>
              {i < step && (
                <div className="elicitation-bubble elicitation-bubble--user">
                  <p>{answers[q.key].trim() || "（跳過）"}</p>
                </div>
              )}
            </Fragment>
          ))}
          {saving && <TypingIndicator />}
          {result && (
            <div className="elicitation-bubble elicitation-bubble--assistant">
              <p>{result}</p>
            </div>
          )}
          {error && (
            <div className="elicitation-bubble elicitation-bubble--assistant">
              <p className="text-error">整理失敗：{error}</p>
              <button type="button" className="btn btn-secondary mt-2" onClick={() => save(answers)}>
                再試一次
              </button>
            </div>
          )}
        </div>

        {step < QUESTIONS.length ? (
          <div className="background-interview-input">
            <MessageComposer
              value={draft}
              onChange={setDraft}
              onSend={() => draft.trim() && answer(draft)}
              disabled={false}
              placeholder={QUESTIONS[step].placeholder}
            />
            <button type="button" className="btn-link" onClick={() => answer("")}>
              跳過這題
            </button>
          </div>
        ) : (
          result && (
            <div className="background-interview-done">
              <button type="button" className="btn btn-primary" onClick={onClose}>
                完成
              </button>
            </div>
          )
        )}
      </div>
    </div>,
    document.body,
  );
}
