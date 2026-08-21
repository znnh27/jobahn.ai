"use client";

import { useActionState, useRef } from "react";
import { uploadResumes, deleteUploadedResume } from "./actions";
import { ParseButton } from "./parse-button";

type ActionResult = { error?: string; success?: boolean; uploaded?: number };

const initialState: ActionResult = {};

type ResumeRow = {
  id: string;
  file_name: string;
  file_size_bytes: number;
  uploaded_at: string;
};

export function UploadForm({ resumes }: { resumes: ResumeRow[] }) {
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction, isPending] = useActionState(
    async (_prev: ActionResult, formData: FormData) => {
      const result = await uploadResumes(formData);
      if (result.success) {
        formRef.current?.reset();
      }
      return result;
    },
    initialState,
  );

  return (
    <div className="stack">
      <form ref={formRef} action={formAction} className="card">
        <label htmlFor="files" className="label">
          選擇履歷檔案（可多選，docx / doc / pdf，單檔 3MB 以內）
        </label>
        <input
          id="files"
          name="files"
          type="file"
          multiple
          accept=".docx,.doc,.pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/msword,application/pdf"
          required
          className="file-input"
        />

        {state.error && <p className="text-error mt-3">{state.error}</p>}
        {state.success && <p className="text-success mt-3">已上傳 {state.uploaded} 份</p>}

        <div className="btn-wrapper">
           <button type="submit" disabled={isPending} className="btn btn-primary mt-4">
          {isPending ? "上傳中…" : "上傳"}
          </button>
        </div>
       
      </form>

      {resumes.length > 0 && (
        <div className="card">
          <h2 className="heading-card">已上傳（{resumes.length} 份）</h2>
          <div className="file-list">
            {resumes.map((r) => (
              <div key={r.id} className="file-list-item">
                <span className="file-list-item-name">{r.file_name}</span>
                <div className="file-list-item-meta">
                  <span>{(r.file_size_bytes / 1024).toFixed(0)} KB</span>
                  <form action={deleteUploadedResume.bind(null, r.id)}>
                    <button type="submit" className="btn-link">
                      刪除
                    </button>
                  </form>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {resumes.length > 0 && <ParseButton />}
    </div>
  );
}
