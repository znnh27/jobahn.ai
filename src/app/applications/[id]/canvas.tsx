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
  suggestKeywordRewordingAction,
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
import { CheckIcon, CloseIcon, RedoIcon, UndoIcon } from "@/app/icons";
import { useFlash } from "@/app/useFlash";
import { useUndoShortcuts } from "@/app/useUndoShortcuts";
import { SectionLabelsProvider } from "@/app/SectionLabels";
import type { CustomSectionLabels } from "@/lib/resumes/sectionLabels";
import { computeAtsScore, coveredByResume } from "@/lib/resumes/atsScore";
import { JdChecklist } from "./JdChecklist";
import { StatusMessage } from "@/app/StatusMessage";
import { matchKeywords } from "@/lib/resumes/keywordMatch";
import type { RewordEdit } from "@/lib/resumes/rewordKeywords";
import { inlineDiff } from "@/lib/text/inlineDiff";
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
  /** 使用者改過的區塊標題（全帳號共用）。 */
  initialSectionLabels: Record<"zh" | "en", CustomSectionLabels>;
  /** JD 關鍵字（關鍵字命中用）；舊的應徵還沒挑過是 null，重新評分時會補挑。 */
  initialKeywords: string[] | null;
  /** JD 是中文還是英文：關鍵字只比對同語言的履歷版本。 */
  jdLanguage: "zh" | "en";
}

type Resume = GeneratedResume["resume"];
type TrimPlan = { suggestions: TrimSuggestion[]; checked: boolean[] };

// 上一步／下一步最多記幾步。
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

/** 四段分數各代表什麼，直接顯示在分數下面；目前落在的那一段加粗、上色。分數怎麼算放在標題旁的 ⓘ。 */
/** 「換成 JD 用字」的修改在履歷的哪裡：摘要、某段經歷的第幾條、技能。 */
function rewordWhere(edit: RewordEdit, resume: Resume | null): string {
  const loc = edit.location;
  if (loc.section === "summary") return "專業摘要";
  if (loc.section === "skills") return "技能（加上這一項）";
  const org = resume?.[loc.section]?.[loc.entry]?.org ?? "";
  return `${org} 第 ${loc.bullet + 1} 條`;
}

