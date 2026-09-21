"use client";

import { useState } from "react";
import { ExperienceCanvas, type ExperienceEntry, type HighlightTarget } from "./ExperienceCanvas";
import { UploadSourceCard } from "./UploadSourceCard";
import { ElicitationPanel } from "./ElicitationPanel";

interface RefineSeed {
  entryId: string;
  achievementId: string;
  orgName: string;
  role: string;
  seedText: string;
}

type PanelState = { mode: "new" } | { mode: "refine"; seed: RefineSeed } | null;

export function ExperiencePageClient({ entries }: { entries: ExperienceEntry[] }) {
  const [panel, setPanel] = useState<PanelState>(null);
  const [sidebarTab, setSidebarTab] = useState<"upload" | "add">("upload");
  const [activeLanguage, setActiveLanguage] = useState<"zh" | "en">("zh");
  const [highlight, setHighlight] = useState<HighlightTarget | null>(null);

  const hasZh = entries.some((e) => e.language === "zh");
  const hasEn = entries.some((e) => e.language === "en");

  function openRefine(seed: RefineSeed) {
    setHighlight({ entryId: seed.entryId, achievementId: seed.achievementId, color: "editing" });
    setPanel({ mode: "refine", seed });
  }

  function handleCommitted(info: { entryId: string; achievementId: string }) {
    setHighlight({ entryId: info.entryId, achievementId: info.achievementId, color: "updated" });
  }

  function clearHighlightIfIdle() {
    if (!panel) setHighlight(null);
  }

  return (
    <>
      <div className="exp-lang-tabs">
        <button
          type="button"
          className={activeLanguage === "zh" ? "exp-lang-tab exp-lang-tab--active" : "exp-lang-tab"}
          onClick={() => setActiveLanguage("zh")}
        >
          中文履歷{!hasZh && "（尚無資料）"}
        </button>
        <button
          type="button"
          className={activeLanguage === "en" ? "exp-lang-tab exp-lang-tab--active" : "exp-lang-tab"}
          onClick={() => setActiveLanguage("en")}
        >
          英文履歷{!hasEn && "（尚無資料）"}
        </button>
      </div>

      <div className="canvas-layout">
        <div className="canvas-main" onClick={clearHighlightIfIdle}>
          <ExperienceCanvas entries={entries} language={activeLanguage} onRefine={openRefine} highlight={highlight} />
        </div>
        <div className="canvas-sidebar">
          <div className="exp-sidebar-tabs">
            <button
              type="button"
              className={sidebarTab === "upload" ? "exp-sidebar-tab exp-sidebar-tab--active" : "exp-sidebar-tab"}
              onClick={() => setSidebarTab("upload")}
            >
              上傳履歷來源
            </button>
            <button
              type="button"
              className={sidebarTab === "add" ? "exp-sidebar-tab exp-sidebar-tab--active" : "exp-sidebar-tab"}
              onClick={() => setSidebarTab("add")}
            >
              跟 AI 聊，新增經歷
            </button>
          </div>

          {sidebarTab === "upload" ? (
            <UploadSourceCard />
          ) : (
            <div className="card">
              <h2 className="heading-card">跟 AI 聊，新增一段經歷</h2>
              <p className="text-muted mt-1">
                腦中有一段經歷還沒整理成文字？直接跟 AI 聊，它會問出細節、幫你寫成專業的履歷寫法。這次會新增到「{activeLanguage === "zh" ? "中文履歷" : "英文履歷"}」。
              </p>
              <button
                type="button"
                className="btn btn-primary mt-3"
                onClick={() => setPanel({ mode: "new" })}
              >
                開始
              </button>
            </div>
          )}
        </div>
      </div>

      {panel && (
        <ElicitationPanel
          entries={entries.filter((e) => e.language === activeLanguage)}
          refineSeed={panel.mode === "refine" ? panel.seed : undefined}
          defaultLanguage={activeLanguage}
          onClose={() => setPanel(null)}
          onCommitted={handleCommitted}
        />
      )}
    </>
  );
}
