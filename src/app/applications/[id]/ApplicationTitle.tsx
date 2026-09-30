"use client";

import { useState, useTransition } from "react";
import { PencilIcon } from "@/app/icons";
import { Spinner } from "@/app/ProgressBar";
import { updateApplicationTitleAction } from "./actions";
import { APPLICATION_STATUS_LABEL } from "../status";

// 應徵詳情頁的標題（公司名稱・職稱），旁邊的鉛筆圖示點了之後原地變成兩個輸入框。
export function ApplicationTitle({
  applicationId,
  companyName,
  jobTitle,
  status,
}: {
  applicationId: string;
  companyName: string | null;
  jobTitle: string | null;
  status: string;
}) {
  const [editing, setEditing] = useState(false);
  const [company, setCompany] = useState(companyName ?? "");
  const [title, setTitle] = useState(jobTitle ?? "");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function cancel() {
    setCompany(companyName ?? "");
    setTitle(jobTitle ?? "");
    setError(null);
    setEditing(false);
  }

  function save() {
    startTransition(async () => {
      const result = await updateApplicationTitleAction(applicationId, company, title);
      if (result.error) {
        setError(result.error);
        return;
      }
      setError(null);
      setEditing(false);
    });
  }

  if (!editing) {
    return (
      <div className="title-row">
        <h1 className="heading-page">
          {companyName || "未命名公司"} · {jobTitle || "未命名職缺"}
        </h1>
        <button
          type="button"
          className="icon-btn"
          aria-label="編輯公司名稱與職稱"
          title="編輯"
          onClick={() => setEditing(true)}
        >
          <PencilIcon />
        </button>
        <span
          className={status === "draft" ? "badge badge-neutral" : "badge badge-success"}
          title={status === "draft" ? undefined : "履歷畫布唯讀"}
        >
          {APPLICATION_STATUS_LABEL[status] ?? status}
        </span>
      </div>
    );
  }

  return (
    <form
      className="title-edit"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") cancel();
      }}
    >
      <label className="title-edit-field">
        <span className="text-muted-xs">公司名稱</span>
        <input className="input" value={company} onChange={(e) => setCompany(e.target.value)} autoFocus />
      </label>
      <label className="title-edit-field">
        <span className="text-muted-xs">職稱</span>
        <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <div className="toolbar-inline title-edit-actions">
        <button type="submit" className="btn btn-primary" disabled={isPending}>
          {isPending && <Spinner />}
          儲存
        </button>
        <button type="button" className="btn btn-secondary" onClick={cancel} disabled={isPending}>
          取消
        </button>
      </div>
      {error && <p className="confirm-error">{error}</p>}
    </form>
  );
}
