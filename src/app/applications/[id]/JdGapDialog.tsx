"use client";

import { useEffect, useRef, useState } from "react";
import { stepElicitationAction, commitNewAchievementAction, findEntryIdByOrgAction } from "@/app/experience/actions";
import type { DialogueTurn } from "@/lib/experience/elicitationDialogue";
import { MessageComposer } from "@/app/experience/MessageComposer";
import { TypingIndicator } from "@/app/experience/TypingIndicator";
import { CompletionPopup } from "@/app/experience/CompletionPopup";

interface SectionOption {
  section: "work_experience" | "leadership";
  index: number;
  org: string;
  role: string;
}

interface JdGapDialogProps {
  gapText: string;
  language: string;
  sections: SectionOption[];
  onClose: () => void;
  onCommitBullet: (section: "work_experience" | "leadership", index: number, bulletText: string) => void;
}

type Step = "picking_section" | "dialogue" | "confirming";

export function JdGapDialog({ gapText, language, sections, onClose, onCommitBullet }: JdGapDialogProps) {
  const [step, setStep] = useState<Step>("picking_section");
  const [picked, setPicked] = useState<SectionOption | null>(null);
  const [turns, setTurns] = useState<DialogueTurn[]>([]);
  const [composerText, setComposerText] = useState("");
  const [isPending, setIsPending] = useState(false);
  const [draft, setDraft] = useState<{ text: string; angleLabel: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showCompletion, setShowCompletion] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [turns, step, draft]);

  async function pickSection(opt: SectionOption) {
    setPicked(opt);
    setStep("dialogue");
    setIsPending(true);
    setError(null);
    try {
      const result = await stepElicitationAction(
        { orgName: opt.org, role: opt.role, jdContext: gapText },
        [],
        null,
      );
      setTurns(result.turns);
      if (result.status === "ready" && result.draftText) {
        setDraft({ text: result.draftText, angleLabel: result.angleLabel ?? "" });
        setStep("confirming");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "對話失敗");
    } finally {
      setIsPending(false);
    }
  }

  async function continueDialogue() {
    if (!composerText.trim() || !picked) return;
    setIsPending(true);
    setError(null);
    const reply = composerText;
    setComposerText("");
    try {
      const result = await stepElicitationAction(
        { orgName: picked.org, role: picked.role, jdContext: gapText },
        turns,
        reply,
      );
      setTurns(result.turns);
      if (result.status === "ready" && result.draftText) {
        setDraft({ text: result.draftText, angleLabel: result.angleLabel ?? "" });
        setStep("confirming");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "對話失敗");
    } finally {
      setIsPending(false);
    }
  }

  async function handleConfirm() {
    if (!draft || !picked) return;
    setIsPending(true);
    setError(null);
    try {
      onCommitBullet(picked.section, picked.index, draft.text);

      const entryId = await findEntryIdByOrgAction(picked.org, language);
      if (!entryId) {
        setError(
          "已經加進履歷草稿，但在經歷資料庫裡找不到對應的公司，這條內容沒有寫回資料庫，之後可以到經歷資料庫手動補上。",
        );
        return;
      }
      const result = await commitNewAchievementAction({
        entryId,
        drafts: [{ text: draft.text, angleLabel: draft.angleLabel || "JD 缺口挖掘" }],
        sourceLabel: "JD 缺口挖掘",
      });
      setShowCompletion(
        result.syncedToOtherLanguage
          ? "已經加進履歷、寫回經歷資料庫，另一個語言版本也同步更新了！"
          : "已經加進履歷、寫回經歷資料庫了！",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "新增失敗");
    } finally {
      setIsPending(false);
    }
  }

  return (
    <div className="elicitation-overlay" onClick={onClose}>
      <div className="elicitation-panel" onClick={(e) => e.stopPropagation()}>
        <div className="elicitation-header">
          <h2 className="heading-card">讓 AI 幫你挖掘這段經驗</h2>
          <button type="button" className="elicitation-close" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="elicitation-messages" ref={listRef}>
          <div className="elicitation-bubble elicitation-bubble--assistant">
            <p>JD 這項要求：{gapText}</p>
          </div>

          {step === "picking_section" && (
            <div className="elicitation-bubble elicitation-bubble--assistant">
              <p>這比較接近你哪一段經歷？</p>
              <div className="elicitation-option-list">
                {sections.map((opt, i) => (
                  <button
                    key={i}
                    type="button"
                    className="elicitation-option-btn"
                    onClick={() => pickSection(opt)}
                  >
                    {opt.org} / {opt.role}
                  </button>
                ))}
              </div>
            </div>
          )}

          {turns.map((t, i) => (
            <div key={i} className={`elicitation-bubble elicitation-bubble--${t.role}`}>
              {t.text}
            </div>
          ))}

          {step === "confirming" && draft && (
            <div className="elicitation-bubble elicitation-bubble--assistant elicitation-bubble--full">
              <p className="text-muted-xs">草稿，可以直接修改：</p>
              <textarea
                className="textarea mt-1"
                rows={4}
                value={draft.text}
                onChange={(e) => setDraft({ ...draft, text: e.target.value })}
              />
              <div className="elicitation-option-list">
                <button type="button" className="btn btn-primary" disabled={isPending} onClick={handleConfirm}>
                  加進履歷
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => {
                    setDraft(null);
                    setStep("dialogue");
                  }}
                >
                  還要調整
                </button>
              </div>
            </div>
          )}

          {isPending && <TypingIndicator />}
          {error && <p className="text-error">{error}</p>}
        </div>

        {step === "dialogue" && (
          <MessageComposer
            value={composerText}
            onChange={setComposerText}
            onSend={continueDialogue}
            disabled={isPending}
          />
        )}
      </div>

      {showCompletion && <CompletionPopup message={showCompletion} onClose={onClose} />}
    </div>
  );
}
