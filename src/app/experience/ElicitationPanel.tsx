"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ExperienceEntry } from "./ExperienceCanvas";
import {
  stepElicitationAction,
  quickQualityCheckAction,
  commitNewAchievementAction,
  commitRefinedVariantAction,
} from "./actions";
import type { DialogueDraft, DialogueTurn } from "@/lib/experience/elicitationDialogue";
import { MessageComposer } from "./MessageComposer";
import { TypingIndicator } from "./TypingIndicator";
import { CompletionPopup } from "./CompletionPopup";
import { TrashIcon } from "../icons";
import { ConfirmDialog } from "../ConfirmDialog";

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
  variantIndex: number;
  orgName: string;
  role: string;
  seedText: string;
  /** 從「建議加強」卡片進來時，卡片上寫的問題。 */
  issue?: string;
}

// 潤飾對話存在瀏覽器裡（localStorage），關掉面板、點到別的地方、甚至重新整理，
// 回到同一條再點潤飾都能從上次的地方繼續。一段對話只有幾 KB，確認更新後就清掉。
interface SavedRefineSession {
  seedText: string;
  turns: DialogueTurn[];
  draft: { text: string; angleLabel: string } | null;
  step: Step;
}

function refineStorageKey(seed: RefineSeed) {
  return `jobahn:refine:${seed.entryId}:${seed.achievementId}:${seed.variantIndex}`;
}

function loadRefineSession(seed: RefineSeed): SavedRefineSession | null {
  try {
    const raw = window.localStorage.getItem(refineStorageKey(seed));
    if (!raw) return null;
    const saved = JSON.parse(raw) as SavedRefineSession;
    // 這條的內容在那之後被改過，舊對話就不適用了。
    return saved.seedText === seed.seedText && saved.turns.length > 0 ? saved : null;
  } catch {
    return null;
  }
}

function saveRefineSession(seed: RefineSeed, session: SavedRefineSession | null) {
  try {
    if (session) window.localStorage.setItem(refineStorageKey(seed), JSON.stringify(session));
    else window.localStorage.removeItem(refineStorageKey(seed));
  } catch {
    // 無痕模式或儲存空間被擋：對話就只留在這次打開的面板裡，不影響功能。
  }
}

