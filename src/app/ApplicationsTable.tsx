"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteApplicationAction } from "@/app/applications/[id]/actions";
import { ConfirmDialog } from "./ConfirmDialog";
import { TrashIcon } from "./icons";
import { APPLICATION_STATUS_LABEL } from "./applications/status";

type ApplicationRow = {
  id: string;
  company_name: string | null;
  job_title: string | null;
  status: string;
  ats_score: number | null;
  resume_language: string[] | null;
};

function rowTitle(app: ApplicationRow) {
  return `${app.company_name || "未命名公司"}・${app.job_title || "未命名職缺"}`;
}

// 首頁應徵紀錄：整列可點進詳情頁，垃圾桶只在滑過那一列時出現，刪除前跳確認視窗。
export function ApplicationsTable({ applications }: { applications: ApplicationRow[] }) {
  const router = useRouter();
  const [pendingDelete, setPendingDelete] = useState<ApplicationRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function confirmDelete() {
    if (!pendingDelete) return;
    const id = pendingDelete.id;
    startTransition(async () => {
      const result = await deleteApplicationAction(id);
      if (result.error) {
        setError(result.error);
        return;
      }
      setPendingDelete(null);
      router.refresh();
    });
  }

  return (
    <>
      <table className="data-table">
        <thead>
          <tr>
            <th>公司</th>
            <th>職缺</th>
            <th>狀態</th>
            <th>ATS</th>
            <th>下載履歷</th>
            <th aria-label="操作" />
          </tr>
        </thead>
        <tbody>
          {applications.map((app) => (
            <tr
              key={app.id}
              className="data-table-row--link"
              onClick={() => router.push(`/applications/${app.id}`)}
            >
              <td>{app.company_name || "未命名公司"}</td>
              <td>{app.job_title || "—"}</td>
              <td>{APPLICATION_STATUS_LABEL[app.status] ?? app.status}</td>
              <td>{app.ats_score ?? "—"}</td>
              <td onClick={(e) => e.stopPropagation()}>
                {app.status === "draft" ? (
                  "—"
                ) : (
                  <div className="download-lang-list">
                    {(app.resume_language ?? []).map((lang) => (
                      <span key={lang} className="download-lang-item">
                        {lang}：
                        <a
                          href={`/applications/${app.id}/resume-download?lang=${lang}&format=docx`}
                          className="link-table"
                        >
                          Word
                        </a>
                        {" / "}
                        <a
                          href={`/applications/${app.id}/resume-download?lang=${lang}&format=pdf`}
                          className="link-table"
                        >
                          PDF
                        </a>
                      </span>
                    ))}
                  </div>
                )}
              </td>
              <td className="data-table-cell--action">
                <button
                  type="button"
                  className="icon-btn icon-btn--danger data-table-row-action"
                  aria-label={`刪除 ${rowTitle(app)}`}
                  title="刪除"
                  onClick={(e) => {
                    e.stopPropagation();
                    setError(null);
                    setPendingDelete(app);
                  }}
                >
                  <TrashIcon />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {pendingDelete && (
        <ConfirmDialog
          title="刪除這筆應徵？"
          message={`確定刪除「${rowTitle(pendingDelete)}」？履歷和求職信會一起刪除，無法復原。`}
          confirmLabel="確定刪除"
          pending={isPending}
          error={error}
          onConfirm={confirmDelete}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </>
  );
}
