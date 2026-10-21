"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  generateAction,
  rescoreAction,
  answerWorkConditionAction,
  saveDraftAction,
  finalizeResumeAction,
  reopenResumeAction,
  suggestTrimAction,
  measureResumesAction,
  saveLayoutAction,
  type TrimSuggestion,
} from "./actions";
import { ConfirmDialog } from "@/app/ConfirmDialog";
import { ResumePageCanvas } from "./ResumePageCanvas";
import { TrimDialog, applyTrimSuggestions, findMinimalTrim } from "./TrimDialog";
import { LayoutMenu } from "@/app/LayoutMenu";
import {
  readLayoutSettings,
  resolveMetrics,
  type PdfFit,
  type ResumeLayoutSettings,
} from "@/lib/resumes/typography";
import { JdGapDialog } from "./JdGapDialog";
import { LangSwitch } from "@/app/LangSwitch";
import { ProgressBar, Spinner, useEstimatedProgress } from "@/app/ProgressBar";
import type { GeneratedResume } from "@/lib/resumes/generateResume";
import { hasRequiredContact, type ResumeContact } from "@/lib/resumes/contact";
import { ContactDialog } from "@/app/ContactForm";
import { CloseIcon, UndoIcon } from "@/app/icons";
import { computeAtsScore, coveredByResume } from "@/lib/resumes/atsScore";
import { JdChecklist } from "./JdChecklist";
import { InfoTip } from "@/app/InfoTip";
import { ResumeChatPanel } from "./ResumeChatPanel";
import { splitList } from "@/lib/resumes/background";
import {
  CoverLetterOptionsFields,
  choiceInvalid,
  choiceToQuery,
  initialChoice,
  type CoverLetterChoice,
} from "./cover-letter/CoverLetterOptions";

type ResumeMap = Record<string, GeneratedResume["resume"]>;
type ChecklistMap = Record<string, GeneratedResume["jd_match_checklist"]>;
type GapsMap = Record<string, string[]>;

interface CanvasProps {
  applicationId: string;
  languages: string[];
  initialDraft: ResumeMap | null;
  initialChecklist: ChecklistMap;
  initialAtsScore: number | null;
  initialGaps: GapsMap;
  initialFinalized: boolean;
  contact: ResumeContact;
  /** 求職信已經生成過：工具列的「寫求職信」直接跳過去，不再跳語言視窗。 */
  hasCoverLetter: boolean;
  /** 上次選過的求職信語言，沒有就用履歷的語言，當作語言視窗的預設勾選。 */
  initialCoverLetterLanguages: string[];
  /** 有設 FIRECRAWL_API_KEY 才能在寫求職信前先研究公司。 */
  researchAvailable: boolean;
  /** 流程步驟列，放在左欄最上面，跟 A4 同寬。 */
  stepBar: ReactNode;
}

type Resume = GeneratedResume["resume"];
type TrimPlan = { suggestions: TrimSuggestion[]; checked: boolean[] };

// 復原最多記幾步。
const UNDO_LIMIT = 30;
// 取捨建議最多請 AI 補幾輪（一輪不夠塞回一頁才會補下一輪）。
const TRIM_MAX_ROUNDS = 3;

type Busy = "generate" | "rescore" | "condition" | "save" | "finalize" | "reopen" | "trim";

const LANG_LABEL: Record<string, string> = { en: "英文", zh: "中文" };

const ATS_BANDS = [
  { min: 85, max: 100, label: "優秀", desc: "幾乎沒有明顯缺口，可以直接投遞", dot: "ats-band-excellent", text: "ats-band-excellent" },
  { min: 70, max: 84, label: "良好", desc: "已經可以投遞，缺口項目有空再補強", dot: "ats-band-good", text: "ats-band-good" },
  { min: 50, max: 69, label: "及格邊緣", desc: "有明顯缺口，建議先補強再投遞", dot: "ats-band-borderline", text: "ats-band-borderline" },
  { min: 0, max: 49, label: "落差大", desc: "跟 JD 落差明顯，建議大幅修改後再投", dot: "ats-band-weak", text: "ats-band-weak" },
] as const;