interface CommittedInfo {
  entryId: string;
  achievementId: string;
  variantIndex: number;
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
  // 還沒有任何經歷（例如首次設定選「直接打字」）時，沒有東西可以挑，直接跳到填新經歷的基本資訊。
  // 上次的潤飾對話（有的話）。面板只在使用者點了之後才掛上去，一定在瀏覽器裡，可以直接讀 localStorage。
  const [restored] = useState(() => (refineSeed ? loadRefineSession(refineSeed) : null));
  const [step, setStep] = useState<Step>(
    restored?.step ?? (refineSeed ? "dialogue" : entries.length === 0 ? "picking_new_entry_fields" : "picking_entry"),
  );
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
  const [turns, setTurns] = useState<DialogueTurn[]>(restored?.turns ?? []);
  const [composerText, setComposerText] = useState("");
  const [isPending, setIsPending] = useState(false);
  /** 按了垃圾桶、等使用者確認要刪的那點。 */
  const [pendingDelete, setPendingDelete] = useState<number | null>(null);
  // AI 問答新增經歷時，使用者一次講好幾件事會拆成好幾點；潤飾、自己打字都只有一點。
  const [drafts, setDrafts] = useState<DialogueDraft[]>(restored?.draft ? [restored.draft] : []);
  const [vagueSuggestion, setVagueSuggestion] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showCompletion, setShowCompletion] = useState<string | null>(null);

  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [turns, step, drafts]);

  useEffect(() => {
    if (restored) return;
    if (refineSeed) {
      void startDialogue({ seedText: refineSeed.seedText });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 潤飾對話每有新進展就存一次。
  useEffect(() => {
    if (!refineSeed || turns.length === 0 || showCompletion) return;
    saveRefineSession(refineSeed, { seedText: refineSeed.seedText, turns, draft: drafts[0] ?? null, step });
  }, [refineSeed, turns, drafts, step, showCompletion]);

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
      setDrafts([{ text: composerText, angleLabel: "" }]);
      if (result.isVague) {
        setVagueSuggestion(result.suggestion);
      } else {
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
        {
          orgName: orgContext.orgName || refineSeed?.orgName || "",
          role: orgContext.role || refineSeed?.role || "",
          seedText: opts?.seedText,
          issue: refineSeed?.issue,
          entryId: selectedEntryId ?? undefined,
        },
        [],
        null,
      );
      setTurns(result.turns);
      if (result.status === "ready") {
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
    if (!composerText.trim()) return;
    const reply = composerText;
    setComposerText("");
    // 先把使用者剛送出的訊息顯示出來，不要等 AI 回覆回來才一次顯示兩則——
    // AI 想的時候使用者應該先看到自己說了什麼，再看到打字中動畫，最後才是 AI 的回覆。
    setTurns((prev) => [...prev, { role: "user", text: reply }]);
    setIsPending(true);
    setError(null);
    try {
      const result = await stepElicitationAction(
        {
          orgName: orgContext.orgName,
          role: orgContext.role,
          seedText: refineSeed?.seedText,
          issue: refineSeed?.issue,
          entryId: selectedEntryId ?? undefined,
        },
        turns,
        reply,
      );
      setTurns(result.turns);
      if (result.status === "ready") {
        setDrafts(result.drafts);
        setStep("confirming");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "對話失敗");
    } finally {
      setIsPending(false);
    }
  }

  async function handleConfirm(mode: "replace" | "append" = "replace") {
    const draft = drafts[0];
    if (!draft) return;
    setIsPending(true);
    setError(null);
    try {
      const result = refineSeed
        ? await commitRefinedVariantAction({
            entryId: refineSeed.entryId,
            achievementId: refineSeed.achievementId,
            variantIndex: refineSeed.variantIndex,
            mode,
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
            drafts: drafts.map((d) => ({
              text: d.text,
              angleLabel: d.angleLabel || "手動新增",
              // 收斂後檢查過、使用者沒再改：直接算通過。還缺數字的也一樣，看過提醒還是確認，就是使用者背書了。
              reviewed: d.checkedText !== undefined && d.text === d.checkedText,
            })),
          });

      if (result.error) {
        setError(result.error);
      } else if (result.entryId && result.achievementId && result.variantIndex !== undefined) {
        if (refineSeed) saveRefineSession(refineSeed, null);
        onCommitted({
          entryId: result.entryId,
          achievementId: result.achievementId,
          variantIndex: result.variantIndex,
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

  // 用 portal 掛到 <body>：首次設定頁的內容區有自己的圖層（z-index: 1，讓背景色塊墊在下面），
  // 面板如果留在裡面會被關在那一層，蓋不過導覽列，標題跟關閉鈕就被遮住。
  return createPortal(
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
                    領導經驗與專案
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
                <ChatBubble role="assistant">最多問 10 題，每件事都問到成果就會收尾。</ChatBubble>
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

              {step === "confirming" && drafts.length > 0 && (
                <ChatBubble role="assistant" full>
                  <p className="text-muted-xs">
                    {drafts.length > 1 ? `拆成 ${drafts.length} 點，可以直接修改，不要的點可以刪掉：` : "草稿，可以直接修改："}
                  </p>
                  {drafts.map((d, i) => (
                    <div key={i} className="elicitation-draft">
                      <div className="elicitation-draft-body">
                        <textarea
                          className="textarea"
                          rows={drafts.length > 1 ? 3 : 4}
                          value={d.text}
                          onChange={(e) =>
                            setDrafts((prev) => prev.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))
                          }
                        />
                        {/* 檢查後還缺數字：提醒可以補什麼。使用者自己改過文字就不顯示（可能已經補了）。 */}
                        {d.missingEvidence && d.text === d.checkedText && (
                          <p className="elicitation-draft-hint">
                            <span className="flag-rule-tag">缺數字或成果</span>
                            {d.missingEvidence}有的話按「還要調整」補，真的沒有就直接確認。
                          </p>
                        )}
                      </div>
                      {drafts.length > 1 && (
                        <button
                          type="button"
                          className="icon-btn icon-btn--danger"
                          aria-label="刪掉這點"
                          title="刪掉這點"
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
                      onClick={() => handleConfirm("replace")}
                    >
                      {refineSeed ? "確認，取代原本這條" : drafts.length > 1 ? `確認新增 ${drafts.length} 點` : "確認新增"}
                    </button>
                    {refineSeed && (
                      <button
                        type="button"
                        className="btn btn-secondary"
                        disabled={isPending}
                        onClick={() => handleConfirm("append")}
                      >
                        另存成新的寫法
                      </button>
                    )}
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => {
                        setDrafts([]);
                        setStep("dialogue");
                        // 回到對話但沒有新訊息的話，畫面看起來會像沒反應——
                        // 明確問一句，讓使用者知道現在該做什麼。
                        setTurns((prev) => [
                          ...prev,
                          { role: "assistant", text: "好，那你想怎麼調整？直接打字跟我說。" },
                        ]);
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
        {/* 刪掉草稿前先確認（2026-10-31 Z：刪除一律先跳 popup）。放在面板裡，點確認框時才不會連帶關掉整個面板。 */}
        {pendingDelete !== null && drafts[pendingDelete] && (
          <ConfirmDialog
            title="刪掉這條？"
            message={`「${drafts[pendingDelete].text}」不會存進經歷資料庫。`}
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
    </div>,
    document.body,
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
