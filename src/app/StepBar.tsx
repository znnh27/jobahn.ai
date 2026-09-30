"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { StepIndex } from "./steps";

// 每筆應徵的流程進度：新增職缺 → 修改履歷 → 寫求職信 → 完成。放在頁面標題下面，寬度跟下方版面一樣，
// 同時取代麵包屑：點已經走過的步驟就回到那一步。
// current 是「現在這一頁」是第幾步；reached 是「這筆應徵已經走到第幾步」（由應徵狀態決定）。
// 「新增職缺」建立後沒有頁面可回去，點了改成跳出視窗顯示當初貼的職缺內容（只能看）。

const STEPS = ["新增職缺", "修改履歷", "寫求職信", "完成"] as const;


export interface JobInfo {
  companyName: string | null;
  jobTitle: string | null;
  jobDescription: string | null;
}

export function StepBar({
  current,
  reached = current,
  applicationId,
  job,
}: {
  current: StepIndex;
  reached?: StepIndex;
  applicationId?: string;
  job?: JobInfo;
}) {
  const [showJob, setShowJob] = useState(false);

  const hrefFor = (i: number): string | null => {
    if (!applicationId) return null;
    if (i === 1) return `/applications/${applicationId}`;
    if (i === 2) return `/applications/${applicationId}/cover-letter`;
    return null;
  };

  return (
    <>
      <ol className="step-bar" aria-label="應徵流程">
        {STEPS.map((label, i) => {
          // 最後一步「完成」走到就算做完了，其他步驟要走過才算。
          const done = i < reached || (i === 3 && reached === 3);
          const isCurrent = i === current;
          const state = isCurrent ? "current" : done ? "done" : i <= reached ? "open" : "todo";
          const content = (
            <>
              <span className="step-bar-dot">{done && !isCurrent ? "✓" : i + 1}</span>
              <span className="step-bar-label">{label}</span>
            </>
          );
          const href = !isCurrent && i <= reached ? hrefFor(i) : null;
          const canShowJob = i === 0 && !isCurrent && !!job;
          return (
            <li key={label} className={`step-bar-item step-bar-item--${state}`} aria-current={isCurrent ? "step" : undefined}>
              {href ? (
                <Link href={href} className="step-bar-link">
                  {content}
                </Link>
              ) : canShowJob ? (
                <button type="button" className="step-bar-link" onClick={() => setShowJob(true)}>
                  {content}
                </button>
              ) : (
                <span className="step-bar-link">{content}</span>
              )}
            </li>
          );
        })}
      </ol>

      {showJob && job && <JobDialog job={job} onClose={() => setShowJob(false)} />}
    </>
  );
}

function JobDialog({ job, onClose }: { job: JobInfo; onClose: () => void }) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <div className="confirm-overlay" onClick={onClose}>
      <div
        className="confirm-card job-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="job-dialog-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="job-dialog-title" className="heading-card--lg">
          {job.companyName || "未命名公司"}・{job.jobTitle || "未命名職缺"}
        </h2>
        <p className="text-muted-xs">當初新增這筆應徵時貼上的職缺內容</p>
        <div className="job-dialog-jd">{job.jobDescription || "（沒有職缺內容）"}</div>
        <div className="btn-wrapper">
          <button type="button" className="btn btn-secondary" onClick={onClose} autoFocus>
            關閉
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
