"use client";

import { useEffect, useRef, useState } from "react";
import type { ExperienceEntry } from "./ExperienceCanvas";
import {
  stepElicitationAction,
  quickQualityCheckAction,
  commitNewAchievementAction,
  commitRefinedVariantAction,
} from "./actions";
import type { DialogueTurn } from "@/lib/experience/elicitationDialogue";
import { MessageComposer } from "./MessageComposer";
import { TypingIndicator } from "./TypingIndicator";
import { CompletionPopup } from "./CompletionPopup";

type NewEntryFields = {
  orgName: string;
  location: string;
  role: string;
  period: string;
  entryType: "work" | "leadership";
  language: "zh" | "en";
};

type Step =
  | "picking_entry"
  | "picking_new_entry_fields"
  | "choosing_path"
  | "typing_self"
  | "dialogue"
  | "confirming";

interface RefineSeed {
  entryId: string;
  achievementId: string;
  orgName: string;
  role: string;
  seedText: string;
}

interface CommittedInfo {
  entryId: string;
  achievementId: string;
  syncedToOtherLanguage: boolean;
}

interface ElicitationPanelProps {
  entries: ExperienceEntry[];
  refineSeed?: RefineSeed;
  defaultLanguage?: "zh" | "en";
  onClose: () => void;
  onCommitted: (info: CommittedInfo) => void;
}

