"use client";

import Link from "next/link";
import { useState } from "react";
import { EstimatedProgress } from "@/app/ProgressBar";
import { uploadAndMergeResumeAction } from "./actions";

type UploadItemState = {
  key: string;
  name: string;
  status: "uploading" | "done" | "error";
  message?: string;
};

function UploadCloudIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M7 18a4.5 4.5 0 0 1-.5-8.97A5 5 0 0 1 16.5 8H17a4 4 0 0 1 0 8h-1" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M12 11v8M9 15l3-3 3 3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
      <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// 經歷資料庫側欄面板「上傳履歷來源」分頁的內容（外框跟標題由面板提供）。
export function UploadSourceCard() {
  const [items, setItems] = useState<UploadItemState[]>([]);
  const [isDragActive, setIsDragActive] = useState(false);

  const hasSuccess = items.some((i) => i.status === "done");

  function handleFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;

    Array.from(fileList).forEach((file) => {
      const key = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      setItems((prev) => [...prev, { key, name: file.name, status: "uploading" }]);

      const formData = new FormData();
      formData.set("file", file);

      uploadAndMergeResumeAction(formData).then((result) => {
        setItems((prev) =>
          prev.map((item) =>
            item.key === key
              ? result.success
                ? {
                    ...item,
                    status: "done",
                    message: `新增 ${result.newEntriesCreated} 段全新經歷、${result.newAchievementsCreated} 個新成就、${result.variantsAppended} 個新寫法${result.backgroundItemsAdded ? `、${result.backgroundItemsAdded} 項 Summary／學歷／技能／語言` : ""}`,
                  }
                : { ...item, status: "error", message: result.error }
              : item,
          ),
        );
      }).catch(() => {
        // 請求本身失敗（斷網、逾時、伺服器掛掉）時也要把狀態改掉，不然會永遠停在「讀取中」，看起來像沒反應。
        setItems((prev) =>
          prev.map((item) =>
            item.key === key ? { ...item, status: "error", message: "上傳失敗，請檢查網路後再試一次" } : item,
          ),
        );
      });
    });
  }

  return (
    <div>
      {/* 用原生 <label> 包住選檔欄位，點擊由瀏覽器直接開選檔視窗。以前用程式代按 input.click()，
          但 input 的點擊會冒泡回拖放區再代按一次，Safari 遇到連開兩次會直接取消，視窗就跳不出來。 */}
      <label
        className={`file-drop-zone ${isDragActive ? "file-drop-zone--active" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragActive(true);
        }}
        onDragLeave={() => setIsDragActive(false)}
        onDrop={(e) => {
          e.preventDefault();
          setIsDragActive(false);
          handleFiles(e.dataTransfer.files);
        }}
      >
        <span className="file-drop-zone-icon">
          <UploadCloudIcon />
        </span>
        <span className="file-drop-zone-text">拖曳檔案到這裡，或點擊選擇</span>
        <span className="file-drop-zone-hint">可一次選多個檔案，docx / doc / pdf，單檔 3MB 以內</span>
        <input
          type="file"
          multiple
          accept=".docx,.doc,.pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/msword,application/pdf"
          onChange={(e) => {
            handleFiles(e.target.files);
            e.target.value = "";
          }}
          className="file-input-hidden"
        />
      </label>

      {items.length > 0 && (
        <div className="file-item-list">
          {items.map((item) => (
            <div key={item.key} className={`file-item ${item.status === "error" ? "file-item--error" : ""}`}>
              <div className="file-item-body">
                <div className="file-item-name">{item.name}</div>
                {item.status === "uploading" && (
                  <EstimatedProgress expectedMs={45000} label="AI 正在讀取內容、跟現有經歷比對合併…" />
                )}
                {item.status === "done" && <div className="file-item-status">{item.message}</div>}
                {item.status === "error" && (
                  <div className="file-item-status file-item-status--error">{item.message}</div>
                )}
              </div>
              {item.status === "done" && (
                <span className="file-item-check">
                  <CheckIcon />
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* 上傳完要給下一步，不然使用者停在這頁不知道要做什麼。 */}
      {hasSuccess && (
        <div className="mt-4">
          <p className="text-success">已經合併進經歷資料庫了！可以回去看看更新的內容，或直接開始新增應徵。</p>
          <div className="add-exp-done-actions">
            <Link href="/applications/new" className="btn btn-secondary">
              新增應徵
            </Link>
            <Link href="/experience" className="btn btn-primary">
              回經歷資料庫
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
