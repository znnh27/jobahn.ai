"use client";

import { LangSwitch } from "@/app/LangSwitch";
import { ConfirmDialog } from "@/app/ConfirmDialog";
import { ProgressBar, Spinner, useEstimatedProgress } from "@/app/ProgressBar";
import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  generateCoverLetterAction,
  recheckWithCoverLetterAction,
  addToCoverLetterAction,
  saveCoverLetterDraftAction,
  autoSaveCoverLetterAction,
  finalizeCoverLetterAction,
  reopenCoverLetterAction,
} from "../actions";
import { coveredByResume } from "@/lib/resumes/atsScore";
import { JdChecklist } from "../JdChecklist";
import type { GeneratedResume } from "@/lib/resumes/generateResume";
import { JdFitScore } from "../JdFitScore";
import { StatusMessage } from "@/app/StatusMessage";
import { useFlash } from "@/app/useFlash";
import { CheckIcon } from "@/app/icons";
import { CoverLetterChatPanel } from "./CoverLetterChatPanel";
import { letterLength, letterLengthUnit } from "@/lib/text/letterLength";
import { LetterEditor } from "./LetterEditor";
import {
  CoverLetterOptionsFields,
  choiceInvalid,
  choiceWordLimits,
  initialChoice,
  type CoverLetterChoice,
} from "./CoverLetterOptions";

