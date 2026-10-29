"use client";

import { useEffect, useRef, useState } from "react";
import { stepElicitationAction, commitNewAchievementAction, findEntryIdByOrgAction } from "@/app/experience/actions";
import type { DialogueDraft, DialogueTurn } from "@/lib/experience/elicitationDialogue";
import { MessageComposer } from "@/app/experience/MessageComposer";
import { TypingIndicator } from "@/app/experience/TypingIndicator";
import { CompletionPopup } from "@/app/experience/CompletionPopup";
import { toFullWidthPunctuation } from "@/lib/text/fullWidthPunctuation";
import { addCjkSpacing } from "@/lib/text/cjkSpacing";
import { splitSentences } from "./JdChecklist";

interface SectionOption {
  section: "work_experience" | "leadership";
  index: number;
  org: string;
  role: string;
}

interface JdGapDialogProps {
  gapText: string;
  /** JD 條件清單上的缺口分析；舊資料沒有就是 null，對話改成針對整項要求來問。 */
  gapAnalysis: string | null;
  language: string;
  sections: SectionOption[];
  onClose: () => void;
  onCommitBullet: (section: "work_experience" | "leadership", index: number, bulletText: string) => void;
}

type Step = "picking_section" | "dialogue" | "confirming";

export function JdGapDialog({ gapText, gapAnalysis, language, sections, onClose, onCommitBullet }: JdGapDialogProps) {
  const [step, setStep] = useState<Step>("picking_section");
  const [picked, setPicked] = useState<SectionOption | null>(null);
  const [turns, setTurns] = useState<DialogueTurn[]>([]);
  const [composerText, setComposerText] = useState("");
  const [isPending, setIsPending] = useState(false);
  const [draft, setDraft] = useState<DialogueDraft | null>(null);
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
        { orgName: opt.org, role: opt.role, jdContext: gapText, jdGap: gapAnalysis ?? undefined },
        [],
        null,
      );
      setTurns(result.turns);
      if (result.status === "ready" && result.drafts[0]) {
        setDraft(result.drafts[0]);
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
        { orgName: picked.org, role: picked.role, jdContext: gapText, jdGap: gapAnalysis ?? undefined },
        turns,
        reply,
      );
      setTurns(result.turns);
      if (result.status === "ready" && result.drafts[0]) {
        setDraft(result.drafts[0]);
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
    // 草稿框裡使用者自己改過的字，也一樣把中文句子裡的半形標點轉全形、中英之間補空格。
    const text = language === "zh" ? addCjkSpacing(toFullWidthPunctuation(draft.text.trim())) : draft.text.trim();
    try {
      onCommitBullet(picked.section, picked.index, text);

      const entryId = await findEntryIdByOrgAction(picked.org, language);
      if (!entryId) {
        setError(
          "已經加進履歷草稿，但在經歷資料庫裡找不到對應的公司，這條內容沒有寫回資料庫，之後可以到經歷資料庫手動補上。",
        );
        return;
      }
      const result = await commitNewAchievementAction({
        entryId,
        // 收斂後檢查過、使用者沒再改：直接算通過（跟經歷資料庫的「跟 AI 聊」一樣）。
        drafts: [
          {
            text,
            angleLabel: draft.angleLabel || "JD 缺口挖掘",
            reviewed: draft.checkedText !== undefined && draft.text === draft.checkedText,
          },
        ],
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
          {gapAnalysis && (
            <div className="elicitation-bubble elicitation-bubble--assistant">
              <p>缺口分析（這次只補缺的部分）：</p>
              <ul className="ats-gap-body">
                {splitSentences(gapAnalysis).map((line, i) => (
                  <li key={i}>{line}</li>
                ))}
              </ul>
            </div>
          )}

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
              {/* 檢查後還缺數字：跟經歷資料庫的確認畫面同一套提醒。使用者自己改過文字就不顯示。 */}
              {draft.missingEvidence && draft.text === draft.checkedText && (
                <p className="elicitation-draft-hint">
                  <span className="flag-rule-tag">缺數字或成果</span>
                  {draft.missingEvidence}有的話按「還要調整」補，真的沒有就直接加進履歷。
                </p>
              )}
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
