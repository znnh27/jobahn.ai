"use client";

import { useState } from "react";
import { ConfirmDialog } from "@/app/ConfirmDialog";
import { ResumePaper } from "@/app/ResumePaper";
import type { ResumeLayoutSettings } from "@/lib/resumes/typography";
import { getSectionLabels } from "@/lib/resumes/sectionLabels";
import type { StoredFlag } from "@/lib/experience/storedFlag";
import {
  updateEntryFieldAction,
  updatePeriodAction,
  updateRoleVariantAction,
  removeRoleVariantAction,
  updateAchievementVariantAction,
  removeAchievementVariantAction,
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
  language,
  layout,
  onActivateFlag,
  highlight,
  flags,
  activeFlagKey,
}: {
  entries: ExperienceEntry[];
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

  if (langEntries.length === 0) {
    return (
      <div className="card exp-empty-state">
        {language === "zh" ? "還沒有中文版的經歷資料。" : "還沒有英文版的經歷資料。"}
        按上面的「新增經歷」上傳一份履歷或跟 AI 聊，或等你完成第一次應徵，內容就會自動記錄在這裡。
      </div>
    );
  }

  const labels = getSectionLabels(language);
  const workEntries = langEntries.filter((e) => e.entryType === "work");
  const leadershipEntries = langEntries.filter((e) => e.entryType !== "work");

  return (
    <ResumePaper language={language} layout={layout}>
      {workEntries.length > 0 && (
        <>
          <div className="resume-section-header">{labels.experience}</div>
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
          <div className="resume-section-header">{labels.leadership}</div>
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
    </ResumePaper>
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
                      <EditableSpan
                        className=""
                        value={v.text}
                        onCommit={(text) => updateAchievementVariantAction(entry.id, ach.id, vi, text)}
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
            </div>
          );
        })}
      </div>
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