function AtsScoreHelp({ score }: { score: number | null }) {
  const current = score !== null ? getAtsBand(score) : null;
  return (
    <>
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
  initialSectionLabels,
  initialKeywords,
  jdLanguage,
}: CanvasProps) {
  const router = useRouter();
  const [draft, setDraft] = useState<ResumeMap | null>(initialDraft);
  const [checklist, setChecklist] = useState<ChecklistMap>(initialChecklist);
  const [atsScore, setAtsScore] = useState<number | null>(initialAtsScore);
  const [gaps, setGaps] = useState<GapsMap>(initialGaps);
  const [keywords, setKeywords] = useState<string[] | null>(initialKeywords);
  const [finalized, setFinalized] = useState(initialFinalized);
  const [confirmReopen, setConfirmReopen] = useState(false);
  const [activeLang, setActiveLang] = useState(languages[0]);
  const [message, setMessage] = useState<string | null>(null);
  // 儲存、重新檢查評分這種簡短確認不進訊息列，按鈕本身變「✓ 已儲存」2 秒（見 useFlash）。
  const { flashed, flash } = useFlash();
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
  // 關鍵字命中：在瀏覽器裡用程式比對，畫布上改一個字就會更新。
  // 關鍵字只比對跟 JD 同語言的版本（英文 JD 的字本來就不會出現在中文履歷裡）。
  const keywordMatch =
    keywords?.length && activeResume && activeLang === jdLanguage ? matchKeywords(keywords, activeResume) : null;
  const jdLangLabel = LANG_LABEL[jdLanguage] ?? jdLanguage;
  const keywordNote =
    activeLang !== jdLanguage
      ? languages.includes(jdLanguage)
        ? `JD 是${jdLangLabel}，切到${jdLangLabel}版履歷看關鍵字`
        : `JD 是${jdLangLabel}，這份沒有${jdLangLabel}版履歷，關鍵字沒辦法逐字比對`
      : !keywords?.length
        ? "按「重新檢查評分」後會列出 JD 關鍵字"
        : null;
  // 「換成 JD 用字」：AI 找出有事實的那一句、只改用字，前後對照給使用者勾選，套用才換進畫布（可以按上一步退回）。
  const [reword, setReword] = useState<{
    keywords: string[];
    loading: boolean;
    error: string | null;
    edits: RewordEdit[];
    picked: boolean[];
    notFound: { keyword: string; reason: string }[];
  } | null>(null);
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
  // 「上一步」：每次內容有變動前，先把整份草稿存一份；「下一步」：按了上一步之後可以再走回來，
  // 內容又有新的變動就清掉。
  const [past, setPast] = useState<ResumeMap[]>([]);
  const [future, setFuture] = useState<ResumeMap[]>([]);
  // 畫布是直接在 DOM 上編輯的（contentEditable），整份內容被換掉（上一步、套用取捨）時要重新掛載，
  // 畫面才會顯示新的內容。
  const [canvasVersion, setCanvasVersion] = useState(0);
  // 這筆已經有求職信時，按「寫求職信」先問要沿用還是依新履歷重新生成。
  const [coverChoiceDialog, setCoverChoiceDialog] = useState(false);
  // 「跟 AI 聊」面板：浮在右下角，邊聊邊看畫布。
  const [chatOpen, setChatOpen] = useState(false);
  // 「重新產生履歷」會蓋掉畫布上的內容（含手動改的），先確認。
  const [confirmRegenerate, setConfirmRegenerate] = useState(false);
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

  // 區塊標題改了就加一，讓上面的量版面重跑一次。
  const [labelsVersion, setLabelsVersion] = useState(0);

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
    // 標題改了也要重量：標題變長可能換行，多出一行。
  }, [activeResume, activeLang, contact, labelsVersion]);

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
    setMessage(`已套用 ${picked.length} 項取捨，可按「上一步」退回，記得儲存`);
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

  /** 內容要變動前呼叫：現在這份記進上一步，下一步的紀錄作廢。 */
  function remember(snapshot: ResumeMap) {
    setPast((p) => [...p.slice(-(UNDO_LIMIT - 1)), snapshot]);
    setFuture([]);
  }

  // 跟 AI 聊改完、上一步／下一步之後自動存檔（2026-10-27 Z 要求：AI 改完沒存，離開就不見；上一步也要存，
  // 重新整理才不會又跑回 AI 改的版本）。在背景存、不鎖按鈕；一個接一個存，連按上一步時最後存的一定是畫面上這一版。
  const saveQueue = useRef<Promise<void>>(Promise.resolve());
  function autoSave(next: ResumeMap) {
    saveQueue.current = saveQueue.current.then(async () => {
      const result = await saveDraftAction(applicationId, next);
      if (result.error) setMessage(`錯誤：自動儲存失敗（${result.error}），請按「儲存」`);
    });
  }

  /** 換成上一步／下一步的內容：只換內容，字級跟間距維持現在的設定（排版設定是另外存的，不算一步）。 */
  function restore(target: ResumeMap) {
    if (!draft) return;
    const next = Object.fromEntries(
      Object.entries(target).map(([lang, r]) => [lang, { ...r, layout: draft[lang]?.layout ?? r.layout }]),
    );
    setDraft(next);
    setCanvasVersion((v) => v + 1);
    autoSave(next);
  }

  function handleUndo() {
    const previous = past[past.length - 1];
    if (!previous || !draft) return;
    setPast(past.slice(0, -1));
    setFuture((f) => [...f, draft]);
    // 畫面上的內容換回去就是回饋，不另外顯示訊息（自動儲存失敗才會出現錯誤訊息）。
    restore(previous);
  }

  function handleRedo() {
    const next = future[future.length - 1];
    if (!next || !draft) return;
    setFuture(future.slice(0, -1));
    setPast((p) => [...p.slice(-(UNDO_LIMIT - 1)), draft]);
    restore(next);
  }

  // Cmd/Ctrl + Z 上一步、Shift + Cmd/Ctrl + Z 下一步（正在某一格打字時先退打的字）。
  useUndoShortcuts({ undo: handleUndo, redo: handleRedo, enabled: !finalized && !isPending });

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
    // 重新產生時，舊的那份記進上一步，不滿意可以按「上一步」退回去。
    const previous = draft;
    void run("generate", async () => {
      const result = await generateAction(applicationId);
      if (result.error || !result.data) {
        setMessage(`錯誤：${result.error}`);
        return;
      }
      if (previous) remember(previous);
      setDraft(result.data.resume_draft);
      setChecklist(result.data.jd_match_checklist);
      setAtsScore(result.data.ats_score);
      setGaps(result.data.ats_gaps);
      setKeywords(result.data.jd_keywords);
      setCanvasVersion((v) => v + 1);
      setMessage(previous ? "已重新產生；想回到上一版可以按「上一步」再按「儲存」" : "生成完成");
    });
  }

  function updateResume(lang: string, updater: (r: Resume) => Resume) {
    if (!draft) return;
    const next = { ...draft, [lang]: updater(draft[lang]) };
    // 失焦也會觸發一次提交，內容沒變就不記進上一步。
    if (JSON.stringify(next[lang]) === JSON.stringify(draft[lang])) return;
    remember(draft);
    setDraft(next);
  }

  async function handleReword(words: string[], item: string | null) {
    if (!activeResume) return;
    setReword({ keywords: words, loading: true, error: null, edits: [], picked: [], notFound: [] });
    // 已經用到的關鍵字一起傳過去：改用字時不能把它們改掉。
    const result = await suggestKeywordRewordingAction(
      applicationId,
      activeLang,
      activeResume,
      words,
      item,
      keywordMatch?.matched ?? [],
    );
    setReword({
      keywords: words,
      loading: false,
      error: result.error ?? null,
      edits: result.edits ?? [],
      picked: (result.edits ?? []).map(() => true),
      notFound: result.notFound ?? [],
    });
  }

  function applyReword() {
    if (!reword) return;
    const chosen = reword.edits.filter((_, i) => reword.picked[i]);
    updateResume(activeLang, (r) => {
      const next: Resume = JSON.parse(JSON.stringify(r));
      for (const e of chosen) {
        const loc = e.location;
        if (loc.section === "summary") next.summary = e.after;
        else if (loc.section === "skills") {
          if (!next.skills.some((s) => s.toLowerCase() === e.after.toLowerCase())) next.skills = [...next.skills, e.after];
        } else {
          const bullets = next[loc.section][loc.entry]?.bullets;
          if (bullets && bullets[loc.bullet] === e.before) bullets[loc.bullet] = e.after;
        }
      }
      return next;
    });
    setCanvasVersion((v) => v + 1);
    setReword(null);
    setMessage("換好了，記得按「儲存」；不滿意可以按「上一步」");
  }

  // 「跟 AI 聊」改好的整份履歷換進草稿並自動存檔：記進上一步、畫布重新掛載才看得到新內容。字級間距維持現在的設定。
  function applyChatRevision(lang: string, next: Resume) {
    if (!draft) return;
    const nextDraft = { ...draft, [lang]: { ...next, layout: draft[lang]?.layout ?? next.layout } };
    remember(draft);
    setDraft(nextDraft);
    setCanvasVersion((v) => v + 1);
    autoSave(nextDraft);
    setMessage("AI 改好了，已自動儲存；不滿意可以按「上一步」");
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
      setKeywords(result.data.jd_keywords);
      flash("rescore");
    });
  }

  // JD 條件清單裡的工作條件（出差這類）：可以配合 → 摘要補一句、重新評分；無法配合 → 只記下來。
  function handleAnswerCondition(item: string, willing: boolean) {
    if (!draft) return;
    setMessage(null);
    const previous = draft;
    void run("condition", async () => {
      const result = await answerWorkConditionAction(applicationId, item, willing, draft);
      if (result.error || !result.data) {
        setMessage(`錯誤：${result.error}`);
        return;
      }
      setChecklist(result.data.jd_match_checklist);
      setAtsScore(result.data.ats_score);
      setGaps(result.data.ats_gaps);
      setKeywords(result.data.jd_keywords);
      if (willing) {
        remember(previous);
        setDraft(result.data.resume_draft);
        setCanvasVersion((v) => v + 1);
        setMessage("摘要補上了這個條件，也重新評分了；不滿意可以按「上一步」");
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
      if (result.error) setMessage(`錯誤：${result.error}`);
      else flash("save");
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
      setFuture([]);
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
              <ul>
                <li>AI 會依 JD 從經歷資料庫挑選內容、寫成履歷並評分</li>
                <li>每個語言版本大約 3–5 分鐘</li>
                <li>會一直補內容，直到剛好一頁</li>
              </ul>
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
    <SectionLabelsProvider initial={initialSectionLabels} onChange={() => setLabelsVersion((v) => v + 1)}>
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
            {/* 上一步／下一步：跟「Aa」一樣是灰色純圖示，沒有紀錄時變淡、不能按。定案後不能編輯，就不顯示。 */}
            {!finalized && (
              <div className="canvas-history">
                <button
                  type="button"
                  className="icon-btn canvas-history-btn"
                  onClick={handleUndo}
                  disabled={isPending || past.length === 0}
                  title="上一步（⌘Z／Ctrl+Z）"
                  aria-label="上一步"
                >
                  <UndoIcon />
                </button>
                <button
                  type="button"
                  className="icon-btn canvas-history-btn"
                  onClick={handleRedo}
                  disabled={isPending || future.length === 0}
                  title="下一步（⇧⌘Z／Shift+Ctrl+Z）"
                  aria-label="下一步"
                >
                  <RedoIcon />
                </button>
              </div>
            )}
          </div>
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
                {/* 儲存固定在最左邊、重新產生跟重新檢查評分排在一起、主要按鈕「定案」在最右邊（2026-10-25 Z 要求，跟求職信頁一樣）。 */}
                <button onClick={handleSave} disabled={isPending} className="btn btn-secondary">
                  {busy === "save" && <Spinner />}
                  {flashed === "save" ? (
                    <>
                      <CheckIcon /> 已儲存
                    </>
                  ) : (
                    "儲存"
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => setChatOpen((v) => !v)}
                  disabled={isPending && !chatOpen}
                  className="btn btn-secondary"
                >
                  跟 AI 聊
                </button>
                <button type="button" onClick={() => setConfirmRegenerate(true)} disabled={isPending} className="btn btn-secondary">
                  重新產生履歷
                </button>
                <button onClick={handleRescore} disabled={isPending} className="btn btn-secondary">
                  {flashed === "rescore" ? (
                    <>
                      <CheckIcon /> 已重新評分
                    </>
                  ) : (
                    "重新檢查評分"
                  )}
                </button>
                <button onClick={handleFinalize} disabled={isPending} className="btn btn-primary">
                  定案
                </button>
              </>
            )}
          </div>
        </div>
        <StatusMessage message={message} onClose={() => setMessage(null)} />

        {generateProgress !== null && (
          <ProgressBar value={generateProgress} label="AI 正在依 JD 重新挑選經歷、產生履歷…" />
        )}
        {rescoreProgress !== null && (
          <ProgressBar value={rescoreProgress} label="重新比對 JD、計算符合度…" />
        )}
        {conditionProgress !== null && (
          <ProgressBar value={conditionProgress} label="把這個條件寫進摘要、重新計算符合度…" />
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
          onChangeEducationField={(index, field, value) =>
            updateResume(activeLang, (r) => {
              const items = [...r.education];
              const text = value.trim();
              // 地點、科系那一行可以清空（PDF 就不印）；學校、期間維持字串。
              items[index] = { ...items[index], [field]: field === "location" || field === "detail" ? text || null : text };
              return { ...r, education: items };
            })
          }
          onRemoveEntry={(section, index) => {
            const org = resume[section][index]?.org ?? "";
            updateResume(activeLang, (r) => ({ ...r, [section]: r[section].filter((_, j) => j !== index) }));
            // 畫布是 contentEditable、用位置當 key，刪掉中間一段要重新掛載，後面幾段才不會顯示錯位的內容。
            setCanvasVersion((v) => v + 1);
            setMessage(`已從這份履歷刪除「${org}」，經歷資料庫不受影響；可以按「上一步」退回`);
          }}
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
            JD 符合度（{LANG_LABEL[activeLang]}）
            <InfoTip label="JD 符合度怎麼算">
              <ul>
                <li>逐條比對 JD 條件，不是雇主 ATS 系統的分數</li>
                <li>必要條件每項 2 分，加分條件每項 1 分</li>
                <li>部分符合算一半</li>
                <li>履歷內容沒改，分數就不變</li>
              </ul>
            </InfoTip>
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
          {/* 四段分數的說明直接攤開；公式收在標題旁的 ⓘ（2026-10-23 使用者要求縮起來）。 */}
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
            keywords={keywordMatch}
            keywordNote={keywordNote}
            onReword={finalized || isPending ? undefined : handleReword}
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

      {confirmRegenerate && (
        <ConfirmDialog
          title="重新產生履歷？"
          message={`AI 會依 JD 跟經歷資料庫從頭寫一份新的${languages.length > 1 ? `（${languages.map((l) => LANG_LABEL[l] ?? l).join("、")}都會重寫）` : ""}，畫面上現在的內容會被換掉，包括你手動改過的地方。產生完不滿意，可以按「上一步」回到現在這一版。每個語言版本大約 3–5 分鐘。`}
          confirmLabel="重新產生"
          tone="primary"
          onConfirm={() => {
            setConfirmRegenerate(false);
            handleGenerate();
          }}
          onCancel={() => setConfirmRegenerate(false)}
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

      {reword && (
        <ConfirmDialog
          title="換成 JD 用字"
          wide
          message={
            reword.loading
              ? `正在履歷裡找跟「${reword.keywords.join("、")}」講同一件事的句子…`
              : reword.edits.length > 0
                ? "只改用字、不改事實。勾選要套用的修改："
                : "履歷裡找不到講同一件事的句子，不建議硬補。真的有相關經驗的話，可以讓 AI 幫你挖掘這段經驗。"
          }
          confirmLabel={reword.edits.length > 0 ? "套用" : "知道了"}
          tone="primary"
          pending={reword.loading}
          error={reword.error}
          confirmDisabled={reword.edits.length > 0 && !reword.picked.some(Boolean)}
          onConfirm={reword.edits.length > 0 ? applyReword : () => setReword(null)}
          onCancel={() => setReword(null)}
        >
          {reword.edits.length > 0 && (
            <ul className="trim-list">
              {reword.edits.map((e, i) => (
                <li key={i}>
                  <label className="trim-item">
                    <input
                      type="checkbox"
                      checked={reword.picked[i]}
                      onChange={(ev) =>
                        setReword((prev) =>
                          prev ? { ...prev, picked: prev.picked.map((p, j) => (j === i ? ev.target.checked : p)) } : prev,
                        )
                      }
                    />
                    <span className="trim-item-body">
                      <span className="reword-meta">
                        <span className="trim-item-tag">{e.keyword}</span>
                        <span className="reword-where">{rewordWhere(e, activeResume)}</span>
                      </span>
                      {/* 只顯示改完的那一句：刪掉的字劃線、加上的字標色，一眼看出改了哪裡。 */}
                      <span className="reword-diff">
                        {e.location.section === "skills" ? (
                          <ins className="reword-ins">{e.after}</ins>
                        ) : (
                          inlineDiff(e.before, e.after).map((part, k) =>
                            part.type === "del" ? (
                              <del key={k} className="reword-del">
                                {part.text}
                              </del>
                            ) : part.type === "ins" ? (
                              <ins key={k} className="reword-ins">
                                {part.text}
                              </ins>
                            ) : (
                              <span key={k}>{part.text}</span>
                            ),
                          )
                        )}
                      </span>
                      {e.reason && <span className="trim-item-reason">{e.reason}</span>}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
          {!reword.loading && reword.notFound.length > 0 && (
            <ul className="reword-notfound">
              {reword.notFound.map((n) => (
                <li key={n.keyword}>
                  <strong>{n.keyword}</strong>：{n.reason || "履歷裡找不到講同一件事的句子"}
                </li>
              ))}
            </ul>
          )}
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
    </SectionLabelsProvider>
  );
}