export function ElicitationPanel({
  entries,
  refineSeed,
  defaultLanguage,
  onClose,
  onCommitted,
}: ElicitationPanelProps) {
  const [step, setStep] = useState<Step>(refineSeed ? "dialogue" : "picking_entry");
  const [filterText, setFilterText] = useState("");
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(refineSeed?.entryId ?? null);
  const [orgContext, setOrgContext] = useState<{ orgName: string; role: string }>(
    refineSeed ? { orgName: refineSeed.orgName, role: refineSeed.role } : { orgName: "", role: "" },
  );
  const [newEntryFields, setNewEntryFields] = useState<NewEntryFields>({
    orgName: "",
    location: "",
    role: "",
    period: "",
    entryType: "work",
    language: defaultLanguage ?? "zh",
  });
  const [turns, setTurns] = useState<DialogueTurn[]>([]);
  const [composerText, setComposerText] = useState("");
  const [isPending, setIsPending] = useState(false);
  const [draft, setDraft] = useState<{ text: string; angleLabel: string } | null>(null);
  const [vagueSuggestion, setVagueSuggestion] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showCompletion, setShowCompletion] = useState<string | null>(null);

  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [turns, step, draft]);

  useEffect(() => {
    if (refineSeed) {
      void startDialogue({ seedText: refineSeed.seedText });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filteredEntries = entries.filter((e) =>
    `${e.orgName} ${e.roleVariants[0]?.role ?? ""}`.toLowerCase().includes(filterText.toLowerCase()),
  );

  function pickEntry(entry: ExperienceEntry) {
    setSelectedEntryId(entry.id);
    setOrgContext({ orgName: entry.orgName, role: entry.roleVariants[0]?.role ?? "" });
    setStep("choosing_path");
  }

  function submitNewEntryFields() {
    if (!newEntryFields.orgName.trim() || !newEntryFields.role.trim()) return;
    setSelectedEntryId(null);
    setOrgContext({ orgName: newEntryFields.orgName, role: newEntryFields.role });
    setStep("choosing_path");
  }

  async function handleSelfWrite() {
    if (!composerText.trim()) return;
    setIsPending(true);
    setError(null);
    try {
      const result = await quickQualityCheckAction(orgContext.orgName, orgContext.role, composerText);
      if (result.isVague) {
        setVagueSuggestion(result.suggestion);
        setDraft({ text: composerText, angleLabel: "" });
      } else {
        setDraft({ text: composerText, angleLabel: "" });
        setStep("confirming");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "檢查失敗");
    } finally {
      setIsPending(false);
      setComposerText("");
    }
  }

  async function startDialogue(opts?: { seedText?: string }) {
    setStep("dialogue");
    setIsPending(true);
    setError(null);
    try {
      const result = await stepElicitationAction(
        { orgName: orgContext.orgName || refineSeed?.orgName || "", role: orgContext.role || refineSeed?.role || "", seedText: opts?.seedText },
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
    if (!composerText.trim()) return;
    setIsPending(true);
    setError(null);
    const reply = composerText;
    setComposerText("");
    try {
      const result = await stepElicitationAction(
        { orgName: orgContext.orgName, role: orgContext.role, seedText: refineSeed?.seedText },
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
    if (!draft) return;
    setIsPending(true);
    setError(null);
    try {
      const result = refineSeed
        ? await commitRefinedVariantAction({
            entryId: refineSeed.entryId,
            achievementId: refineSeed.achievementId,
            draftText: draft.text,
            angleLabel: draft.angleLabel || "手動調整寫法",
          })
        : await commitNewAchievementAction({
            entryId: selectedEntryId,
            newEntry: selectedEntryId
              ? undefined
              : {
                  orgName: newEntryFields.orgName,
                  location: newEntryFields.location || null,
                  role: newEntryFields.role,
                  period: newEntryFields.period,
                  entryType: newEntryFields.entryType,
                  language: newEntryFields.language,
                },
            draftText: draft.text,
            angleLabel: draft.angleLabel || "手動新增",
          });

      if (result.error) {
        setError(result.error);
      } else if (result.entryId && result.achievementId) {
        onCommitted({
          entryId: result.entryId,
          achievementId: result.achievementId,
          syncedToOtherLanguage: result.syncedToOtherLanguage ?? false,
        });
        setShowCompletion(
          result.syncedToOtherLanguage
            ? "更新完成，另一個語言版本也同步更新了！"
            : "更新完成！",
        );
      }
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
          <h2 className="heading-card">{refineSeed ? "AI 潤飾" : "新增一段經歷"}</h2>
          <button type="button" className="elicitation-close" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="elicitation-messages" ref={listRef}>
          {step === "picking_entry" && (
            <ChatBubble role="assistant">
              <p>這是哪一段經歷？</p>
              <input
                className="input mt-2"
                placeholder="打幾個字篩選…"
                value={filterText}
                onChange={(e) => setFilterText(e.target.value)}
              />
              <div className="elicitation-option-list">
                {filteredEntries.map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    className="elicitation-option-btn"
                    onClick={() => pickEntry(entry)}
                  >
                    {entry.orgName} / {entry.roleVariants[0]?.role ?? ""}
                  </button>
                ))}
                <button
                  type="button"
                  className="elicitation-option-btn"
                  onClick={() => setStep("picking_new_entry_fields")}
                >
                  ＋ 新增新的經歷
                </button>
              </div>
            </ChatBubble>
          )}

          {step === "picking_new_entry_fields" && (
            <ChatBubble role="assistant">
              <p>這段新經歷的基本資訊：</p>
              <div className="form-stack mt-2">
                <input
                  className="input"
                  placeholder="公司/組織名稱"
                  value={newEntryFields.orgName}
                  onChange={(e) => setNewEntryFields((f) => ({ ...f, orgName: e.target.value }))}
                />
                <input
                  className="input"
                  placeholder="地點（選填）"
                  value={newEntryFields.location}
                  onChange={(e) => setNewEntryFields((f) => ({ ...f, location: e.target.value }))}
                />
                <input
                  className="input"
                  placeholder="職稱"
                  value={newEntryFields.role}
                  onChange={(e) => setNewEntryFields((f) => ({ ...f, role: e.target.value }))}
                />
                <input
                  className="input"
                  placeholder="期間（例如 Jan. 2023 – Present）"
                  value={newEntryFields.period}
                  onChange={(e) => setNewEntryFields((f) => ({ ...f, period: e.target.value }))}
                />
                <div className="checkbox-row">
                  <label className="checkbox-label">
                    <input
                      type="radio"
                      checked={newEntryFields.entryType === "work"}
                      onChange={() => setNewEntryFields((f) => ({ ...f, entryType: "work" }))}
                    />
                    工作經歷
                  </label>
                  <label className="checkbox-label">
                    <input
                      type="radio"
                      checked={newEntryFields.entryType === "leadership"}
                      onChange={() => setNewEntryFields((f) => ({ ...f, entryType: "leadership" }))}
                    />
                    領導經驗／專案
                  </label>
                </div>
                <div className="checkbox-row">
                  <label className="checkbox-label">
                    <input
                      type="radio"
                      checked={newEntryFields.language === "zh"}
                      onChange={() => setNewEntryFields((f) => ({ ...f, language: "zh" }))}
                    />
                    中文
                  </label>
                  <label className="checkbox-label">
                    <input
                      type="radio"
                      checked={newEntryFields.language === "en"}
                      onChange={() => setNewEntryFields((f) => ({ ...f, language: "en" }))}
                    />
                    English
                  </label>
                </div>
                <button type="button" className="btn btn-primary" onClick={submitNewEntryFields}>
                  下一步
                </button>
              </div>
            </ChatBubble>
          )}

          {(step === "choosing_path" ||
            step === "typing_self" ||
            step === "dialogue" ||
            step === "confirming") && (
            <>
              {step === "choosing_path" && (
                <ChatBubble role="assistant">
                  <p>這段想怎麼寫？</p>
                  <div className="elicitation-option-list">
                    <button
                      type="button"
                      className="elicitation-option-btn"
                      onClick={() => setStep("typing_self")}
                    >
                      我已經想好了
                    </button>
                    <button
                      type="button"
                      className="elicitation-option-btn"
                      onClick={() => startDialogue()}
                    >
                      還不確定，想請 AI 陪我聊聊
                    </button>
                  </div>
                </ChatBubble>
              )}

              {turns.map((t, i) => (
                <ChatBubble key={i} role={t.role}>
                  {t.text}
                </ChatBubble>
              ))}

              {step === "dialogue" && turns.length === 0 && !isPending && (
                <ChatBubble role="assistant">最多問 10 題，通常 2-4 題就能問完。</ChatBubble>
              )}

              {vagueSuggestion && step === "typing_self" && (
                <ChatBubble role="assistant">
                  <p>{vagueSuggestion}</p>
                  <div className="elicitation-option-list">
                    <button
                      type="button"
                      className="elicitation-option-btn"
                      onClick={() => {
                        setVagueSuggestion(null);
                        startDialogue();
                      }}
                    >
                      好，幫我補
                    </button>
                    <button
                      type="button"
                      className="elicitation-option-btn"
                      onClick={() => {
                        setVagueSuggestion(null);
                        setStep("confirming");
                      }}
                    >
                      先這樣就好
                    </button>
                  </div>
                </ChatBubble>
              )}

              {step === "confirming" && draft && (
                <ChatBubble role="assistant" full>
                  <p className="text-muted-xs">草稿，可以直接修改：</p>
                  <textarea
                    className="textarea mt-1"
                    rows={4}
                    value={draft.text}
                    onChange={(e) => setDraft({ ...draft, text: e.target.value })}
                  />
                  <div className="elicitation-option-list">
                    <button
                      type="button"
                      className="btn btn-primary"
                      disabled={isPending}
                      onClick={handleConfirm}
                    >
                      確認新增
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
                </ChatBubble>
              )}
            </>
          )}

          {isPending && <TypingIndicator />}
          {error && <p className="text-error">{error}</p>}
        </div>

        {(step === "typing_self" || step === "dialogue") && step !== ("confirming" as Step) && (
          <MessageComposer
            value={composerText}
            onChange={setComposerText}
            onSend={() => (step === "typing_self" ? handleSelfWrite() : continueDialogue())}
            disabled={isPending}
          />
        )}
      </div>

      {showCompletion && <CompletionPopup message={showCompletion} onClose={onClose} />}
    </div>
  );
}

function ChatBubble({
  role,
  children,
  full,
}: {
  role: "assistant" | "user";
  children: React.ReactNode;
  full?: boolean;
}) {
  return (
    <div className={`elicitation-bubble elicitation-bubble--${role} ${full ? "elicitation-bubble--full" : ""}`}>
      {children}
    </div>
  );
}
