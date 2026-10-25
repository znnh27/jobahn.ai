"use client";

import { LangSwitch } from "@/app/LangSwitch";
import { ProgressBar, Spinner, useEstimatedProgress } from "@/app/ProgressBar";
import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  generateCoverLetterAction,
  recheckWithCoverLetterAction,
  saveCoverLetterDraftAction,
  finalizeCoverLetterAction,
  reopenCoverLetterAction,
} from "../actions";
import { coveredByResume } from "@/lib/resumes/atsScore";
import { JdChecklist } from "../JdChecklist";
import type { GeneratedResume } from "@/lib/resumes/generateResume";
import { JdFitScore } from "../JdFitScore";
import { CoverLetterChatPanel } from "./CoverLetterChatPanel";
import { letterLength, letterLengthUnit } from "@/lib/text/letterLength";
import {
  CoverLetterOptionsFields,
  choiceInvalid,
  choiceWordLimits,
  initialChoice,
  type CoverLetterChoice,
} from "./CoverLetterOptions";

type ChecklistMap = Record<string, GeneratedResume["jd_match_checklist"]>;
type Busy = "generate" | "recheck" | "save" | "finalize" | "reopen";

interface CoverLetterProps {
  applicationId: string;
  resumeLanguages: string[];
  initialCoverLetterLanguages: string[];
  initialDraft: Record<string, string> | null;
  /** 履歷頁的 JD 條件清單（key 是履歷語言），求職信還沒比對過時先用它、只算履歷寫到的。 */
  resumeChecklist: ChecklistMap;
  /** 求職信比對過的結果（履歷＋求職信合起來，key 是求職信語言）。 */
  initialLetterChecklist: ChecklistMap;
  initialCompleted: boolean;
  /** 從履歷頁的視窗按確定跳過來時帶的選項（?generate=zh,en&limit_zh=400&research=1），一進來就自動開始生成
   * （已經有舊的求職信也會重新生成，使用者在履歷頁已經選過「依新履歷重新生成」）。 */
  autoGenerate: AutoGenerate | null;
  /** 有設 FIRECRAWL_API_KEY 才能在寫求職信前先研究公司。 */
  researchAvailable: boolean;
  /** 流程步驟列，放在左欄最上面，跟信紙同寬。 */
  stepBar: ReactNode;
}

export interface AutoGenerate {
  languages: string[];
  wordLimits: Record<string, number>;
  research: boolean;
}

const LANG_LABEL: Record<string, string> = { en: "英文", zh: "中文" };

