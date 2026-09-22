"use client";

import { useState } from "react";
import { ExperienceCanvas, type ExperienceEntry, type HighlightTarget } from "./ExperienceCanvas";
import { UploadSourceCard } from "./UploadSourceCard";
import { ElicitationPanel } from "./ElicitationPanel";
import { scanExperienceDbAction, type ScanFlag } from "./actions";

interface RefineSeed {
  entryId: string;
  achievementId: string;
  variantIndex: number;
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
  const [flags, setFlags] = useState<ScanFlag[]>([]);
  const [isScanning, setIsScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);

  const hasZh = entries.some((e) => e.language === "zh");
  const hasEn = entries.some((e) => e.language === "en");

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

  function openRefine(seed: RefineSeed) {
    setHighlight({
      entryId: seed.entryId,
      achievementId: seed.achievementId,
      variantIndex: seed.variantIndex,
      color: "editing",
    });
    setPanel({ mode: "refine", seed });
  }

  function handleCommitted(info: { entryId: string; achievementId: string; variantIndex: number }) {
    setHighlight({
      entryId: info.entryId,
      achievementId: info.achievementId,
      variantIndex: info.variantIndex,
      color: "updated",
    });
    // 這條/這個成就已經處理過了，之前掃描標記的警示要跟著清掉，不然使用者會覺得
    // 「我明明改完了，怎麼黃底警示還在」。同一個 achievement 底下不管標記的是哪個
    // variantIndex 都一併清掉，因為潤飾可能連帶更新了同一組裡的其他寫法。
    setFlags((prev) =>
      prev.filter((f) => !(f.entryId === info.entryId && f.achievementId === info.achievementId)),
    );
  }

  function clearHighlightIfIdle() {
    if (!panel) setHighlight(null);
  }

  return (
    <>
      <div className="canvas-layout">
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

        <div className="canvas-main" onClick={clearHighlightIfIdle}>
          <ExperienceCanvas
            entries={entries}
            language={activeLanguage}
            onRefine={openRefine}
            highlight={highlight}
            flags={flags}
            isScanning={isScanning}
            scanError={scanError}
            onScan={handleScan}
          />
        </div>
        <div className="canvas-sidebar">
          {sidebarTab === "upload" ? (
            <UploadSourceCard />
          ) : (
            <div className="card">
              <h2 className="heading-card">跟 AI 聊，新增一段經歷</h2>
              <p className="text-muted mt-1">
                腦中有一段經歷還沒整理成文字？直接跟 AI 聊，它會問出細節、幫你寫成專業的履歷寫法。這次會新增到「
                {activeLanguage === "zh" ? "中文履歷" : "英文履歷"}
                」，並且幫你同步到{activeLanguage === "zh" ? "英文履歷" : "中文履歷"}中。
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
