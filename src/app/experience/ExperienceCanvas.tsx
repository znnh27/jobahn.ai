"use client";

import { useEffect, useRef, useState } from "react";
import { cleanBulletText, insertLineBreak, isComposing, placeCaret, splitAtCaret } from "@/app/bulletEditing";
import { ConfirmDialog } from "@/app/ConfirmDialog";
import { ResumePaper } from "@/app/ResumePaper";
import type { ResumeLayoutSettings } from "@/lib/resumes/typography";
import { SectionTitle } from "../SectionLabels";
import type { StoredFlag } from "@/lib/experience/storedFlag";
import type { LanguageBackground } from "@/lib/resumes/background";
import { EducationSkillsSection, SummarySection } from "./BackgroundSections";
import {
  updateEntryFieldAction,
  updatePeriodAction,
  updateRoleVariantAction,
  removeRoleVariantAction,
  updateAchievementVariantAction,
  removeAchievementVariantAction,
  insertAchievementAfterAction,
  type ScanFlag,
} from "./actions";

export interface ExperienceEntry {
  id: string;
  language: string;
  entryType: string;
  orgName: string;
  location: string | null;
  roleVariants: { role: string; source: string[] }[];
  periodVariants: { period: string; source: string[] }[];
  /** 排序用；上一步還原被刪掉的經歷時沿用原本的時間，位置才不會跑掉。 */
  createdAt?: string;
  achievements: {
    id: string;
    /** reviewedText：上次通過檢查（或使用者按 ✕ 不改）時的文字；跟 text 不一樣就代表之後改過，要重新檢查。
     *  flag：上次檢查給的建議（見 lib/experience/storedFlag.ts）。 */
    variants: { text: string; angleLabel: string; source: string; reviewedText?: string; flag?: StoredFlag }[];
  }[];
}

export interface RefineRequest {
  entryId: string;
  achievementId: string;
  variantIndex: number;
  orgName: string;
  role: string;
  seedText: string;
  /** 從建議卡片進來時，卡片上寫的問題（這條為什麼被標記）。 */
  issue?: string;
}

export interface HighlightTarget {
  entryId: string;
  achievementId: string;
  variantIndex: number;
  color: "editing" | "updated";
}

export function ExperienceCanvas({
  entries,
  background,
  otherBackground,
  language,
  layout,
  onActivateFlag,
  highlight,
  flags,
  activeFlagKey,
}: {
  entries: ExperienceEntry[];
  /** 這個語言的 Summary、學歷、技能、語言。 */
  background: LanguageBackground;
  /** 另一個語言的，用來判斷要不要顯示「翻過來」的按鈕。 */
  otherBackground: LanguageBackground;
  language: "zh" | "en";
  /** 字級／上下間距，跟履歷畫布同一套（typography.ts）。 */
  layout: ResumeLayoutSettings;
  /** 點畫布上有標記的那一條：右欄對應的建議卡片要亮起來、對齊到這一條。 */
  onActivateFlag: (key: string) => void;
  highlight: HighlightTarget | null;
  flags: ScanFlag[];
  /** 右欄被點選的那張建議卡片，對應的 bullet 要標亮。 */
  activeFlagKey: string | null;
}) {
  const langEntries = entries.filter((e) => e.language === language);

  function flagFor(entryId: string, achievementId: string, variantIndex: number) {
    return flags.find(
      (f) => f.entryId === entryId && f.achievementId === achievementId && f.variantIndex === variantIndex,
    );
  }

  // 還沒有經歷時一樣顯示紙張：學歷、技能、語言區塊可以先填。
  const emptyNote =
    langEntries.length === 0 ? (
      <div className="card exp-empty-state">
        {language === "zh" ? "還沒有中文版的經歷資料。" : "還沒有英文版的經歷資料。"}
        按上面的「新增經歷」上傳一份履歷或跟 AI 聊，或等你完成第一次應徵，內容就會自動記錄在這裡。
      </div>
    ) : null;

  const workEntries = langEntries.filter((e) => e.entryType === "work");
  const leadershipEntries = langEntries.filter((e) => e.entryType !== "work");

  return (
    <>
      {emptyNote}
      <ResumePaper language={language} layout={layout}>
        <SummarySection background={background} language={language} />

        {workEntries.length > 0 && (
          <>
            <div className="resume-section-header"><SectionTitle language={language} labelKey="experience" /></div>
            {workEntries.map((entry) => (
              <EntryBlock
                key={entry.id}
                entry={entry}
                flagFor={flagFor}
                onActivateFlag={onActivateFlag}
                highlight={highlight}
                activeFlagKey={activeFlagKey}
              />
            ))}
          </>
        )}

        {leadershipEntries.length > 0 && (
          <>
            <div className="resume-section-header"><SectionTitle language={language} labelKey="leadership" /></div>
            {leadershipEntries.map((entry) => (
              <EntryBlock
                key={entry.id}
                entry={entry}
                flagFor={flagFor}
                onActivateFlag={onActivateFlag}
                highlight={highlight}
                activeFlagKey={activeFlagKey}
              />
            ))}
          </>
        )}

        <EducationSkillsSection
          background={background}
          otherBackground={otherBackground}
          language={language}
        />
      </ResumePaper>
    </>
  );
}