// 求職信頁：跟履歷頁同一套版面。左欄工具列 + A4 信紙（直接在信紙上編輯），右欄 JD 符合度清單。
export function CoverLetter({
  applicationId,
  resumeLanguages,
  initialCoverLetterLanguages,
  initialDraft,
  resumeChecklist,
  initialLetterChecklist,
  initialCompleted,
  autoGenerate,
  researchAvailable,
  stepBar,
}: CoverLetterProps) {
  const router = useRouter();
  const pathname = usePathname();
  // 還沒有求職信時，頁面上直接選語言、字數上限、要不要研究公司。
  const [choice, setChoice] = useState<CoverLetterChoice>(() =>
    initialChoice(
      autoGenerate
        ? autoGenerate.languages
        : initialCoverLetterLanguages.length > 0
          ? initialCoverLetterLanguages
          : resumeLanguages,
      researchAvailable,
    ),
  );
  const selectedLangs = choice.languages;
  const [draft, setDraft] = useState<Record<string, string> | null>(initialDraft);
  const [letterChecklist, setLetterChecklist] = useState<ChecklistMap>(initialLetterChecklist);
  const [completed, setCompleted] = useState(initialCompleted);
  const [activeLang, setActiveLang] = useState(
    initialDraft ? (Object.keys(initialDraft)[0] ?? selectedLangs[0]) : selectedLangs[0],
  );
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState<Busy | null>(null);
  const isPending = busy !== null;

  const langCount = Math.max(1, selectedLangs.length);
  const [researching, setResearching] = useState(false);
  // JD 裡找不到填的公司名稱：可能 JD 貼錯，醒目提醒（不是一般的小字訊息）。
  const [companyWarning, setCompanyWarning] = useState<string | null>(null);
  // 這次生成參考了哪些公司網頁（列出來讓使用者自己確認查的是不是對的公司）。
  const [researchSources, setResearchSources] = useState<string[]>([]);
  // 「跟 AI 聊」面板：浮在右下角，邊聊邊看信。AI 改完記下改之前的那一版，可以按「復原上一版」退回；
  // 之後自己動手改了信，就不再提供復原（不然會連手動改的一起蓋掉）。
  const [chatOpen, setChatOpen] = useState(false);
  const [chatUndo, setChatUndo] = useState<{ lang: string; text: string } | null>(null);
  const generateProgress = useEstimatedProgress(busy === "generate", 30000 * langCount + (researching ? 15000 : 0));
  const recheckProgress = useEstimatedProgress(busy === "recheck", 20000);

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

  function handleGenerate(options: AutoGenerate) {
    setMessage(null);
    setResearching(options.research);
    void run("generate", async () => {
      const result = await generateCoverLetterAction(applicationId, options.languages, {
        wordLimits: options.wordLimits,
        research: options.research,
      });
      if (result.error || !result.data) {
        setMessage(`錯誤：${result.error}`);
        return;
      }
      setDraft(result.data.cover_letter_draft);
      setChatUndo(null);
      // 信換了，上一封信的比對結果不適用。
      setLetterChecklist({});
      setActiveLang(options.languages[0]);
      const { researchSources: sources, companyMismatch } = result.data;
      setCompanyWarning(companyMismatch);
      setResearchSources(sources ?? []);
      setMessage(
        sources === null
          ? "求職信生成完成"
          : sources.length > 0
            ? `求職信生成完成（參考了 ${sources.length} 個公司相關網頁）`
            : "求職信生成完成（查不到這間公司的具體資料，應徵動機改用職位內容來寫）",
      );
    });
  }

  // 「跟 AI 聊」改好的信換進草稿，記下改之前的那一版。改完要按「儲存」才會存。
  function applyChatRevision(lang: string, next: string) {
    if (!draft) return;
    setChatUndo({ lang, text: draft[lang] ?? "" });
    setDraft({ ...draft, [lang]: next });
    setMessage("AI 改好了，記得按「儲存」；不滿意可以按「復原上一版」");
  }

  function undoChatRevision() {
    if (!draft || !chatUndo) return;
    setDraft({ ...draft, [chatUndo.lang]: chatUndo.text });
    setChatUndo(null);
    setMessage("已復原成 AI 改之前的版本");
  }

  // 從履歷頁帶 ?generate= 過來：一進來就開始生成，並把網址上的參數拿掉，重新整理才不會再生成一次。
  const autoStarted = useRef(false);
  useEffect(() => {
    if (autoStarted.current || !autoGenerate) return;
    autoStarted.current = true;
    router.replace(pathname);
    handleGenerate(autoGenerate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleRecheck() {
    if (!draft) return;
    setMessage(null);
    void run("recheck", async () => {
      const result = await recheckWithCoverLetterAction(applicationId, draft);
      if (result.error || !result.data) {
        setMessage(`錯誤：${result.error}`);
        return;
      }
      setLetterChecklist(result.data.cover_letter_checklist);
      setMessage("已重新比對職缺符合度");
    });
  }

  function handleSave() {
    if (!draft) return;
    setMessage(null);
    void run("save", async () => {
      const result = await saveCoverLetterDraftAction(applicationId, draft);
      setMessage(result.error ? `錯誤：${result.error}` : "已儲存");
    });
  }

  function handleFinalize() {
    if (!draft) return;
    setMessage(null);
    void run("finalize", async () => {
      const result = await finalizeCoverLetterAction(applicationId, draft);
      if (result.error) {
        setMessage(`錯誤：${result.error}`);
        return;
      }
      setCompleted(true);
      setMessage("已定案");
      // 讓標題列的步驟列更新到「完成」。
      router.refresh();
    });
  }

  function handleReopen() {
    setMessage(null);
    void run("reopen", async () => {
      const result = await reopenCoverLetterAction(applicationId);
      if (result.error) {
        setMessage(`錯誤：${result.error}`);
        return;
      }
      setCompleted(false);
      setMessage("已回到編輯，改完記得重新定案");
      // 步驟列的「完成」要拿掉打勾。
      router.refresh();
    });
  }

  function handleCopy(text: string) {
    navigator.clipboard.writeText(text);
    setMessage("已複製到剪貼簿");
  }

  const draftLangs = draft ? selectedLangs.filter((l) => l in draft) : [];
  const letterText = draft?.[activeLang] ?? "";
  const lengthLabel = `${activeLang === "zh" ? "共 " : ""}${letterLength(letterText, activeLang)} ${letterLengthUnit(activeLang)}`;
  const checklistLang = resumeLanguages.includes(activeLang) ? activeLang : resumeLanguages[0];
  // 這封信比對過就用比對結果；還沒比對過，先顯示履歷本身寫到的。
  const checklistItems =
    letterChecklist[activeLang] ??
    (resumeChecklist[checklistLang] ?? []).map((i) => ({
      ...i,
      covered: coveredByResume(i),
      source: coveredByResume(i) ? ("resume" as const) : null,
    }));

  return (
    <div className="canvas-layout">
      <div className="canvas-main">
        {stepBar}
        {draft && (
          <div className="canvas-bar">
            <LangSwitch
              options={(draftLangs.length > 0 ? draftLangs : Object.keys(draft)).map((lang) => ({
                value: lang,
                label: LANG_LABEL[lang] ?? lang,
              }))}
              value={activeLang}
              onChange={setActiveLang}
            />
            <span className="letter-length">{lengthLabel}</span>
            {message && (
              <span className="canvas-bar-message" title={message}>
                {message}
              </span>
            )}
            <div className="canvas-bar-actions">
              {!completed ? (
                <>
                  {chatUndo?.lang === activeLang && (
                    <button type="button" onClick={undoChatRevision} disabled={isPending} className="btn btn-secondary">
                      復原上一版
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setChatOpen((v) => !v)}
                    disabled={isPending && !chatOpen}
                    className="btn btn-secondary"
                  >
                    跟 AI 聊
                  </button>
                  <button type="button" onClick={handleSave} disabled={isPending} className="btn btn-secondary">
                    {busy === "save" && <Spinner />}
                    儲存
                  </button>
                  <button type="button" onClick={handleRecheck} disabled={isPending} className="btn btn-secondary">
                    重新比對職缺符合度
                  </button>
                  <button type="button" onClick={handleFinalize} disabled={isPending} className="btn btn-primary">
                    {busy === "finalize" && <Spinner />}
                    定案
                  </button>
                </>
              ) : (
                <>
                  <button type="button" onClick={handleReopen} disabled={isPending} className="btn btn-secondary">
                    {busy === "reopen" && <Spinner />}
                    編輯
                  </button>
                  <Link href="/" className="btn btn-secondary">
                    回首頁
                  </Link>
                  <button type="button" onClick={() => handleCopy(draft[activeLang] ?? "")} className="btn btn-primary">
                    複製求職信
                  </button>
                </>
              )}
            </div>
          </div>
        )}

        {draft && generateProgress !== null && (
          <ProgressBar value={generateProgress} label="AI 正在依履歷跟 JD 重新寫求職信…" />
        )}
        {companyWarning && researchSources.length === 0 && (
          <div className="alert alert-warning" role="status">
            JD 裡沒有寫公司名稱，信裡的公司是照你填的「{companyWarning}」寫的。請確認公司是對的。
          </div>
        )}
        {researchSources.length > 0 && (
          <ResearchSources
            urls={researchSources}
            warning={
              companyWarning
                ? `JD 裡沒有寫公司名稱，信裡的公司是照你填的「${companyWarning}」寫的，公司資料也是用這個名稱查的。請確認公司是對的。`
                : null
            }
          />
        )}
        {recheckProgress !== null && (
          <ProgressBar value={recheckProgress} label="用履歷＋求職信重新比對 JD…" />
        )}

        {draft ? (
          <>
            <div className="letter-page">
              <textarea
                aria-label={`${LANG_LABEL[activeLang] ?? activeLang}求職信`}
                value={letterText}
                readOnly={completed}
                onChange={(e) => {
                  const text = e.target.value;
                  setDraft((prev) => (prev ? { ...prev, [activeLang]: text } : prev));
                  setChatUndo(null);
                }}
                className="letter-page-text"
              />
            </div>
          </>
        ) : (
          <div className="letter-page letter-page--empty">
            {generateProgress !== null ? (
              <ProgressBar
                value={generateProgress}
                label={researching ? "先上網研究這間公司，再依履歷跟 JD 寫求職信…" : "AI 正在依履歷跟 JD 寫求職信…"}
              />
            ) : (
              <>
                <p className="text-body">選擇語言（可複選），需要的話設定字數上限。</p>
                <CoverLetterOptionsFields value={choice} onChange={setChoice} researchAvailable={researchAvailable} />
                <button
                  type="button"
                  onClick={() =>
                    handleGenerate({
                      languages: choice.languages,
                      wordLimits: choiceWordLimits(choice),
                      research: choice.research && researchAvailable,
                    })
                  }
                  disabled={isPending || choiceInvalid(choice)}
                  className="btn btn-primary"
                >
                  開始生成
                </button>
                {message && <p className="text-error">{message}</p>}
              </>
            )}
          </div>
        )}
      </div>

      <div className="canvas-sidebar canvas-sidebar--match">
        <div className="card card--sm">
          <h2 className="heading-card">JD 條件對照</h2>
          <JdFitScore
            items={checklistItems.filter((i) => !i.invalid)}
            note={
              <ul>
                <li>履歷＋求職信合起來涵蓋的 JD 條件比例</li>
                <li>軟實力、工作條件也算，這兩類靠求職信補</li>
                <li>求職信補上的，按「重新比對職缺符合度」才會算進來</li>
                <li>信沒改，比對結果就不變</li>
              </ul>
            }
          />
          <JdChecklist items={checklistItems} isCovered={(i) => i.covered} scope="letter" showSource language={checklistLang} />
        </div>
      </div>

      {chatOpen && !completed && draft && (
        <CoverLetterChatPanel
          key={activeLang}
          applicationId={applicationId}
          language={activeLang}
          letter={letterText}
          onApply={(next) => applyChatRevision(activeLang, next)}
          onClose={() => setChatOpen(false)}
        />
      )}
    </div>
  );
}

/**
 * 這次參考的公司網頁：整個框是一個下拉，箭頭在最右邊，點開才列出網址。
 * JD 沒寫公司名時用提醒框（請使用者確認公司），有寫就只是一般說明。
 */
function ResearchSources({ urls, warning }: { urls: string[]; warning: string | null }) {
  return (
    <details className={`alert research-sources ${warning ? "alert-warning" : "research-sources--plain"}`}>
      <summary className="research-sources-summary">
        <span>{warning ?? `求職信參考了這間公司的公開資料（${urls.length} 個網頁）`}</span>
        <span className="research-sources-arrow" aria-hidden="true" />
      </summary>
      <p className="research-sources-title">這次參考的 {urls.length} 個公司網頁：</p>
      <ul className="research-sources-list">
        {urls.map((url) => (
          <li key={url}>
            <a href={url} target="_blank" rel="noreferrer" className="research-sources-link">
              {url}
            </a>
          </li>
        ))}
      </ul>
    </details>
  );
}