type ChecklistMap = Record<string, GeneratedResume["jd_match_checklist"]>;
type Busy = "generate" | "recheck" | "add" | "save" | "finalize" | "reopen";

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
  // 儲存、重新比對、複製這種簡短確認不進訊息列，按鈕本身變「✓ 已儲存」2 秒（見 useFlash）。
  const { flashed, flash } = useFlash();
  const [busy, setBusy] = useState<Busy | null>(null);
  const isPending = busy !== null;

  const langCount = Math.max(1, selectedLangs.length);
  const [researching, setResearching] = useState(false);
  // JD 裡找不到填的公司名稱：可能 JD 貼錯，醒目提醒（不是一般的小字訊息）。
  // 這次生成參考了哪些公司網頁（列出來讓使用者自己確認查的是不是對的公司）。
  const [researchSources, setResearchSources] = useState<string[]>([]);
  // 「跟 AI 聊」面板：浮在右下角，邊聊邊看信。
  // AI 改完、或重新產生之後，記下改之前的整份信（跟當時的比對結果），可以按「復原上一版」退回；
  // 之後自己動手改了信，就不再提供復原（不然會連手動改的一起蓋掉）。
  const [chatOpen, setChatOpen] = useState(false);
  const [undo, setUndo] = useState<{ draft: Record<string, string>; checklist: ChecklistMap } | null>(null);
  // 「重新產生」視窗：跟第一次產生一樣選語言、字數上限、要不要研究公司。
  const [confirmRegenerate, setConfirmRegenerate] = useState(false);
  // 「補充進求職信」：記下第一次補充前的信（每個語言），跟現在的信比對，新加的字標綠底；只標最新一次，下一個動作就清掉（見 startAction）。
  const [addedBase, setAddedBase] = useState<Record<string, string>>({});
  // 生成完會接著比對職缺符合度，多抓 20 秒。
  const generateProgress = useEstimatedProgress(busy === "generate", 30000 * langCount + 20000 + (researching ? 15000 : 0));
  const recheckProgress = useEstimatedProgress(busy === "recheck", 20000);
  // 補完會立刻比對一次（沒過再補、再比一次），比單純補充多抓一倍時間。
  const addProgress = useEstimatedProgress(busy === "add", 50000);

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

  // 綠底只標最新一次補充或跟 AI 聊改到的字：任何下一個動作（補充、跟 AI 聊、復原、重新比對、重新產生、儲存、定案、自己打字）都先清掉，
  // 不然兩次補充的綠底疊在一起，分不出哪些是這次加的（2026-10-27 Z 要求）。
  const clearHighlight = () => setAddedBase((prev) => (Object.keys(prev).length > 0 ? {} : prev));
  function startAction() {
    setMessage(null);
    clearHighlight();
  }

  function handleGenerate(options: AutoGenerate) {
    // 重新產生時記下舊的那封，產生完可以按「復原上一版」拿回來。
    const previous = draft ? { draft, checklist: letterChecklist } : null;
    startAction();
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
      setUndo(previous);
      // 信換了，上一封信的比對結果不適用。
      setLetterChecklist({});
      setActiveLang(options.languages[0]);
      const { researchSources: sources, companyMismatch } = result.data;
      setResearchSources(sources ?? []);
      // JD 沒寫公司名稱：併進生成完成的訊息，看完按 × 就沒了（2026-10-27 Z 要求，以前是一直掛在信紙上方的黃色提示）。
      const companyNote = companyMismatch
        ? `。JD 裡沒寫公司名稱，信是照你填的「${companyMismatch}」寫的${sources && sources.length > 0 ? "，公司資料也是用這個名稱查的" : ""}，請確認公司是對的`
        : "";
      const done =
        sources === null
          ? "求職信生成完成"
          : sources.length > 0
            ? `求職信生成完成（參考了 ${sources.length} 個公司相關網頁）`
            : "求職信生成完成（查不到這間公司的具體資料，應徵動機改用職位內容來寫）";
      // 生成完直接比對一次，右欄才看得到信補上了哪些條件（以前要自己按「重新比對」，沒按就只顯示履歷的結果）。
      // 之後手動改信、跟 AI 聊改過，還是按「重新比對」更新。
      const recheck = await recheckWithCoverLetterAction(applicationId, result.data.cover_letter_draft);
      if (recheck.error || !recheck.data) {
        setMessage(`${done}，但比對職缺符合度失敗：${recheck.error ?? "請按「重新比對」再試一次"}${companyNote}`);
        return;
      }
      setLetterChecklist(recheck.data.cover_letter_checklist);
      setMessage(`${previous ? `${done}，不滿意可以按「復原上一版」` : done}${companyNote}`);
    });
  }

  // 補充、跟 AI 聊、復原上一版之後自動存檔（2026-10-27 Z 要求），存失敗才提醒手動按「儲存」。
  async function autoSave(next: Record<string, string>, checklist?: ChecklistMap, checkedLangs?: string[]) {
    const result = await autoSaveCoverLetterAction(applicationId, next, checklist, checkedLangs);
    return result.error ? `，但自動儲存失敗（${result.error}），請按「儲存」` : "，已自動儲存";
  }

  // 「跟 AI 聊」改好的信換進草稿並自動存檔，改到的字標綠底，記下改之前的那一版，可以按「復原上一版」拿回來。
  function applyChatRevision(lang: string, next: string) {
    if (!draft) return;
    const nextDraft = { ...draft, [lang]: next };
    startAction();
    // AI 改到的字也標綠底，一樣下一個動作就清掉。
    setAddedBase({ [lang]: draft[lang] ?? "" });
    setUndo({ draft, checklist: letterChecklist });
    setDraft(nextDraft);
    void run("save", async () => {
      const saved = await autoSave(nextDraft);
      setMessage(`AI 改好了${saved}；不滿意可以按「復原上一版」`);
    });
  }

  // 復原上一版：信跟右欄對照一起換回去，也自動存檔。
  function undoRevision() {
    if (!undo) return;
    const previous = undo;
    startAction();
    setDraft(previous.draft);
    setLetterChecklist(previous.checklist);
    if (!(activeLang in previous.draft)) setActiveLang(Object.keys(previous.draft)[0]);
    setUndo(null);
    void run("save", async () => {
      const saved = await autoSave(previous.draft, previous.checklist);
      setMessage(`已復原成上一版${saved}`);
    });
  }

  // 從履歷頁帶 ?generate= 過來：一進來就開始生成，並把網址上的參數拿掉，重新整理才不會再生成一次。
  const autoStarted = useRef(false);
  useEffect(() => {
    if (autoStarted.current || !autoGenerate) return;
    autoStarted.current = true;
    // 用瀏覽器原生的 replaceState：router.replace 碰上馬上開始的生成請求會沒生效，網址留著參數，重新整理就會再生成一次。
    window.history.replaceState(null, "", pathname);
    handleGenerate(autoGenerate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleRecheck() {
    if (!draft) return;
    startAction();
    void run("recheck", async () => {
      const result = await recheckWithCoverLetterAction(applicationId, draft);
      if (result.error || !result.data) {
        setMessage(`錯誤：${result.error}`);
        return;
      }
      setLetterChecklist(result.data.cover_letter_checklist);
      flash("recheck");
    });
  }

  // 「補充進求職信」：使用者勾了就等於確認自己具備，AI 每項都補（找不到事實的寫成能力陳述）；補上的條件右欄直接標成已寫到。
  function handleAddToLetter(items: GeneratedResume["jd_match_checklist"]) {
    if (!draft) return;
    const lang = activeLang;
    const before = draft[lang] ?? "";
    startAction();
    void run("add", async () => {
      const result = await addToCoverLetterAction(
        applicationId,
        lang,
        before,
        items.map((i) => ({ item: i.item, kind: i.kind ?? "requirement", partial: !!i.partial, gap: i.partial ? (i.gap ?? null) : null })),
      );
      if (result.error || !result.letter) {
        setMessage(`錯誤：${result.error ?? "補充失敗，請再試一次"}`);
        return;
      }
      const added = result.added ?? [];
      const failed = result.failed ?? [];
      if (result.letter === before) {
        setMessage(
          failed.length > 0
            ? `沒有補進任何條件：${failed.map((f) => `「${f.item}」${f.reason}`).join("；")}`
            : "沒有補進任何條件",
        );
        return;
      }
      // 右欄直接換成伺服器照這封新信比對的結果（跟「重新比對」同一套標準），一起存；
      // 之後信沒改就按「重新比對」會沿用，改了信重新比對，標準也一樣。
      const nextDraft = { ...draft, [lang]: result.letter };
      const nextChecklist = result.checklist ? { ...letterChecklist, [lang]: result.checklist } : letterChecklist;
      setUndo({ draft, checklist: letterChecklist });
      setDraft(nextDraft);
      setAddedBase({ [lang]: before });
      setLetterChecklist(nextChecklist);
      const saved = await autoSave(nextDraft, nextChecklist, result.checklist ? [lang] : []);
      const noExample = result.noExample?.length ?? 0;
      setMessage(
        [
          added.length > 0 ? `已補進 ${added.length} 項並通過比對${saved}` : `信改了，但補的項目都沒通過比對${saved}`,
          noExample > 0 && `其中 ${noExample} 項沒有具體事例，寫成能力陳述，有實例可以用「跟 AI 聊」補`,
          failed.length > 0 &&
            `${failed.map((f) => `「${f.item}」`).join("、")}補了兩次還是沒通過比對（${failed.map((f) => f.reason).filter(Boolean).join("；")}）`,
          `新加的字標成綠底，不滿意可以按「復原上一版」`,
        ]
          .filter(Boolean)
          .join("，"),
      );
    });
  }

  function handleSave() {
    if (!draft) return;
    startAction();
    void run("save", async () => {
      const result = await saveCoverLetterDraftAction(applicationId, draft);
      if (result.error) setMessage(`錯誤：${result.error}`);
      else flash("save");
    });
  }

  function handleFinalize() {
    if (!draft) return;
    startAction();
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
    startAction();
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
    navigator.clipboard.writeText(text).then(
      () => flash("copy"),
      () => setMessage("錯誤：複製失敗，請直接選取信的內容複製"),
    );
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
            <div className="canvas-bar-actions">
              {!completed ? (
                <>
                  {/* 順序跟履歷頁一樣：儲存在最左邊、重新產生跟重新比對排在一起、主要按鈕「定案」在最右邊（2026-10-25 Z 要求）。 */}
                  <button type="button" onClick={handleSave} disabled={isPending} className="btn btn-secondary">
                    {busy === "save" && <Spinner />}
                    {flashed === "save" ? (
                      <>
                        <CheckIcon /> 已儲存
                      </>
                    ) : (
                      "儲存"
                    )}
                  </button>
                  {undo && (
                    <button type="button" onClick={undoRevision} disabled={isPending} className="btn btn-secondary">
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
                  <button
                    type="button"
                    onClick={() => setConfirmRegenerate(true)}
                    disabled={isPending}
                    className="btn btn-secondary"
                  >
                    重新產生
                  </button>
                  <button type="button" onClick={handleRecheck} disabled={isPending} className="btn btn-secondary">
                    {flashed === "recheck" ? (
                      <>
                        <CheckIcon /> 已比對
                      </>
                    ) : (
                      "重新比對"
                    )}
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
                    {flashed === "copy" ? (
                      <>
                        <CheckIcon /> 已複製
                      </>
                    ) : (
                      "複製求職信"
                    )}
                  </button>
                </>
              )}
            </div>
          </div>
        )}
        {draft && <StatusMessage message={message} onClose={() => setMessage(null)} />}

        {draft && generateProgress !== null && (
          <ProgressBar value={generateProgress} label="AI 正在依履歷跟 JD 重新寫求職信…" />
        )}
        {recheckProgress !== null && (
          <ProgressBar value={recheckProgress} label="用履歷＋求職信重新比對 JD…" />
        )}
        {addProgress !== null && (
          <ProgressBar value={addProgress} label="補進求職信，補完立刻比對一次…" />
        )}

        {draft ? (
          <>
            <div className="letter-page">
              <LetterEditor
                label={`${LANG_LABEL[activeLang] ?? activeLang}求職信`}
                value={letterText}
                base={completed ? null : (addedBase[activeLang] ?? null)}
                readOnly={completed}
                onChange={(text) => {
                  setDraft((prev) => (prev ? { ...prev, [activeLang]: text } : prev));
                  setUndo(null);
                  clearHighlight();
                }}
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
                <li>生成時會自動比對，之後改了信要按「重新比對」</li>
                <li>信沒改，比對結果就不變</li>
              </ul>
            }
          />
          <JdChecklist
            items={checklistItems}
            isCovered={(i) => i.covered}
            scope="letter"
            language={checklistLang}
            onAddToLetter={completed || isPending || !draft ? undefined : handleAddToLetter}
          />
          {researchSources.length > 0 && <ResearchSources urls={researchSources} />}
        </div>
      </div>

      {confirmRegenerate && (
        <ConfirmDialog
          title="重新產生求職信？"
          message="AI 會依履歷、經歷資料庫跟 JD 從頭寫一封新的，畫面上現在的信會被換掉，包括你手動改過的地方。產生完不滿意，可以按「復原上一版」拿回現在這一封。"
          confirmLabel="重新產生"
          tone="primary"
          confirmDisabled={choiceInvalid(choice)}
          onConfirm={() => {
            setConfirmRegenerate(false);
            handleGenerate({
              languages: choice.languages,
              wordLimits: choiceWordLimits(choice),
              research: choice.research && researchAvailable,
            });
          }}
          onCancel={() => setConfirmRegenerate(false)}
        >
          <CoverLetterOptionsFields value={choice} onChange={setChoice} researchAvailable={researchAvailable} />
        </ConfirmDialog>
      )}

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
/** 右欄最下面：這次生成參考的公司網頁，平常收起來，點開才看得到連結。 */
function ResearchSources({ urls }: { urls: string[] }) {
  return (
    <details className="research-sources">
      <summary className="research-sources-summary">
        <span>參考了 {urls.length} 個公司網頁</span>
        <span className="research-sources-arrow" aria-hidden="true" />
      </summary>
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
