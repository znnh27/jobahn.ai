"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { uploadAndMergeResumeAction } from "@/app/experience/actions";

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

export function OnboardingUpload() {
  const inputRef = useRef<HTMLInputElement>(null);
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
                    message: `新增 ${result.newEntriesCreated} 段全新經歷、${result.newAchievementsCreated} 個新成就`,
                  }
                : { ...item, status: "error", message: result.error }
              : item,
          ),
        );
      });
    });
  }

  return (
    <div className="stack">
      <div className="card">
        <label className="label">選擇履歷檔案（可多選，docx / doc / pdf，單檔 3MB 以內）</label>

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
          <span className="file-drop-zone-hint">
            可一次選多個檔案，上傳完自動解析，docx / doc / pdf，單檔 3MB 以內
          </span>
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

      {hasSuccess && (
        <div className="card">
          <p className="text-success">
            經歷資料庫已經開始建立了！你可以直接開始寫第一份履歷，或繼續上傳更多版本讓內容更完整。
          </p>
          <div className="toolbar-inline mt-3">
            <Link href="/applications/new" className="btn btn-primary">
              開始寫第一份履歷
            </Link>
            <Link href="/experience" className="btn btn-secondary">
              查看經歷資料庫
            </Link>
            <Link href="/" className="link-muted">
              回首頁
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
