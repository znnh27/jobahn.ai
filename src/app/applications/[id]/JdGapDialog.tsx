"use client";

import { useEffect, useRef, useState } from "react";
import { stepElicitationAction, commitNewAchievementAction, findEntryIdByOrgAction } from "@/app/experience/actions";
import type { DialogueDraft, DialogueTurn } from "@/lib/experience/elicitationDialogue";
import { MessageComposer } from "@/app/experience/MessageComposer";
import { TypingIndicator } from "@/app/experience/TypingIndicator";
import { CompletionPopup } from "@/app/experience/CompletionPopup";
import { toFullWidthPunctuation } from "@/lib/text/fullWidthPunctuation";
import { addCjkSpacing } from "@/lib/text/cjkSpacing";
import { TrashIcon } from "@/app/icons";
import { ConfirmDialog } from "@/app/ConfirmDialog";
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
  /** 使用者一次講了好幾件事會有好幾條，一起加在這段經歷最後面。 */
  onCommitBullets: (section: "work_experience" | "leadership", index: number, bulletTexts: string[]) => void;
}

type Step = "picking_section" | "dialogue" | "confirming";

export function JdGapDialog({ gapText, gapAnalysis, language, sections, onClose, onCommitBullets }: JdGapDialogProps) {
  const [step, setStep] = useState<Step>("picking_section");
  const [picked, setPicked] = useState<SectionOption | null>(null);
  const [turns, setTurns] = useState<DialogueTurn[]>([]);
  const [composerText, setComposerText] = useState("");
  const [isPending, setIsPending] = useState(false);
  const [drafts, setDrafts] = useState<DialogueDraft[]>([]);
  /** 按了垃圾桶、等使用者確認要刪的那條。 */
  const [pendingDelete, setPendingDelete] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showCompletion, setShowCompletion] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const lang = language === "en" ? "en" : "zh";

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [turns, step, drafts]);

  async function pickSection(opt: SectionOption) {
    setPicked(opt);
    setStep("dialogue");
    setIsPending(true);
    setError(null);
    try {
      const result = await stepElicitationAction(
        { orgName: opt.org, role: opt.role, jdContext: gapText, jdGap: gapAnalysis ?? undefined, language: lang },
        [],
        null,
      );
      setTurns(result.turns);
      if (result.status === "ready" && result.drafts.length > 0) {
        setDrafts(result.drafts);
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
        { orgName: picked.org, role: picked.role, jdContext: gapText, jdGap: gapAnalysis ?? undefined, language: lang },
        turns,
        reply,
      );
      setTurns(result.turns);
      if (result.status === "ready" && result.drafts.length > 0) {
        setDrafts(result.drafts);
        setStep("confirming");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "對話失敗");
    } finally {
      setIsPending(false);
    }
  }

  async function handleConfirm() {
    if (!picked) return;
    // 草稿框裡使用者自己改過的字，也一樣把中文句子裡的半形標點轉全形、中英之間補空格。
    const items = drafts
      .map((d) => ({ draft: d, text: lang === "zh" ? addCjkSpacing(toFullWidthPunctuation(d.text.trim())) : d.text.trim() }))
      .filter((d) => d.text);
    if (items.length === 0) return;
    setIsPending(true);
    setError(null);
    try {
      onCommitBullets(picked.section, picked.index, items.map((d) => d.text));

      const entryId = await findEntryIdByOrgAction(picked.org, language);
      if (!entryId) {
        setError(
          "已經加進履歷草稿，但在經歷資料庫裡找不到對應的公司，這次的內容沒有寫回資料庫，之後可以到經歷資料庫手動補上。",
        );
        return;
      }
      const result = await commitNewAchievementAction({
        entryId,
        // 收斂後檢查過、使用者沒再改：直接算通過（跟經歷資料庫的「跟 AI 聊」一樣）。
        drafts: items.map(({ draft, text }) => ({
          text,
          angleLabel: draft.angleLabel || "JD 缺口挖掘",
          reviewed: draft.checkedText !== undefined && draft.text === draft.checkedText,
        })),
        sourceLabel: "JD 缺口挖掘",
      });
      const count = items.length > 1 ? ` ${items.length} 條` : "";
      setShowCompletion(
        result.syncedToOtherLanguage
          ? `已經把這${count}加進履歷、寫回經歷資料庫，另一個語言版本也同步更新了！`
          : `已經把這${count}加進履歷、寫回經歷資料庫了！`,
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

          {/* 確認畫面跟經歷資料庫的「跟 AI 聊」同一套：每條可以直接改，不要的按垃圾桶刪掉。 */}
          {step === "confirming" && drafts.length > 0 && (
            <div className="elicitation-bubble elicitation-bubble--assistant elicitation-bubble--full">
              <p className="text-muted-xs">
                {drafts.length > 1 ? `寫成 ${drafts.length} 條，可以直接修改，不要加進履歷的按垃圾桶刪掉：` : "草稿，可以直接修改："}
              </p>
              {drafts.map((d, i) => (
                <div key={i} className="elicitation-draft">
                  <div className="elicitation-draft-body">
                    <textarea
                      className="textarea"
                      rows={drafts.length > 1 ? 3 : 4}
                      value={d.text}
                      onChange={(e) => setDrafts((prev) => prev.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))}
                    />
                    {/* 檢查後還缺數字：跟經歷資料庫的確認畫面同一套提醒。使用者自己改過文字就不顯示。 */}
                    {d.missingEvidence && d.text === d.checkedText && (
                      <p className="elicitation-draft-hint">
                        <span className="flag-rule-tag">缺數字或成果</span>
                        {d.missingEvidence}有的話按「還要調整」補，真的沒有就直接加進履歷。
                      </p>
                    )}
                  </div>
                  {drafts.length > 1 && (
                    <button
                      type="button"
                      className="icon-btn icon-btn--danger"
                      aria-label="刪掉這條"
                      title="刪掉這條"
                      disabled={isPending}
                      onClick={() => setPendingDelete(i)}
                    >
                      <TrashIcon />
                    </button>
                  )}
                </div>
              ))}
              <div className="elicitation-option-list">
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={isPending || drafts.every((d) => !d.text.trim())}
                  onClick={handleConfirm}
                >
                  {drafts.length > 1 ? `加進履歷（${drafts.length} 條）` : "加進履歷"}
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => {
                    setDrafts([]);
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
        {/* 刪掉草稿前先確認（2026-10-31 Z：刪除一律先跳 popup）。放在面板裡，點確認框時才不會連帶關掉整個面板。 */}
        {pendingDelete !== null && drafts[pendingDelete] && (
          <ConfirmDialog
            title="刪掉這條？"
            message={`「${drafts[pendingDelete].text}」不會加進履歷，也不會存進經歷資料庫。`}
            confirmLabel="刪掉"
            onConfirm={() => {
              setDrafts((prev) => prev.filter((_, j) => j !== pendingDelete));
              setPendingDelete(null);
            }}
            onCancel={() => setPendingDelete(null)}
          />
        )}
      </div>

      {showCompletion && <CompletionPopup message={showCompletion} onClose={onClose} />}
    </div>
  );
}