function getAtsBand(score: number) {
  return ATS_BANDS.find((b) => score >= b.min && score <= b.max) ?? ATS_BANDS[ATS_BANDS.length - 1];
}

function AtsScoreLegend({ score }: { score: number | null }) {
  return (
    <div className="ats-scale">
      {/* 色條上的 ▼ 標出這份履歷的分數落在哪一段；下面的刻度是各段的起點。 */}
      <div className="ats-scale-track" style={score !== null ? ({ "--ats-score": `${score}%` } as CSSProperties) : undefined}>
        {score !== null && (
          <span className="ats-scale-marker" aria-hidden="true">
            <span className="ats-scale-marker-value">{score}</span>
            <span className="ats-scale-marker-arrow">▼</span>
          </span>
        )}
        <div className="ats-scale-bar">
          <div className="ats-scale-bar-segment ats-scale-bar-segment--weak" />
          <div className="ats-scale-bar-segment ats-scale-bar-segment--borderline" />
          <div className="ats-scale-bar-segment ats-scale-bar-segment--good" />
          <div className="ats-scale-bar-segment ats-scale-bar-segment--excellent" />
        </div>
        <div className="ats-scale-ticks" aria-hidden="true">
          <span className="ats-scale-tick ats-scale-tick--0">0</span>
          <span className="ats-scale-tick ats-scale-tick--50">50</span>
          <span className="ats-scale-tick ats-scale-tick--70">70</span>
          <span className="ats-scale-tick ats-scale-tick--85">85</span>
          <span className="ats-scale-tick ats-scale-tick--100">100</span>
        </div>
      </div>
    </div>
  );
}

/** ATS 評分怎麼算、四段分數各代表什麼，直接顯示在分數下面；目前落在的那一段加粗、上色。 */
function AtsScoreHelp({ score }: { score: number | null }) {
  const current = score !== null ? getAtsBand(score) : null;
  return (
    <>
      分數照固定公式算：必要條件每項 2 分、加分條件每項 1 分，看履歷寫到幾項；部分符合（例如科系要求商管、你輔修商管）算一半。內容沒改，分數就不會變。
      <ul className="ats-band-list">
        {ATS_BANDS.map((b) => (
          <li key={b.label} className={b === current ? `ats-band-list-item--current ${b.text}` : undefined}>
            <span className={`ats-scale-dot ${b.dot}`} />
            {b.min}–{b.max} 分・{b.label}：{b.desc}
          </li>
        ))}
      </ul>
    </>
  );
}

