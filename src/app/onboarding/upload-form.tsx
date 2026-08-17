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
    <div className="space-y-6">
      <form ref={formRef} action={formAction} className="rounded-lg border border-neutral-200 bg-white p-6">
        <label htmlFor="files" className="block text-sm font-medium text-neutral-700">
          選擇履歷檔案（可多選，docx / doc / pdf，單檔 3MB 以內）
        </label>
        <input
          id="files"
          name="files"
          type="file"
          multiple
          accept=".docx,.doc,.pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/msword,application/pdf"
          required
          className="mt-2 block w-full text-sm text-neutral-600 file:mr-3 file:rounded-md file:border-0 file:bg-neutral-900 file:px-3 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-neutral-800"
        />

        {state.error && <p className="mt-3 text-sm text-red-600">{state.error}</p>}
        {state.success && (
          <p className="mt-3 text-sm text-green-600">已上傳 {state.uploaded} 份</p>
        )}

        <button
          type="submit"
          disabled={isPending}
          className="mt-4 rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
        >
          {isPending ? "上傳中…" : "上傳"}
        </button>
      </form>

      {resumes.length > 0 && (
        <div className="rounded-lg border border-neutral-200 bg-white p-6">
          <h2 className="text-sm font-semibold text-neutral-900">
            已上傳（{resumes.length} 份）
          </h2>
          <ul className="mt-3 divide-y divide-neutral-100">
            {resumes.map((r) => (
              <li key={r.id} className="flex items-center justify-between py-2 text-sm">
                <span className="truncate text-neutral-700">{r.file_name}</span>
                <div className="flex items-center gap-3 text-neutral-400">
                  <span>{(r.file_size_bytes / 1024).toFixed(0)} KB</span>
                  <form action={deleteUploadedResume.bind(null, r.id)}>
                    <button type="submit" className="text-red-500 hover:underline">
                      刪除
                    </button>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {resumes.length > 0 && <ParseButton />}
    </div>
  );
}
