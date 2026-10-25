"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useTransition,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { deleteApplicationAction } from "@/app/applications/[id]/actions";
import {
  setJobUrlAction,
  setMilestoneAction,
} from "./applicationTrackingActions";
import { ConfirmDialog } from "./ConfirmDialog";
import { TrashIcon } from "./icons";
import { APPLICATION_STATUS_LABEL } from "./applications/status";
import { Celebration, type CelebrationKind } from "./Celebration";
import {
  MILESTONES,
  computeFunnel,
  currentStage,
  dateKeyToIso,
  formatTaipeiDate,
  formatTaipeiShortDate,
  taipeiDateKey,
  type MilestoneKey,
} from "@/lib/jobs/milestones";

export type ApplicationRow = {
  id: string;
  company_name: string | null;
  job_title: string | null;
  status: string;
  ats_score: number | null;
  resume_language: string[] | null;
  created_at: string;
  job_source_url: string | null;
  submitted_at: string | null;
  interview_at: string | null;
  offer_at: string | null;
};

function rowTitle(app: ApplicationRow) {
  return `${app.company_name || "未命名公司"}・${app.job_title || "未命名職缺"}`;
}

// 首頁應徵紀錄，由上到下：
// - 招呼語＋求職漏斗（投出去 → 面試 → Offer 每一關的筆數、轉換率、平均天數），同一區，在「應徵紀錄」標題上面。
// - 面試跟 Offer 連動：勾 Offer get! 會順便勾面試 get（同一天），取消面試 get 會一起取消 Offer get!。
//   漏斗要跟著表格的勾選即時更新，所以跟表格放在同一個元件裡；招呼語（intro）、「應徵紀錄」標題（header）由頁面傳進來。
// - 表格卡片，新的在上面（排序切換 2026-10-23 先拿掉了）。
// - 表格不用左右滑：職缺連結併進「職缺」欄（名稱後面的 ↗）；三個進度合成「求職進度」一欄，點了才展開勾選；
//   公司、職缺太長用「…」截斷，滑過看全名。
// - 整列可點進詳情頁；連結、進度、下載、刪除這些地方點了不會跳頁。
// - 進度點了馬上存（存勾選的時間），勾「面試 get」「Offer get!」會跳出吉祥物慶祝畫面。
// - 垃圾桶只在滑過那一列時出現，刪除前跳確認視窗。
export function ApplicationsTable({
  applications,
  intro,
  header,
}: {
  applications: ApplicationRow[];
  /** 「應徵紀錄」標題＋新增應徵按鈕，放在漏斗跟表格中間。 */
  header: ReactNode;
  /** 招呼語（吉祥物＋Hi! 名字），漏斗接在它正下方，兩個是同一區。 */
  intro: ReactNode;
}) {
  const router = useRouter();
  const [rows, setRows] = useState(applications);
  // 伺服器重新給資料（例如刪除後 refresh）就換掉本地的那份。
  const [sourceApplications, setSourceApplications] = useState(applications);
  if (applications !== sourceApplications) {
    setSourceApplications(applications);
    setRows(applications);
  }
  const [pendingDelete, setPendingDelete] = useState<ApplicationRow | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [celebration, setCelebration] = useState<CelebrationKind | null>(null);
  const closeCelebration = useCallback(() => setCelebration(null), []);

  const sorted = [...rows].sort(
    (a, b) => Date.parse(b.created_at) - Date.parse(a.created_at),
  );
  const funnel = computeFunnel(rows);

  function patchRow(id: string, patch: Partial<ApplicationRow>) {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  async function setMilestone(
    app: ApplicationRow,
    key: MilestoneKey,
    at: string | null,
  ) {
    const field = MILESTONES.find((m) => m.key === key)!.field;
    // 面試跟 Offer 連動：拿到 Offer 一定面試過，沒面試就不會有 Offer。
    // - 勾 Offer get! 時面試 get 還沒勾 → 面試用同一天一起勾起來。
    // - 取消面試 get 時 Offer get! 有勾 → Offer 一起取消。
    const linked: Partial<Record<MilestoneKey, string | null>> = { [key]: at };
    if (key === "offer" && at !== null && !app.interview_at)
      linked.interview = at;
    if (key === "interview" && at === null && app.offer_at) linked.offer = null;

    const fieldOf = (k: MilestoneKey) =>
      MILESTONES.find((m) => m.key === k)!.field;
    const entries = Object.entries(linked) as [MilestoneKey, string | null][];
    const before = Object.fromEntries(
      entries.map(([k]) => [fieldOf(k), app[fieldOf(k)]]),
    );
    patchRow(
      app.id,
      Object.fromEntries(entries.map(([k, v]) => [fieldOf(k), v])),
    );
    setRowError(null);
    // 只有「勾起來」的那一刻慶祝；取消勾選、改日期都不播。順帶勾的面試不另外播，只播 Offer。
    if (at && !app[field] && (key === "interview" || key === "offer"))
      setCelebration(key);
    const results = await Promise.all(
      entries.map(([k, v]) => setMilestoneAction(app.id, k, v)),
    );
    const failed = results.find((r) => r.error);
    if (failed?.error) {
      patchRow(app.id, before);
      setRowError(`「${rowTitle(app)}」沒有存到（${failed.error}）`);
    }
  }

  async function saveJobUrl(app: ApplicationRow, raw: string) {
    const result = await setJobUrlAction(app.id, raw);
    if (result.error) return result.error;
    patchRow(app.id, { job_source_url: result.url ?? null });
    return null;
  }

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
      <section className="home-dashboard">
        {intro}
        <Funnel stages={funnel} />
      </section>
      {/* 「應徵紀錄」標題跟表格包在一起、貼近一點。 */}
      <div className="applications-section">
        {header}
        {rowError && (
          <p className="text-error applications-row-error">{rowError}</p>
        )}

        <div className="applications-card">
          <div className="table-wrap table-wrap--flush">
            <table className="data-table">
              <thead>
                <tr>
                  <th>建立日期</th>
                  <th>公司</th>
                  <th>職缺</th>
                  <th>文件進度</th>
                  <th>JD 符合度</th>
                  <th>下載履歷</th>
                  <th>求職進度</th>
                  <th aria-label="操作" />
                </tr>
              </thead>
              <tbody>
                {sorted.map((app) => (
                  <tr
                    key={app.id}
                    className="data-table-row--link"
                    onClick={() => router.push(`/applications/${app.id}`)}
                  >
                    <td className="data-table-cell--muted">
                      {formatTaipeiDate(app.created_at)}
                    </td>
                    <td>
                      <span
                        className="data-table-truncate data-table-truncate--company"
                        title={app.company_name ?? undefined}
                      >
                        {app.company_name || "未命名公司"}
                      </span>
                    </td>
                    <td>
                      <JobTitleCell
                        title={app.job_title}
                        url={app.job_source_url}
                        onSaveUrl={(raw) => saveJobUrl(app, raw)}
                      />
                    </td>
                    <td>
                      {APPLICATION_STATUS_LABEL[app.status] ?? app.status}
                    </td>
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
                    <td onClick={(e) => e.stopPropagation()}>
                      <ProgressCell
                        app={app}
                        onChange={(key, at) => setMilestone(app, key, at)}
                      />
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
          </div>
        </div>
      </div>

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

      {celebration && (
        <Celebration
          key={celebration}
          kind={celebration}
          onClose={closeCelebration}
        />
      )}
    </>
  );
}

/**
 * 求職漏斗：一張卡片（#fffef9 底），三個大數字分在左、中、右，中間是拉滿的箭頭，
 * 箭頭上面是這一關對上一關的轉換率、下面是平均天數。沒有標題，接在招呼語下面。還沒資料時一樣顯示（0、—）。
 */
function Funnel({ stages }: { stages: ReturnType<typeof computeFunnel> }) {
  return (
    <section className="funnel" aria-label="求職漏斗">
      <ol className="funnel-stages">
        {stages.map((stage, i) => (
          <li key={stage.key} className="funnel-item">
            {i > 0 && (
              <span
                className="funnel-step"
                aria-label={`轉換率 ${stage.rate ?? "—"}%，平均 ${stage.avgDays ?? "—"} 天`}
              >
                <span className="funnel-step-rate">
                  {stage.rate === null ? "—" : `${stage.rate}%`}
                </span>
                <span className="funnel-step-line" aria-hidden="true" />
                <span className="funnel-step-days">
                  {stage.avgDays === null ? "— 天" : `平均 ${stage.avgDays} 天`}
                </span>
              </span>
            )}
            <span className="funnel-stage">
              <span className="funnel-count">{stage.count}</span>
              <span className="funnel-label">{stage.label}</span>
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}

const STAGE_LABEL: Record<MilestoneKey, string> = {
  submitted: "已投遞",
  interview: "面試中",
  offer: "Offer get!",
};

/** 求職進度：平常只顯示目前走到哪（例如「已投遞・10/23」），點了才展開三個勾選項目跟日期。 */
function ProgressCell({
  app,
  onChange,
}: {
  app: ApplicationRow;
  onChange: (key: MilestoneKey, at: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const stage = currentStage(app);
  const stageAt = stage
    ? app[MILESTONES.find((m) => m.key === stage)!.field]
    : null;

  function toggle() {
    if (open) {
      setOpen(false);
      return;
    }
    // 表格外框會左右捲動、會裁掉超出去的東西，所以彈出框掛在 <body> 上，用按鈕的位置定位。
    const rect = buttonRef.current!.getBoundingClientRect();
    setPos({
      top: rect.bottom + 6,
      left: Math.min(rect.left, window.innerWidth - 236),
    });
    setOpen(true);
  }

  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      const target = e.target as Node;
      if (
        popoverRef.current?.contains(target) ||
        buttonRef.current?.contains(target)
      )
        return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onScroll = () => setOpen(false);
    document.addEventListener("pointerdown", close);
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      document.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [open]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={`stage-pill stage-pill--${stage ?? "none"}`}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={toggle}
      >
        {stage ? STAGE_LABEL[stage] : "未投遞"}
        {stageAt && (
          <span className="stage-pill-date">
            ・{formatTaipeiShortDate(stageAt)}
          </span>
        )}
        <span className="stage-pill-caret" aria-hidden="true" />
      </button>
      {open &&
        pos &&
        createPortal(
          <div
            ref={popoverRef}
            className="progress-popover"
            role="dialog"
            aria-label={`${rowTitle(app)} 的求職進度`}
            style={{ top: pos.top, left: pos.left }}
          >
            {MILESTONES.map((m) => (
              <MilestoneRowItem
                key={m.key}
                label={m.label}
                at={app[m.field]}
                onChange={(at) => onChange(m.key, at)}
              />
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}

/** 求職進度彈出框裡的一列：勾選框＋名稱＋日期。勾了之後右邊出現日期（例如 10/23），點日期可以改成實際的那天。 */
function MilestoneRowItem({
  label,
  at,
  onChange,
}: {
  label: string;
  at: string | null;
  onChange: (at: string | null) => void;
}) {
  const dateRef = useRef<HTMLInputElement>(null);

  function openPicker() {
    const input = dateRef.current;
    if (!input) return;
    try {
      input.showPicker();
    } catch {
      input.focus();
    }
  }

  return (
    <div className="progress-row">
      <label className="progress-row-label">
        <input
          type="checkbox"
          className="milestone-checkbox"
          checked={!!at}
          onChange={(e) =>
            onChange(e.target.checked ? new Date().toISOString() : null)
          }
        />
        {label}
      </label>
      {at && (
        <span className="milestone-date-wrap">
          <button
            type="button"
            className="milestone-date"
            onClick={openPicker}
            title="點一下可以改日期"
          >
            {formatTaipeiShortDate(at)}
          </button>
          <input
            ref={dateRef}
            type="date"
            className="milestone-date-input"
            tabIndex={-1}
            aria-label={`${label}的日期`}
            value={taipeiDateKey(at)}
            max={taipeiDateKey(new Date().toISOString())}
            onChange={(e) => {
              if (e.target.value) onChange(dateKeyToIso(e.target.value));
            }}
          />
        </span>
      )}
    </div>
  );
}

/**
 * 職缺欄：職缺名稱（太長用「…」，滑過看全名）＋連結。
 * 有網址就在名稱後面放 ↗（新分頁開職缺頁）；沒有就是滑過整列才出現的「＋ 連結」，點了直接貼網址，Enter 存、Esc 取消。
 */
function JobTitleCell({
  title,
  url,
  onSaveUrl,
}: {
  title: string | null;
  url: string | null;
  onSaveUrl: (raw: string) => Promise<string | null>;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(url ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save() {
    if (saving) return;
    if (value.trim() === (url ?? "")) {
      setEditing(false);
      return;
    }
    setSaving(true);
    const err = await onSaveUrl(value);
    setSaving(false);
    setError(err);
    if (!err) setEditing(false);
  }

  if (editing) {
    return (
      <span className="job-url-edit" onClick={(e) => e.stopPropagation()}>
        <input
          type="url"
          className="input job-url-input"
          autoFocus
          placeholder="貼上職缺網址"
          value={value}
          disabled={saving}
          onChange={(e) => setValue(e.target.value)}
          onBlur={save}
          onKeyDown={(e) => {
            if (e.key === "Enter") void save();
            if (e.key === "Escape") {
              setValue(url ?? "");
              setError(null);
              setEditing(false);
            }
          }}
        />
        {error && <span className="text-error job-url-error">{error}</span>}
      </span>
    );
  }

  return (
    <span className="job-title-cell">
      <span
        className="data-table-truncate data-table-truncate--job"
        title={title ?? undefined}
      >
        {title || "—"}
      </span>
      {url ? (
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className="job-url-open"
          title="開啟職缺頁面"
          aria-label="開啟職缺頁面"
          onClick={(e) => e.stopPropagation()}
        >
          <ExternalIcon />
        </a>
      ) : (
        <button
          type="button"
          className="job-url-add"
          onClick={(e) => {
            e.stopPropagation();
            setEditing(true);
          }}
        >
          ＋ 連結
        </button>
      )}
    </span>
  );
}

/** 外部連結圖示（↗）。 */
function ExternalIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 14 14" aria-hidden="true">
      <path
        d="M8 2 H12 V6 M12 2 L6.5 7.5 M10.5 8.5 V11.5 a0.5 0.5 0 0 1 -0.5 0.5 H2.5 a0.5 0.5 0 0 1 -0.5 -0.5 V4 a0.5 0.5 0 0 1 0.5 -0.5 H5.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