export function Canvas({
  applicationId,
  languages,
  initialDraft,
  initialChecklist,
  initialAtsScore,
  initialGaps,
  initialFinalized,
  contact: initialContact,
  hasCoverLetter,
  initialCoverLetterLanguages,
  researchAvailable,
  stepBar,
}: CanvasProps) {
  const router = useRouter();
  const [draft, setDraft] = useState<ResumeMap | null>(initialDraft);
  const [checklist, setChecklist] = useState<ChecklistMap>(initialChecklist);
  const [atsScore, setAtsScore] = useState<number | null>(initialAtsScore);
  const [gaps, setGaps] = useState<GapsMap>(initialGaps);
  const [finalized, setFinalized] = useState(initialFinalized);
  const [confirmReopen, setConfirmReopen] = useState(false);
  const [activeLang, setActiveLang] = useState(languages[0]);
  const [message, setMessage] = useState<string | null>(null);
  // 記錄是哪個動作在跑，進度條的說明文字跟位置才對得上。
  const [busy, setBusy] = useState<Busy | null>(null);
  const isPending = busy !== null;
  const [gapDialogText, setGapDialogText] = useState<string | null>(null);
  const [coverLangDialog, setCoverLangDialog] = useState(false);
  const [contact, setContact] = useState<ResumeContact>(initialContact);
  // 履歷抬頭表單：generate = 第一次生成履歷前要先填；edit = 點畫布抬頭修改。
  const [contactDialog, setContactDialog] = useState<"generate" | "edit" | null>(null);
  // 一頁限制：用下載時同一套程式排 PDF 來量（measureResumesAction），不是量畫布，
  // 畫面大小、瀏覽器字型都不會影響結果。超出時可以請 AI 建議取捨，下載前也會提醒（不擋）。
  // 記下這次量的是哪一份內容，內容一變就知道結果過期了（顯示「計算中」）。
  const [fitState, setFitState] = useState<{ lang: string; resume: Resume; fit: PdfFit } | null>(null);
  const activeResume = draft?.[activeLang] ?? null;
  const fit = fitState?.lang === activeLang ? fitState.fit : null;
  const measuring = activeResume !== null && fitState?.resume !== activeResume;
  const overflowPt = fit?.overflowPt ?? 0;
  const linePt = resolveMetrics(activeLang, activeResume?.layout).line;
  const overflowLines = Math.ceil(overflowPt / linePt);
  // 使用者按掉超出一頁的警告時，記下當時超出多少；之後又變得更長才再跳出來。
  const [dismissedOverflowPt, setDismissedOverflowPt] = useState<number | null>(null);
  const showOverflowAlert = overflowPt > 0 && (dismissedOverflowPt === null || overflowPt > dismissedOverflowPt);
  const layoutSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [trimPlan, setTrimPlan] = useState<TrimPlan | null>(null);
  const [pendingDownload, setPendingDownload] = useState<string | null>(null);
  // 「回上一步」：每次內容有變動前，先把整份草稿存一份。
  const [past, setPast] = useState<ResumeMap[]>([]);
  // 畫布是直接在 DOM 上編輯的（contentEditable），整份內容被換掉（復原、套用取捨）時要重新掛載，
  // 畫面才會顯示新的內容。
  const [canvasVersion, setCanvasVersion] = useState(0);
  // 這筆已經有求職信時，按「寫求職信」先問要沿用還是依新履歷重新生成。
  const [coverChoiceDialog, setCoverChoiceDialog] = useState(false);
  // 「跟 AI 聊」面板：浮在右下角，邊聊邊看畫布。
  const [chatOpen, setChatOpen] = useState(false);
  const [coverChoice, setCoverChoice] = useState<CoverLetterChoice>(() =>
    initialChoice(initialCoverLetterLanguages.length > 0 ? initialCoverLetterLanguages : languages, researchAvailable),
  );

  // AI 動作的預估時間（毫秒），依平常實際跑的時間抓，語言版本越多越久。
  const langCount = Math.max(1, languages.length);
  // 生成會跑好幾輪（生成、補內容填滿一頁、評分），每個語言大約 3 分鐘。
  const generateProgress = useEstimatedProgress(busy === "generate", 180000 * langCount);
  const rescoreProgress = useEstimatedProgress(busy === "rescore", 20000 * langCount);
  // 補摘要（每個語言一次）＋重新評分。
  const conditionProgress = useEstimatedProgress(busy === "condition", 35000 * langCount);
  const finalizeProgress = useEstimatedProgress(busy === "finalize", 20000);
  const trimProgress = useEstimatedProgress(busy === "trim", 20000);

  async function run(kind: Busy, fn: () => Promise<void>) {
    setBusy(kind);
    try {
      await fn();
    } catch (e) {
      setMessage(`錯誤：${e instanceof Error ? e.message : "發生錯誤，請再試一次"}`);
    } finally {
      setBusy(null);
    }
  }

  // 內容、語言、抬頭一變，停 0.6 秒沒再動就重新排一次 PDF 量。
  useEffect(() => {
    if (!activeResume) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      const result = await measureResumesAction([activeResume], activeLang, contact);
      if (!cancelled && result.fits) setFitState({ lang: activeLang, resume: activeResume, fit: result.fits[0] });
    }, 600);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [activeResume, activeLang, contact]);

  /** 一次量好幾個版本的 PDF，回傳各自超出一頁多少 pt。 */
  const measureMany = useCallback(
    async (resumes: Resume[]) => {
      const result = await measureResumesAction(resumes, activeLang, contact);
      if (result.error || !result.fits) throw new Error(result.error ?? "量 PDF 版面失敗");
      return result.fits.map((f) => f.overflowPt);
    },
    [activeLang, contact],
  );
  const measureTrim = useCallback(
    async (picked: TrimSuggestion[]) =>
      activeResume ? (await measureMany([applyTrimSuggestions(activeResume, picked)]))[0] : 0,
    [activeResume, measureMany],
  );

  // 一次到位的取捨：AI 依優先順序給建議，這裡把「套前 1 條、前 2 條…」各排一次 PDF 量，
  // 找出剛好塞回一頁的最少組合；全部套上還不夠，就自動請 AI 再補一輪，使用者只會看到一次視窗。
  function handleSuggestTrim() {
    if (!draft) return;
    const base = draft[activeLang];
    setMessage(null);
    void run("trim", async () => {
      let all: TrimSuggestion[] = [];
      let current = base;
      for (let round = 0; round < TRIM_MAX_ROUNDS; round++) {
        const [over] = await measureMany([current]);
        if (over <= 0) break;
        const result = await suggestTrimAction(applicationId, activeLang, current, Math.ceil(over / linePt));
        if (result.error) {
          setMessage(`錯誤：${result.error}`);
          return;
        }
        const fresh = result.suggestions ?? [];
        if (fresh.length === 0) break;
        all = [...all, ...fresh];
        const k = await findMinimalTrim(base, all, measureMany);
        if (k !== null) {
          setTrimPlan({ suggestions: all, checked: all.map((_, i) => i < k) });
          return;
        }
        current = applyTrimSuggestions(base, all);
      }
      setTrimPlan({ suggestions: all, checked: all.map(() => true) });
    });
  }

  function handleApplyTrim(picked: TrimSuggestion[]) {
    updateResume(activeLang, (r) => applyTrimSuggestions(r, picked));
    setCanvasVersion((v) => v + 1);
    setTrimPlan(null);
    setMessage(`已套用 ${picked.length} 項取捨，可按復原退回，記得儲存`);
  }

  /** 調字級／間距：畫布馬上套用，停 0.5 秒後存檔（定案後也能調，下載的檔案會跟著變）。 */
  function changeLayout(next: ResumeLayoutSettings) {
    const lang = activeLang;
    setDraft((d) => (d?.[lang] ? { ...d, [lang]: { ...d[lang], layout: next } } : d));
    if (layoutSaveTimer.current) clearTimeout(layoutSaveTimer.current);
    layoutSaveTimer.current = setTimeout(async () => {
      const result = await saveLayoutAction(applicationId, lang, next);
      if (result.error) setMessage(`錯誤：字級／間距沒有存到（${result.error}）`);
    }, 500);
  }

  function handleUndo() {
    const previous = past[past.length - 1];
    if (!previous || !draft) return;
    setPast(past.slice(0, -1));
    // 復原只退內容，字級跟間距維持現在的設定（排版設定是另外存的，不算一步）。
    setDraft(
      Object.fromEntries(
        Object.entries(previous).map(([lang, r]) => [lang, { ...r, layout: draft[lang]?.layout ?? r.layout }]),
      ),
    );
    setCanvasVersion((v) => v + 1);
    setMessage("已復原上一步");
  }

  /** 超出一頁時先提醒再下載；沒超出就照一般連結直接下載。 */
  function guardDownload(e: React.MouseEvent<HTMLAnchorElement>) {
    // 使用者已經按掉警告（決定保留兩頁）就不再擋。
    if (!showOverflowAlert) return;
    e.preventDefault();
    setPendingDownload(e.currentTarget.href);
  }

  // 第一次生成履歷前，沒有姓名跟 Email 就先跳視窗請使用者填，填完才開始生成。
  function requestGenerate() {
    if (!hasRequiredContact(contact)) {
      setContactDialog("generate");
      return;
    }
    handleGenerate();
  }

  function handleGenerate() {
    setMessage(null);
    void run("generate", async () => {
      const result = await generateAction(applicationId);
      if (result.error || !result.data) {
        setMessage(`錯誤：${result.error}`);
        return;
      }
      setDraft(result.data.resume_draft);
      setChecklist(result.data.jd_match_checklist);
      setAtsScore(result.data.ats_score);
      setGaps(result.data.ats_gaps);
      setMessage("生成完成");
    });
  }

  function updateResume(lang: string, updater: (r: Resume) => Resume) {
    if (!draft) return;
    const next = { ...draft, [lang]: updater(draft[lang]) };
    // 失焦也會觸發一次提交，內容沒變就不記進復原紀錄。
    if (JSON.stringify(next[lang]) === JSON.stringify(draft[lang])) return;
    setPast((p) => [...p.slice(-(UNDO_LIMIT - 1)), draft]);
    setDraft(next);
  }

  // 「跟 AI 聊」改好的整份履歷換進草稿：記進復原紀錄、畫布重新掛載才看得到新內容。字級間距維持現在的設定。
  function applyChatRevision(lang: string, next: Resume) {
    if (!draft) return;
    setPast((p) => [...p.slice(-(UNDO_LIMIT - 1)), draft]);
    setDraft({ ...draft, [lang]: { ...next, layout: draft[lang]?.layout ?? next.layout } });
    setCanvasVersion((v) => v + 1);
    setMessage("AI 改好了，記得按「儲存」；不滿意可以按「復原」");
  }

  function handleRescore() {
    if (!draft) return;
    setMessage(null);
    void run("rescore", async () => {
      const result = await rescoreAction(applicationId, draft);
      if (result.error || !result.data) {
        setMessage(`錯誤：${result.error}`);
        return;
      }
      setChecklist(result.data.jd_match_checklist);
      setAtsScore(result.data.ats_score);
      setGaps(result.data.ats_gaps);
      setMessage("已重新評分");
    });
  }

  // JD 條件清單裡的工作條件（出差這類）：可以配合 → 摘要補一句、重新評分；無法配合 → 只記下來。
  function handleAnswerCondition(item: string, willing: boolean) {
    if (!draft) return;
    setMessage(null);
    void run("condition", async () => {
      const result = await answerWorkConditionAction(applicationId, item, willing, draft);
      if (result.error || !result.data) {
        setMessage(`錯誤：${result.error}`);
        return;
      }
      setChecklist(result.data.jd_match_checklist);
      setAtsScore(result.data.ats_score);
      setGaps(result.data.ats_gaps);
      if (willing) {
        setDraft(result.data.resume_draft);
        setCanvasVersion((v) => v + 1);
        setMessage("摘要補上了這個條件，也重新評分了");
      } else {
        setMessage("記下來了，之後的職缺遇到同樣的條件不會再問");
      }
    });
  }

  function handleSave() {
    if (!draft) return;
    setMessage(null);
    void run("save", async () => {
      const result = await saveDraftAction(applicationId, draft);
      setMessage(result.error ? `錯誤：${result.error}` : "已儲存");
    });
  }

  function handleReopen() {
    setMessage(null);
    void run("reopen", async () => {
      const result = await reopenResumeAction(applicationId);
      if (result.error) {
        setMessage(`錯誤：${result.error}`);
      } else {
        setFinalized(false);
        router.refresh();
      }
      setConfirmReopen(false);
    });
  }

  function handleFinalize() {
    setMessage(null);
    void run("finalize", async () => {
      const result = await finalizeResumeAction(applicationId);
      if (result.error) {
        setMessage(`錯誤：${result.error}`);
        return;
      }
      setFinalized(true);
      setPast([]);
      setMessage("已定案，可以進到求職信步驟了");
      // 讓步驟列更新到「寫求職信」。
      router.refresh();
    });
  }

  if (!draft) {
    return (
      <div className="canvas-main">
        {stepBar}
        <div className="card canvas-empty-card">
          <p className="text-body">
            還沒有生成過履歷
            <InfoTip label="生成履歷的說明">
              按下面的按鈕，AI 會依 JD 從經歷資料庫挑選內容、寫成履歷並評分。每個語言版本大約 3–5 分鐘（會一直補內容到剛好一頁）。
            </InfoTip>
          </p>
          {generateProgress !== null ? (
            <div className="mt-4">
              <ProgressBar value={generateProgress} label="AI 正在依 JD 挑選經歷、生成履歷…" />
            </div>
          ) : (
            <div className="canvas-empty-actions">
              <button onClick={requestGenerate} disabled={isPending} className="btn btn-primary">
                生成履歷
              </button>
            </div>
          )}
          {message && <p className="text-error mt-3">{message}</p>}
          {contactDialog && (
            <ContactDialog
              initial={contact}
              submitLabel="儲存並生成履歷"
              onSaved={(c) => {
                setContact(c);
                setContactDialog(null);
                handleGenerate();
              }}
              onCancel={() => setContactDialog(null)}
            />
          )}
        </div>
      </div>
    );
  }

  const resume = draft[activeLang];
  if (!resume) return null;
  // 分數直接從這個語言的 JD 條件清單算（公式見 atsScore.ts），清單跟分數永遠對得上；
  // 還沒有清單的舊資料才用資料庫存的分數。
  const langScore = computeAtsScore(checklist[activeLang] ?? []) ?? atsScore;
  const layout = readLayoutSettings(resume.layout, activeLang);

  return (
    <div className="canvas-layout">
      {/* 左欄：A4 上方工具列（左邊語言切換，右邊動作按鈕）+ A4 + 備註。 */}
      <div className="canvas-main">
        {stepBar}
        <div className="canvas-bar">
          <div className="canvas-bar-start">
            <LangSwitch
              options={languages.map((lang) => ({ value: lang, label: LANG_LABEL[lang] ?? lang }))}
              value={activeLang}
              onChange={setActiveLang}
            />
            <LayoutMenu language={activeLang} layout={layout} onChange={changeLayout} fit={fit} measuring={measuring} />
          </div>
          {/* 提示訊息用小字塞在按鈕左邊的剩餘空間，最多兩行，不把按鈕擠到下一行。 */}
          {message && (
            <span className="canvas-bar-message" title={message}>
              {message}
            </span>
          )}
          <div className="canvas-bar-actions">
            {finalized ? (
              <>
                <button
                  type="button"
                  onClick={() => setConfirmReopen(true)}
                  disabled={isPending}
                  className="btn btn-secondary"
                >
                  回到編輯
                </button>
                <a
                  href={`/applications/${applicationId}/resume-download?lang=${activeLang}&format=docx`}
                  onClick={guardDownload}
                  className="btn btn-secondary"
                >
                  下載 Word
                </a>
                <a
                  href={`/applications/${applicationId}/resume-download?lang=${activeLang}&format=pdf`}
                  onClick={guardDownload}
                  className="btn btn-secondary"
                >
                  下載 PDF
                </a>
                <button
                  type="button"
                  onClick={() => (hasCoverLetter ? setCoverChoiceDialog(true) : setCoverLangDialog(true))}
                  className="btn btn-primary"
                >
                  寫求職信
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => setChatOpen((v) => !v)}
                  disabled={isPending && !chatOpen}
                  className="btn btn-secondary"
                >
                  跟 AI 聊
                </button>
                {past.length > 0 && (
                  <button type="button" onClick={handleUndo} disabled={isPending} className="btn btn-secondary" title="回到上一步的內容">
                    <UndoIcon />
                    復原
                  </button>
                )}
                <button onClick={handleSave} disabled={isPending} className="btn btn-secondary">
                  {busy === "save" && <Spinner />}
                  儲存
                </button>
                <button onClick={handleRescore} disabled={isPending} className="btn btn-secondary">
                  重新檢查評分
                </button>
                <button onClick={handleFinalize} disabled={isPending} className="btn btn-primary">
                  定案
                </button>
              </>
            )}
          </div>
        </div>

        {rescoreProgress !== null && (
          <ProgressBar value={rescoreProgress} label="重新比對 JD、計算 ATS 分數…" />
        )}
        {conditionProgress !== null && (
          <ProgressBar value={conditionProgress} label="把這個條件寫進摘要、重新計算 ATS 分數…" />
        )}
        {finalizeProgress !== null && (
          <ProgressBar value={finalizeProgress} label="定案中，把這次用到的內容寫回經歷資料庫…" />
        )}
        {trimProgress !== null && <ProgressBar value={trimProgress} label="AI 正在依 JD 判斷哪些內容可以精簡或刪掉…" />}
        {showOverflowAlert && trimProgress === null && (
          <div className="overflow-alert" role="status">
            <span
              className="overflow-alert-text"
              title="下載的 PDF 會超出一頁，紅色虛線以下是第二頁。可以請 AI 建議取捨，或用「排版」調小字級、上下間距。"
            >
              ⚠ PDF 超出一頁約 {overflowLines} 行（紅線以下），可請 AI 取捨或調小排版
            </span>
            <div className="overflow-alert-actions">
              {finalized ? (
                <span>回到編輯後可以請 AI 建議取捨</span>
              ) : (
                <button type="button" className="btn btn-secondary" onClick={handleSuggestTrim} disabled={isPending}>
                  請 AI 建議取捨
                </button>
              )}
              <button
                type="button"
                className="icon-btn"
                aria-label="關掉這個提醒"
                title="關掉這個提醒（決定保留超過一頁）"
                onClick={() => setDismissedOverflowPt(overflowPt)}
              >
                <CloseIcon />
              </button>
            </div>
          </div>
        )}

        <ResumePageCanvas
          key={`${activeLang}-${canvasVersion}`}
          resume={resume}
          language={activeLang}
          contact={contact}
          editable={!finalized}
          pageBreak={overflowPt > 0 ? (fit?.breakAt ?? null) : null}
          onEditContact={() => setContactDialog("edit")}
          onChangeSummary={(text) => updateResume(activeLang, (r) => ({ ...r, summary: text }))}
          onChangeSkills={(text) =>
            updateResume(activeLang, (r) => ({
              ...r,
              skills: splitList(text),
            }))
          }
          onChangeLanguages={(text) => updateResume(activeLang, (r) => ({ ...r, languages: splitList(text) }))}
          onChangeEntryField={(section, index, field, value) =>
            updateResume(activeLang, (r) => {
              const items = [...r[section]];
              const text = value.trim();
              items[index] = { ...items[index], [field]: field === "location" ? text || null : text };
              return { ...r, [section]: items };
            })
          }
          onChangeBullets={(section, index, bullets) =>
            updateResume(activeLang, (r) => {
              const items = [...r[section]];
              items[index] = { ...items[index], bullets };
              return { ...r, [section]: items };
            })
          }
        />

        {finalized && (
          <p className="text-muted-xs">
            已經幫你把這次用到的經歷記錄回
            <Link href="/experience" className="link">
              經歷資料庫
            </Link>
            了。
          </p>
        )}
      </div>

      <div className="canvas-sidebar canvas-sidebar--match">
        <div className="card card--sm">
          <h2 className="heading-card">
            ATS 評分（{LANG_LABEL[activeLang]}）
          </h2>
          <p className="ats-score-value">
            {langScore ?? "—"}
            <span className="ats-score-max"> / 100</span>
            {langScore !== null && (
              <span className={`ats-band-tag ${getAtsBand(langScore).text}`}>
                {getAtsBand(langScore).label}
              </span>
            )}
          </p>
          <AtsScoreLegend score={langScore} />
          {/* 分數怎麼算直接攤開（使用者要求不要藏在 ⓘ 裡）。 */}
          <div className="ats-score-help">
            <AtsScoreHelp score={langScore} />
          </div>
          <JdChecklist
            items={checklist[activeLang] ?? []}
            isCovered={coveredByResume}
            language={activeLang}
            legacyGaps={gaps[activeLang] ?? []}
            onDig={finalized ? undefined : setGapDialogText}
            onAnswerCondition={finalized || isPending ? undefined : handleAnswerCondition}
          />
        </div>
      </div>

      {chatOpen && !finalized && activeResume && (
        <ResumeChatPanel
          key={activeLang}
          applicationId={applicationId}
          language={activeLang}
          resume={activeResume}
          onApply={(next) => applyChatRevision(activeLang, next)}
          onClose={() => setChatOpen(false)}
        />
      )}

      {confirmReopen && (
        <ConfirmDialog
          title="回到編輯狀態？"
          message="履歷會回到可以編輯的草稿狀態，改完需要重新定案。重新定案時會跟這次的版本比對，只把改過的內容更新回經歷資料庫，改掉的舊寫法會移除，不會多出重複的條目。"
          confirmLabel="回到編輯"
          tone="primary"
          pending={busy === "reopen"}
          onConfirm={handleReopen}
          onCancel={() => setConfirmReopen(false)}
        />
      )}

      {trimPlan && (
        <TrimDialog
          suggestions={trimPlan.suggestions}
          initialChecked={trimPlan.checked}
          measure={measureTrim}
          linePt={linePt}
          onApply={handleApplyTrim}
          onCancel={() => setTrimPlan(null)}
        />
      )}

      {pendingDownload && (
        <ConfirmDialog
          title="履歷超出一頁"
          message={`下載的 PDF 會超出一頁約 ${overflowLines} 行，多數招募者只看一頁。建議調小字級、間距，或回到編輯請 AI 建議取捨。還是要直接下載嗎？`}
          confirmLabel="仍要下載"
          tone="primary"
          onConfirm={() => {
            window.location.href = pendingDownload;
            setPendingDownload(null);
          }}
          onCancel={() => setPendingDownload(null)}
        />
      )}

      {contactDialog && (
        <ContactDialog
          initial={contact}
          title="修改履歷抬頭"
          submitLabel="儲存"
          onSaved={(c) => {
            setContact(c);
            setContactDialog(null);
            setMessage("已更新履歷抬頭");
          }}
          onCancel={() => setContactDialog(null)}
        />
      )}

      {coverChoiceDialog && (
        <ConfirmDialog
          title="這筆已經有求職信了"
          message="履歷如果改過，建議依新的履歷重新生成；只是想回去看或修改，就沿用現在的求職信。"
          confirmLabel="依新履歷重新生成"
          tone="primary"
          onConfirm={() => {
            setCoverChoiceDialog(false);
            setCoverLangDialog(true);
          }}
          secondaryAction={{
            label: "沿用現在的求職信",
            onClick: () => router.push(`/applications/${applicationId}/cover-letter`),
          }}
          onCancel={() => setCoverChoiceDialog(false)}
        />
      )}

      {coverLangDialog && (
        <ConfirmDialog
          title="生成求職信"
          message="選擇語言（可複選），需要的話設定字數上限。按「開始生成」後會跳到求職信頁。"
          confirmLabel="開始生成"
          tone="primary"
          confirmDisabled={choiceInvalid(coverChoice)}
          onConfirm={() => router.push(`/applications/${applicationId}/cover-letter?${choiceToQuery(coverChoice)}`)}
          onCancel={() => setCoverLangDialog(false)}
        >
          <CoverLetterOptionsFields value={coverChoice} onChange={setCoverChoice} researchAvailable={researchAvailable} />
        </ConfirmDialog>
      )}

      {gapDialogText && (
        <JdGapDialog
          gapText={gapDialogText}
          language={activeLang}
          sections={[
            ...resume.work_experience.map((e, i) => ({
              section: "work_experience" as const,
              index: i,
              org: e.org,
              role: e.role,
            })),
            ...resume.leadership.map((e, i) => ({
              section: "leadership" as const,
              index: i,
              org: e.org,
              role: e.role,
            })),
          ]}
          onClose={() => setGapDialogText(null)}
          onCommitBullet={(section, index, bulletText) => {
            updateResume(activeLang, (r) => {
              const items = [...r[section]];
              items[index] = { ...items[index], bullets: [...items[index].bullets, bulletText] };
              return { ...r, [section]: items };
            });
            setCanvasVersion((v) => v + 1);
          }}
        />
      )}
    </div>
  );
}
