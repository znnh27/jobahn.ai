"use client";

import { useRef, useState } from "react";
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

export function UploadSourceCard() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<UploadItemState[]>([]);
  const [isDragActive, setIsDragActive] = useState(false);

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
                    message: `新增 ${result.newEntriesCreated} 段全新經歷、${result.newAchievementsCreated} 個新成就、${result.variantsAppended} 個新寫法`,
                  }
                : { ...item, status: "error", message: result.error }
              : item,
          ),
        );
      });
    });
  }

  return (
    <div className="card">
      <h2 className="heading-card">＋ 新增履歷來源</h2>
      <p className="text-muted mt-1">
        用其他軟體另外寫過履歷嗎？上傳之後會自動跟現有內容比對合併，不會重複。
      </p>

      <div
        className={`file-drop-zone ${isDragActive ? "file-drop-zone--active" : ""}`}
        onClick={() => inputRef.current?.click()}
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
        <div className="file-drop-zone-icon">
          <UploadCloudIcon />
        </div>
        <span className="file-drop-zone-text">拖曳檔案到這裡，或點擊選擇</span>
        <span className="file-drop-zone-hint">可一次選多個檔案，docx / doc / pdf，單檔 3MB 以內</span>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept=".docx,.doc,.pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/msword,application/pdf"
          onChange={(e) => {
            handleFiles(e.target.files);
            e.target.value = "";
          }}
          className="file-input-hidden"
        />
      </div>

      {items.length > 0 && (
        <div className="file-item-list">
          {items.map((item) => (
            <div key={item.key} className={`file-item ${item.status === "error" ? "file-item--error" : ""}`}>
              <div className="file-item-body">
                <div className="file-item-name">{item.name}</div>
                {item.status === "uploading" && (
                  <>
                    <div className="file-item-status">解析中…</div>
                    <div className="file-item-progress-track">
                      <div className="file-item-progress-fill" />
                    </div>
                  </>
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
    </div>
  );
}
