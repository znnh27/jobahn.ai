"use client";

import Link from "next/link";
import { useState } from "react";
import { ElicitationPanel } from "./experience/ElicitationPanel";
import type { ExperienceEntry } from "./experience/ExperienceCanvas";
import { UploadSourceCard } from "./experience/UploadSourceCard";
import { OnboardingUpload } from "./onboarding/OnboardingUpload";

type Path = "upload" | "type";

// 新增經歷的兩條入口，首次設定（onboarding）跟經歷資料庫的「新增經歷」共用同一個元件：
// 一張卡片、上面兩個分頁（上傳履歷／跟 AI 聊），下面是分頁內容。兩條路最後都進到同一套 AI 問答。
// 兩個地方只差分頁文字、上傳後的處理、完成後要去哪。

const COPY = {
  onboarding: {
    upload: { title: "我有履歷，幫我優化", desc: "上傳現有的履歷檔，AI 會拆解整理進經歷資料庫，之後再一條一條幫你加強。" },
    type: { title: "還沒有履歷，從零寫第一份", desc: "說說你做過的事，AI 會一步步追問，陪你寫出第一份履歷。" },
  },
  experience: {
    upload: { title: "新增履歷來源", desc: "用其他軟體另外寫過履歷嗎？上傳之後會自動跟現有內容比對合併，不會重複。" },
    type: { title: "跟 AI 聊，新增經歷", desc: "腦中有一段經歷還沒整理成文字？直接跟 AI 聊，它會問出細節、幫你寫成專業的履歷寫法。" },
  },
} as const;

export function AddExperienceChoice({
  mode,
  entries = [],
  language = "zh",
}: {
  mode: "onboarding" | "experience";
  /** 經歷資料庫模式：AI 問答可以選擇加到既有的經歷底下。 */
  entries?: ExperienceEntry[];
  language?: "zh" | "en";
}) {
  const copy = COPY[mode];
  const [path, setPath] = useState<Path>("upload");
  const [panelOpen, setPanelOpen] = useState(false);
  const [typedCount, setTypedCount] = useState(0);

  return (
    <div className="card add-exp-card">
      <div className="add-exp-tabs" role="tablist" aria-label="選擇新增方式">
        {(["upload", "type"] as const).map((p) => (
          <button
            key={p}
            id={`add-exp-tab-${p}`}
            type="button"
            role="tab"
            aria-selected={path === p}
            aria-controls="add-exp-panel"
            className={path === p ? "add-exp-tab add-exp-tab--active" : "add-exp-tab"}
            onClick={() => setPath(p)}
          >
            {copy[p].title}
          </button>
        ))}
      </div>

      <div id="add-exp-panel" role="tabpanel" aria-labelledby={`add-exp-tab-${path}`} className="add-exp-panel">
        <p className="text-muted">{copy[path].desc}</p>

        {path === "upload" && (mode === "onboarding" ? <OnboardingUpload /> : <UploadSourceCard />)}

        {path === "type" && typedCount > 0 && (
          <div>
            <p className="text-success">
              已經新增 {typedCount} 段經歷到經歷資料庫了！
              {mode === "onboarding" ? "可以直接開始寫第一份履歷，或再多加幾段讓內容更完整。" : "可以再新增一段，或回經歷資料庫看看。"}
            </p>
            <div className="toolbar-inline mt-3">
              {mode === "onboarding" ? (
                <Link href="/applications/new" className="btn btn-sunny">
                  開始寫第一份履歷
                </Link>
              ) : (
                <Link href="/experience" className="btn btn-primary">
                  回經歷資料庫
                </Link>
              )}
              <button type="button" className="btn btn-secondary" onClick={() => setPanelOpen(true)}>
                再新增一段
              </button>
              {mode === "onboarding" && (
                <Link href="/experience" className="link-muted">
                  查看經歷資料庫
                </Link>
              )}
            </div>
          </div>
        )}

        {path === "type" && typedCount === 0 && (
          <>
            <div className="add-exp-start-hint">
              <p className="text-muted">準備好了就開始，AI 會先問這段經歷的公司和職稱。</p>
            </div>
            <button type="button" className="btn btn-primary add-exp-start-btn" onClick={() => setPanelOpen(true)}>
              開始
            </button>
          </>
        )}
      </div>

      {panelOpen && (
        <ElicitationPanel
          entries={entries.filter((e) => e.language === language)}
          defaultLanguage={language}
          onClose={() => setPanelOpen(false)}
          onCommitted={() => setTypedCount((n) => n + 1)}
        />
      )}
    </div>
  );
}
