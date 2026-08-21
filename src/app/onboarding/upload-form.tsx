"use client";

import { useRef, useState } from "react";
import { uploadOneResumeAction, deleteUploadedResume } from "./actions";
import { ParseButton } from "./parse-button";

type ResumeRow = {
  id: string;
  file_name: string;
  file_size_bytes: number;
  uploaded_at: string;
};

type FileItemState = {
  key: string;
  name: string;
  sizeBytes: number;
  status: "uploading" | "done" | "error";
  error?: string;
  resumeId?: string;
};

function UploadCloudIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M7 18a4.5 4.5 0 0 1-.5-8.97A5 5 0 0 1 16.5 8H17a4 4 0 0 1 0 8h-1" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M12 11v8M9 15l3-3 3 3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function DocumentIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M7 3h7l4 4v14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M14 3v4h4M9 12h6M9 16h6" strokeLinecap="round" strokeLinejoin="round" />
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

export function UploadForm({ resumes }: { resumes: ResumeRow[] }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<FileItemState[]>(
    resumes.map((r) => ({
      key: r.id,
      name: r.file_name,
      sizeBytes: r.file_size_bytes,
      status: "done",
      resumeId: r.id,
    })),
  );
  const [isDragActive, setIsDragActive] = useState(false);

  const doneCount = items.filter((i) => i.status === "done").length;

  function handleFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;

    Array.from(fileList).forEach((file) => {
      const key = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      setItems((prev) => [
        ...prev,
        { key, name: file.name, sizeBytes: file.size, status: "uploading" },
      ]);

      const formData = new FormData();
      formData.set("file", file);

      uploadOneResumeAction(formData).then((result) => {
        setItems((prev) =>
          prev.map((item) =>
            item.key === key
              ? result.success && result.resume
                ? {
                    ...item,
                    status: "done",
                    resumeId: result.resume.id,
                    sizeBytes: result.resume.file_size_bytes,
                  }
                : { ...item, status: "error", error: result.error }
              : item,
          ),
        );
      });
    });
  }

  async function handleRemove(item: FileItemState) {
    setItems((prev) => prev.filter((i) => i.key !== item.key));
    if (item.resumeId) {
      await deleteUploadedResume(item.resumeId);
    }
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
                <div className="file-item-icon">
                  <DocumentIcon />
                </div>
                <div className="file-item-body">
                  <div className="file-item-name">{item.name}</div>
                  {item.status === "uploading" && (
                    <>
                      <div className="file-item-status">上傳中…</div>
                      <div className="file-item-progress-track">
                        <div className="file-item-progress-fill" />
                      </div>
                    </>
                  )}
                  {item.status === "done" && (
                    <div className="file-item-status">
                      已上傳 · {(item.sizeBytes / 1024).toFixed(0)} KB
                    </div>
                  )}
                  {item.status === "error" && (
                    <div className="file-item-status file-item-status--error">{item.error}</div>
                  )}
                </div>
                {item.status === "done" && <span className="file-item-check"><CheckIcon /></span>}
                <button type="button" onClick={() => handleRemove(item)} className="file-item-remove">
                  刪除
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {doneCount > 0 && <ParseButton />}
    </div>
  );
}
