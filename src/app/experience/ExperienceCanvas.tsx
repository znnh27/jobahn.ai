"use client";

import { useState } from "react";
import {
  updateEntryFieldAction,
  updatePeriodAction,
  updateRoleVariantAction,
  removeRoleVariantAction,
  updateAchievementVariantAction,
  removeAchievementVariantAction,
  scanExperienceDbAction,
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
  achievements: { id: string; variants: { text: string; angleLabel: string; source: string }[] }[];
}

export interface RefineRequest {
  entryId: string;
  achievementId: string;
  orgName: string;
  role: string;
  seedText: string;
}

export interface HighlightTarget {
  entryId: string;
  achievementId: string;
  color: "editing" | "updated";
}

export function ExperienceCanvas({
  entries,
  language,
  onRefine,
  highlight,
}: {
  entries: ExperienceEntry[];
  language: "zh" | "en";
  onRefine: (seed: RefineRequest) => void;
  highlight: HighlightTarget | null;
}) {
  const [flags, setFlags] = useState<ScanFlag[]>([]);
  const [isScanning, setIsScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);

  const langEntries = entries.filter((e) => e.language === language);

  async function handleScan() {
    setIsScanning(true);
    setScanError(null);
    try {
      const result = await scanExperienceDbAction();
      if (result.error) setScanError(result.error);
      else setFlags(result.flags ?? []);
    } finally {
      setIsScanning(false);
    }
  }

  function flagFor(entryId: string, achievementId: string, variantIndex: number) {
    return flags.find(
      (f) => f.entryId === entryId && f.achievementId === achievementId && f.variantIndex === variantIndex,
    );
  }

  if (langEntries.length === 0) {
    return (
      <div className="card exp-empty-state">
        {language === "zh" ? "還沒有中文版的經歷資料。" : "還沒有英文版的經歷資料。"}
        從右邊上傳一份履歷，或等你完成第一次應徵，內容就會自動記錄在這裡。
      </div>
    );
  }

  const workEntries = langEntries.filter((e) => e.entryType === "work");
  const leadershipEntries = langEntries.filter((e) => e.entryType !== "work");

  return (
    <div className="resume-page" style={{ width: "100%" }}>
      <div className="card-toolbar">
        <button type="button" className="btn btn-secondary" disabled={isScanning} onClick={handleScan}>
          {isScanning ? "檢查中…" : "檢查整份經歷資料庫"}
        </button>
        {flags.length > 0 && <span className="text-muted">找到 {flags.length} 條建議加強</span>}
        {scanError && <span className="text-error">{scanError}</span>}
      </div>

      {workEntries.length > 0 && (
        <>
          <div className="resume-section-header">工作經歷</div>
          {workEntries.map((entry) => (
            <EntryBlock key={entry.id} entry={entry} flagFor={flagFor} onRefine={onRefine} highlight={highlight} />
          ))}
        </>
      )}

      {leadershipEntries.length > 0 && (
        <>
          <div className="resume-section-header">領導經驗／專案</div>
          {leadershipEntries.map((entry) => (
            <EntryBlock key={entry.id} entry={entry} flagFor={flagFor} onRefine={onRefine} highlight={highlight} />
          ))}
        </>
      )}
    </div>
  );
}

function EntryBlock({
  entry,
  flagFor,
  onRefine,
  highlight,
}: {
  entry: ExperienceEntry;
  flagFor: (entryId: string, achievementId: string, variantIndex: number) => ScanFlag | undefined;
  onRefine: (seed: RefineRequest) => void;
  highlight: HighlightTarget | null;
}) {
  const period = entry.periodVariants[0]?.period ?? "";
  const primaryRole = entry.roleVariants[0]?.role ?? "";

  return (
    <div className="exp-entry resume-block">
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
          const isHighlighted = highlight?.entryId === entry.id && highlight?.achievementId === ach.id;
          const highlightClass = isHighlighted
            ? highlight?.color === "editing"
              ? "exp-achievement--editing"
              : "exp-achievement--updated"
            : "";
          return (
            <div key={ach.id} className={`exp-achievement ${highlightClass}`}>
              {ach.variants.map((v, vi) => {
                const flag = flagFor(entry.id, ach.id, vi);
                return (
                  <div key={vi} className="exp-variant">
                    <span className="resume-bullet-dot">{"•"}</span>
                    <div className="exp-variant-bullet">
                      <EditableSpan
                        className=""
                        value={v.text}
                        onCommit={(text) => updateAchievementVariantAction(entry.id, ach.id, vi, text)}
                      />
                      <span className="exp-variant-tag">{v.angleLabel}</span>
                      {flag && (
                        <button
                          type="button"
                          className="exp-flag-marker"
                          title={flag.suggestion}
                          onClick={(e) => {
                            e.stopPropagation();
                            onRefine({
                              entryId: entry.id,
                              achievementId: ach.id,
                              orgName: entry.orgName,
                              role: primaryRole,
                              seedText: v.text,
                            });
                          }}
                        >
                          ⚠ {flag.suggestion}
                        </button>
                      )}
                    </div>
                    <button
                      type="button"
                      className="exp-refine-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        onRefine({
                          entryId: entry.id,
                          achievementId: ach.id,
                          orgName: entry.orgName,
                          role: primaryRole,
                          seedText: v.text,
                        });
                      }}
                    >
                      AI 潤飾
                    </button>
                    <button
                      type="button"
                      className="exp-variant-remove"
                      onClick={() => {
                        if (confirm("刪除這個寫法？")) {
                          removeAchievementVariantAction(entry.id, ach.id, vi);
                        }
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