function EntryBlock({
  entry,
  flagFor,
  onActivateFlag,
  highlight,
  activeFlagKey,
}: {
  entry: ExperienceEntry;
  flagFor: (entryId: string, achievementId: string, variantIndex: number) => ScanFlag | undefined;
  onActivateFlag: (key: string) => void;
  highlight: HighlightTarget | null;
  activeFlagKey: string | null;
}) {
  // 按「刪除」先跳網站自己的確認視窗（不用瀏覽器原生的 confirm()）。
  const [pendingDelete, setPendingDelete] = useState<{ achievementId: string; variantIndex: number; text: string } | null>(null);
  const [deleting, setDeleting] = useState(false);
  // 在某一點句尾按 Enter：先在它下面開一個空白的新一點，打了字、離開才存；沒打字就收掉。
  const [draft, setDraft] = useState<{ afterAchievementId: string; text: string } | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  async function insertAfter(afterAchievementId: string, text: string, edit?: { achievementId: string; variantIndex: number; text: string }) {
    setSaveError(null);
    const result = await insertAchievementAfterAction({ entryId: entry.id, afterAchievementId, edit, text });
    if (result.error) setSaveError(`新增這一點失敗：${result.error}`);
    return result.achievementId ?? null;
  }

  /** 某一點按 Enter：游標後有字就直接拆成兩點；在句尾就在下面開一個空白的新一點。 */
  async function handleSplit(ach: { id: string; variants: { text: string }[] }, variantIndex: number, before: string, after: string) {
    const changed = before !== ach.variants[variantIndex]?.text;
    if (after) {
      await insertAfter(ach.id, after, changed ? { achievementId: ach.id, variantIndex, text: before } : undefined);
      return;
    }
    if (changed) await updateAchievementVariantAction(entry.id, ach.id, variantIndex, before);
    setDraft({ afterAchievementId: ach.id, text: "" });
  }

  /** 空白新一點：離開時有字就存；按 Enter 就存起來，再往下開一個新的。 */
  async function commitDraft(text: string, openNext: { text: string } | null) {
    if (!draft) return;
    const afterId = draft.afterAchievementId;
    setDraft(null);
    if (!text) {
      if (openNext) setDraft({ afterAchievementId: afterId, text: openNext.text });
      return;
    }
    const id = await insertAfter(afterId, text);
    if (id && openNext) setDraft({ afterAchievementId: id, text: openNext.text });
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      await removeAchievementVariantAction(entry.id, pendingDelete.achievementId, pendingDelete.variantIndex);
    } finally {
      setDeleting(false);
      setPendingDelete(null);
    }
  }

  const period = entry.periodVariants[0]?.period ?? "";

  return (
    // 右欄的註解欄（TagRail）用 data-entry-key 對齊到這段經歷。
    <div className="exp-entry resume-block" data-entry-key={entry.id}>
      <div className="resume-row">
        <EditableSpan
          className="resume-row-left"
          value={entry.orgName}
          onCommit={(v) => updateEntryFieldAction(entry.id, "org_name", v)}
        />
        <EditableSpan
          className="resume-row-right"
          value={entry.location ?? ""}
          onCommit={(v) => updateEntryFieldAction(entry.id, "location", v)}
        />
      </div>

      {entry.roleVariants.map((rv, i) => (
        <div key={i} className="exp-role-row resume-row resume-row--role">
          <EditableSpan
            className="resume-row-left"
            value={rv.role}
            onCommit={(v) => updateRoleVariantAction(entry.id, i, v)}
          />
          {i === 0 ? (
            <EditableSpan
              className="resume-row-right"
              value={period}
              onCommit={(v) => updatePeriodAction(entry.id, v)}
            />
          ) : (
            entry.roleVariants.length > 1 && (
              <button
                type="button"
                className="exp-role-row-remove"
                onClick={() => {
                  if (confirm(`刪除這個職稱寫法「${rv.role}」？`)) {
                    removeRoleVariantAction(entry.id, i);
                  }
                }}
              >
                刪除這個寫法
              </button>
            )
          )}
        </div>
      ))}

      <div className="resume-bullets">
        {entry.achievements.map((ach) => {
          return (
            <div key={ach.id} className="exp-achievement">
              {ach.variants.map((v, vi) => {
                const flag = flagFor(entry.id, ach.id, vi);
                const isHighlighted =
                  highlight?.entryId === entry.id &&
                  highlight?.achievementId === ach.id &&
                  highlight?.variantIndex === vi;
                const highlightClass = isHighlighted
                  ? highlight?.color === "editing"
                    ? "exp-variant--editing"
                    : "exp-variant--updated"
                  : "";
                // 有檢查建議的 bullet：畫布上只留一個小標記，建議內容放在右欄的註解卡片（FlagRail），
                // 用 data-flag-key 讓卡片對齊到這一條。
                const key = `${entry.id}:${ach.id}:${vi}`;
                const flagClass = flag ? `exp-variant--flagged ${activeFlagKey === key ? "exp-variant--flag-active" : ""}` : "";
                return (
                  <div
                    key={vi}
                    className={`exp-variant ${highlightClass} ${flagClass}`}
                    data-flag-key={flag ? key : undefined}
                    // 右欄的寫法標籤（TagRail）用這個對齊到這一條。
                    data-variant-key={key}
                    // 點有標記的這一條，右欄對應的卡片會亮起來並對齊過來（反過來點卡片也會捲到這一條）。
                    onClick={
                      flag
                        ? (e) => {
                            e.stopPropagation();
                            onActivateFlag(key);
                          }
                        : undefined
                    }
                  >
                    <span className="resume-bullet-dot">{"•"}</span>
                    <div className="exp-variant-bullet">
                      <EditableBullet
                        value={v.text}
                        onCommit={(text) => updateAchievementVariantAction(entry.id, ach.id, vi, text)}
                        onSplit={(before, after) => void handleSplit(ach, vi, before, after)}
                      />
                    </div>
                    <button
                      type="button"
                      className="exp-variant-remove"
                      onClick={(e) => {
                        e.stopPropagation();
                        setPendingDelete({ achievementId: ach.id, variantIndex: vi, text: v.text });
                      }}
                    >
                      刪除
                    </button>
                  </div>
                );
              })}
              {draft?.afterAchievementId === ach.id && (
                <div className="exp-variant">
                  <span className="resume-bullet-dot">{"•"}</span>
                  <div className="exp-variant-bullet">
                    <EditableBullet
                      value={draft.text}
                      autoFocus
                      onCommit={(text) => void commitDraft(text, null)}
                      onSplit={(before, after) => void commitDraft(before, { text: after })}
                    />
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
      {saveError && <p className="text-error">{saveError}</p>}
      {pendingDelete && (
        <ConfirmDialog
          title="刪除這個寫法？"
          message={`「${pendingDelete.text}」會從經歷資料庫移除；另一個語言如果有對應的寫法，也會一起刪掉。`}
          confirmLabel="刪除"
          pending={deleting}
          onConfirm={confirmDelete}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </div>
  );
}

/**
 * 經歷資料庫的一點（某個寫法）：Enter 拆成兩點、Shift + Enter 同一點換行（見 app/bulletEditing.ts）。
 * 離開時文字有變才存。
 */
function EditableBullet({
  value,
  onCommit,
  onSplit,
  autoFocus = false,
}: {
  value: string;
  onCommit: (text: string) => void;
  onSplit: (before: string, after: string) => void;
  autoFocus?: boolean;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  // 按 Enter 拆點時已經由 onSplit 存好了，接著失焦不要再存一次（同時寫同一筆資料會互相蓋掉）。
  const skipBlur = useRef(false);

  useEffect(() => {
    if (autoFocus && ref.current) placeCaret(ref.current, true);
  }, [autoFocus]);

  return (
    <span
      ref={ref}
      contentEditable
      // 鍵盤 Cmd/Ctrl + Z 用：跟存好的內容一樣才算「沒在打字」（見 app/useUndoShortcuts.ts）。
      data-committed={value}
      suppressContentEditableWarning
      onKeyDown={(e) => {
        if (isComposing(e) || e.key !== "Enter") return;
        e.preventDefault();
        if (e.shiftKey) {
          insertLineBreak(e.currentTarget);
          return;
        }
        const [before, after] = splitAtCaret(e.currentTarget);
        const head = cleanBulletText(before);
        e.currentTarget.textContent = head;
        skipBlur.current = true;
        e.currentTarget.blur();
        onSplit(head, cleanBulletText(after));
      }}
      onBlur={(e) => {
        if (skipBlur.current) {
          skipBlur.current = false;
          return;
        }
        const text = cleanBulletText(e.currentTarget.textContent ?? "");
        if (text !== value) onCommit(text);
      }}
      className="resume-editable resume-editable--editable exp-bullet-text"
    >
      {value}
    </span>
  );
}

function EditableSpan({
  value,
  onCommit,
  className,
}: {
  value: string;
  onCommit: (text: string) => void;
  className: string;
}) {
  return (
    <span
      contentEditable
      // 鍵盤 Cmd/Ctrl + Z 用：跟存好的內容一樣才算「沒在打字」（見 app/useUndoShortcuts.ts）。
      data-committed={value}
      suppressContentEditableWarning
      onBlur={(e) => {
        const text = e.currentTarget.textContent ?? "";
        if (text !== value) onCommit(text);
      }}
      className={`resume-editable resume-editable--editable ${className}`}
    >
      {value}
    </span>
  );
}
