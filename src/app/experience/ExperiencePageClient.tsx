"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ExperienceCanvas, type ExperienceEntry, type HighlightTarget } from "./ExperienceCanvas";
import Link from "next/link";
import { FlagRail } from "./FlagRail";
import { TagRail } from "./TagRail";
import { InfoTip } from "@/app/InfoTip";
import { activeStoredFlag } from "@/lib/experience/storedFlag";
import { BULLET_RULE_TAGS, stripRuleRefs } from "@/lib/experience/bulletRules";
import { ElicitationPanel } from "./ElicitationPanel";
import { LangSwitch } from "@/app/LangSwitch";
import { LayoutMenu } from "@/app/LayoutMenu";
import { readLayoutSettings, type ResumeLayoutSettings } from "@/lib/resumes/typography";
import type { ProfileBackground } from "@/lib/resumes/background";
import { ProgressBar } from "@/app/ProgressBar";
import { RedoIcon, UndoIcon } from "@/app/icons";
import { useUndoShortcuts } from "@/app/useUndoShortcuts";
import { SectionLabelsProvider } from "@/app/SectionLabels";
import type { CustomSectionLabels } from "@/lib/resumes/sectionLabels";
import {
  applyFlagRewriteAction,
  markVariantsReviewedAction,
  restoreExperienceSnapshotAction,
  saveDefaultLayoutAction,
  scanExperienceDbAction,
  setRuleMutedAction,
  type ExperienceSnapshot,
  type ReviewedVariant,
  type ScanFlag,
} from "./actions";
import { flagKey } from "./FlagRail";
import type { RefineRequest } from "./ExperienceCanvas";

type RefineSeed = RefineRequest;

// 檢查整份經歷資料庫時一次送幾條給 AI。拆批才能顯示真實進度，也比較不會因為內容太多被截斷。
const SCAN_BATCH_SIZE = 20;
// 一批平常大約要跑多久（毫秒），用來讓進度條在一批之內也慢慢往前走。
const SCAN_BATCH_EXPECTED_MS = 12000;

// 新增經歷改到 /experience/add（跟首次設定同一套兩張卡片），這頁的 AI 面板只剩潤飾用。
type PanelState = { mode: "refine"; seed: RefineSeed } | null;

type LayoutMap = Partial<Record<"zh" | "en", ResumeLayoutSettings>>;

/** 上次檢查存下來、還沒處理的建議（重新整理頁面後也要在）。 */
function storedFlags(entries: ExperienceEntry[]): ScanFlag[] {
  return entries.flatMap((entry) =>
    entry.achievements.flatMap((ach) =>
      ach.variants.flatMap((v, variantIndex) => {
        const f = activeStoredFlag(v);
        return f
          ? [
              {
                entryId: entry.id,
                achievementId: ach.id,
                variantIndex,
                text: v.text,
                suggestion: stripRuleRefs(f.suggestion),
                rewrite: f.rewrite,
                rules: f.rules,
              },
            ]
          : [];
      }),
    ),
  );
}

// ---- 上一步／下一步 ----
// 經歷資料庫是改完一格就直接存，所以「上一步」要把資料庫整份還原回去。每次資料庫內容一變（手動修改、
// AI 問答新增、上傳履歷、檢查），就把變之前的整份記一份。紀錄存在這個分頁的 sessionStorage（依帳號分開），
// 到「新增經歷」頁上傳完回來也還在，關掉分頁才清掉。
const HISTORY_LIMIT = 20;

interface History {
  /** 上次記下的狀態；畫面拿到的資料跟它不一樣，就代表資料庫又變了一次。 */
  baseline: ExperienceSnapshot;
  past: ExperienceSnapshot[];
  future: ExperienceSnapshot[];
}

function toSnapshot(entries: ExperienceEntry[], background: ProfileBackground): ExperienceSnapshot {
  return {
    entries: entries.map((e) => ({
      id: e.id,
      language: e.language,
      entryType: e.entryType,
      orgName: e.orgName,
      location: e.location,
      roleVariants: e.roleVariants,
      periodVariants: e.periodVariants,
      achievements: e.achievements,
      createdAt: e.createdAt,
      sortOrder: e.sortOrder,
    })),
    background,
  };
}

function sameSnapshot(a: ExperienceSnapshot, b: ExperienceSnapshot): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function historyKey(userId: string) {
  return `jobahn:experience-history:${userId}`;
}

function loadHistory(userId: string): History | null {
  try {
    const raw = sessionStorage.getItem(historyKey(userId));
    return raw ? (JSON.parse(raw) as History) : null;
  } catch {
    return null;
  }
}

function saveHistory(userId: string, history: History) {
  try {
    sessionStorage.setItem(historyKey(userId), JSON.stringify(history));
  } catch {
    // 存不了（私密瀏覽、空間滿了）就只在這次頁面裡有效。
  }
}

/** 建議只剩被關掉的類別就不顯示；舊的建議沒有標籤，照常顯示。 */
function withoutMuted(flags: ScanFlag[], muted: string[]): ScanFlag[] {
  return flags.flatMap((f) => {
    if (!f.rules?.length) return [f];
    const rules = f.rules.filter((r) => !muted.includes(r));
    return rules.length > 0 ? [{ ...f, rules }] : [];
  });
}

export function ExperiencePageClient({
  userId,
  entries,
  background,
  initialLayouts,
  initialMutedRules,
  initialSectionLabels,
}: {
  /** 上一步／下一步的紀錄依帳號分開存。 */
  userId: string;
  entries: ExperienceEntry[];
  /** 經歷以外的 Summary、學歷、技能、語言（每個語言各一份）。 */
  background: ProfileBackground;
  /** 使用者調過的字級／上下間距（存在帳號裡，也是新履歷的預設排版）。 */
  initialLayouts: LayoutMap;
  /** 使用者關掉的提醒類別（只影響檢查）。 */
  initialMutedRules: string[];
  /** 使用者改過的區塊標題（全帳號共用）。 */
  initialSectionLabels: Record<"zh" | "en", CustomSectionLabels>;
}) {
  const [mutedRules, setMutedRules] = useState<string[]>(initialMutedRules);
  const [layouts, setLayouts] = useState<LayoutMap>(initialLayouts);
  const layoutSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [panel, setPanel] = useState<PanelState>(null);
  const [activeFlagKey, setActiveFlagKey] = useState<string | null>(null);
  const [activeLanguage, setActiveLanguage] = useState<"zh" | "en">("zh");
  const [highlight, setHighlight] = useState<HighlightTarget | null>(null);
  const [flags, setFlags] = useState<ScanFlag[]>(() => withoutMuted(storedFlags(entries), initialMutedRules));
  const [isScanning, setIsScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  // 檢查完沒有任何建議時的說明（例如「全部都通過了」），有建議時不顯示。
  const [scanNote, setScanNote] = useState<string | null>(null);

  // 檢查結果的說明顯示幾秒就收起來。
  useEffect(() => {
    if (!scanNote) return;
    const timer = setTimeout(() => setScanNote(null), 6000);
    return () => clearTimeout(timer);
  }, [scanNote]);
  // done：跑完幾批；batches：總共幾批（第一批回來前不知道總數，先當 1 批）；creep：目前這批跑到幾成（0–0.9）。
  const [scan, setScan] = useState<{ done: number; batches: number } | null>(null);
  const [creep, setCreep] = useState(0);

  useEffect(() => {
    if (!isScanning) return;
    const start = Date.now();
    const timer = setInterval(() => {
      setCreep(Math.min(0.9, 1 - Math.exp(-(Date.now() - start) / SCAN_BATCH_EXPECTED_MS)));
    }, 200);
    return () => clearInterval(timer);
  }, [isScanning, scan?.done]);

  // ---- 上一步／下一步 ----
  const [past, setPast] = useState<ExperienceSnapshot[]>([]);
  const [future, setFuture] = useState<ExperienceSnapshot[]>([]);
  const [restoring, setRestoring] = useState(false);
  // 畫布是 contentEditable，整份內容被換掉時要重新掛載，畫面才會顯示還原後的內容。
  const [canvasVersion, setCanvasVersion] = useState(0);
  const baseline = useRef<ExperienceSnapshot | null>(null);
  // 還原中：資料庫的變動是自己造成的，不算新的一步。
  const restoringTo = useRef<ExperienceSnapshot | null>(null);
  // 檢查是分好幾批寫進資料庫的，跑完才算一步。
  const batching = useRef(false);
  const latest = useRef<ExperienceSnapshot>(toSnapshot(entries, background));

  const persist = useCallback(
    (nextPast: ExperienceSnapshot[], nextFuture: ExperienceSnapshot[], nextBaseline: ExperienceSnapshot) => {
      setPast(nextPast);
      setFuture(nextFuture);
      baseline.current = nextBaseline;
      saveHistory(userId, { baseline: nextBaseline, past: nextPast, future: nextFuture });
    },
    [userId],
  );

  /** 資料庫的內容跟上次記下的不一樣：把上次的記進上一步。 */
  const recordChange = useCallback(
    (current: ExperienceSnapshot, prevPast: ExperienceSnapshot[]) => {
      const before = baseline.current;
      if (!before || sameSnapshot(before, current)) return;
      persist([...prevPast.slice(-(HISTORY_LIMIT - 1)), before], [], current);
    },
    [persist],
  );

  /** 還原完成：建議跟著還原後的內容重算，畫布重新掛載。 */
  const applyRestored = useCallback(
    (restored: ExperienceEntry[]) => {
      setFlags(withoutMuted(storedFlags(restored), mutedRules));
      setCanvasVersion((v) => v + 1);
    },
    [mutedRules],
  );

  const pastRef = useRef(past);
  useEffect(() => {
    pastRef.current = past;
  }, [past]);

  useEffect(() => {
    const current = toSnapshot(entries, background);
    latest.current = current;
    // 第一次打開：接上這個分頁之前的紀錄（例如到「新增經歷」頁上傳完回來，上傳就算一步）。
    if (baseline.current === null) {
      const saved = loadHistory(userId);
      pastRef.current = saved?.past ?? [];
      persist(saved?.past ?? [], saved?.future ?? [], saved?.baseline ?? current);
      recordChange(current, pastRef.current);
      return;
    }
    if (restoringTo.current) {
      if (!sameSnapshot(current, restoringTo.current)) return;
      restoringTo.current = null;
      baseline.current = current;
      applyRestored(entries);
      return;
    }
    if (batching.current) return;
    recordChange(current, pastRef.current);
    // applyRestored 只在還原完成那一次用到，關掉的提醒類別變了不需要重跑這段。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries, background, userId, recordChange, persist]);

  async function restore(target: ExperienceSnapshot, nextPast: ExperienceSnapshot[], nextFuture: ExperienceSnapshot[]) {
    if (restoring || !baseline.current) return;
    setRestoring(true);
    setScanError(null);
    const previous = { past, future, baseline: baseline.current };
    restoringTo.current = target;
    persist(nextPast, nextFuture, target);
    const result = await restoreExperienceSnapshotAction(target);
    setRestoring(false);
    if (result.error) {
      restoringTo.current = null;
      persist(previous.past, previous.future, previous.baseline);
      setScanError(`還原失敗：${result.error}`);
    }
  }

  function handleUndo() {
    const target = past[past.length - 1];
    if (!target || !baseline.current) return;
    void restore(target, past.slice(0, -1), [...future, baseline.current]);
  }

  function handleRedo() {
    const target = future[future.length - 1];
    if (!target || !baseline.current) return;
    void restore(target, [...past.slice(-(HISTORY_LIMIT - 1)), baseline.current], future.slice(0, -1));
  }

  useUndoShortcuts({ undo: handleUndo, redo: handleRedo, enabled: !restoring && !isScanning });

  const scanProgress = scan ? ((scan.done + (scan.done < scan.batches ? creep : 0)) / scan.batches) * 100 : null;

  const layout = readLayoutSettings(layouts[activeLanguage], activeLanguage);

  // 畫面馬上套用，停 0.5 秒後存到帳號。
  function changeLayout(next: ResumeLayoutSettings) {
    const lang = activeLanguage;
    setLayouts((prev) => ({ ...prev, [lang]: next }));
    if (layoutSaveTimer.current) clearTimeout(layoutSaveTimer.current);
    layoutSaveTimer.current = setTimeout(async () => {
      const result = await saveDefaultLayoutAction(lang, next);
      if (result.error) setScanError(`字級／間距沒有存到（${result.error}）`);
    }, 500);
  }

  const hasZh = entries.some((e) => e.language === "zh");
  const hasEn = entries.some((e) => e.language === "en");

  async function handleScan() {
    setIsScanning(true);
    setScanError(null);
    setScanNote(null);
    setCreep(0);
    setScan({ done: 0, batches: 1 });
    batching.current = true;
    const collected: ScanFlag[] = [];
    const passed: ReviewedVariant[] = [];
    let skipped = 0;
    let checked = 0;
    try {
      let offset = 0;
      let total = Infinity;
      while (offset < total) {
        const result = await scanExperienceDbAction(offset, SCAN_BATCH_SIZE);
        if (result.error) {
          setScanError(result.error);
          return;
        }
        collected.push(...(result.flags ?? []));
        passed.push(...(result.passed ?? []));
        total = result.total ?? 0;
        skipped = result.reviewedCount ?? 0;
        checked = total;
        offset += SCAN_BATCH_SIZE;
        const batches = Math.max(1, Math.ceil(total / SCAN_BATCH_SIZE));
        setCreep(0);
        setScan({ done: Math.min(batches, offset / SCAN_BATCH_SIZE), batches });
      }
      setFlags(collected);
      setActiveFlagKey(null);
      // 通過的記下來，內容沒再改的話下次檢查就跳過。等全部批次跑完才記，分批的編號才不會跑掉。
      if (passed.length > 0) await markVariantsReviewedAction(passed);
      if (collected.length === 0) {
        setScanNote(
          checked === 0
            ? `全部 ${skipped} 條之前都檢查過了，而且之後沒有改動，這次不用再檢查。`
            : `這次檢查的 ${checked} 條都符合規則${skipped > 0 ? `（另外 ${skipped} 條之前就通過了，沒有改動所以跳過）` : ""}。`,
        );
      }
    } catch (e) {
      setScanError(e instanceof Error ? e.message : "檢查失敗，請再試一次");
    } finally {
      // 整次檢查（含記下通過的）算一步。
      batching.current = false;
      recordChange(latest.current, pastRef.current);
      setIsScanning(false);
      // 停在 100% 一下再收起來，讓使用者看到「跑完了」。
      setTimeout(() => setScan(null), 600);
    }
  }

  function removeFlag(flag: ScanFlag) {
    const key = flagKey(flag);
    setFlags((prev) => prev.filter((f) => flagKey(f) !== key));
    setActiveFlagKey((k) => (k === key ? null : k));
  }

  // 卡片按 ✓：直接用 AI 給的改寫取代原本那條。先把卡片拿掉，存檔跟雙語同步在背景跑。
  function handleAccept(flag: ScanFlag) {
    if (!flag.rewrite) return;
    removeFlag(flag);
    setHighlight({ entryId: flag.entryId, achievementId: flag.achievementId, variantIndex: flag.variantIndex, color: "updated" });
    void applyFlagRewriteAction({
      entryId: flag.entryId,
      achievementId: flag.achievementId,
      variantIndex: flag.variantIndex,
      originalText: flag.text,
      newText: flag.rewrite,
    }).then((result) => {
      if (result.error) {
        setScanError(result.error);
        setFlags((prev) => [...prev, flag]);
      }
    });
  }

  // 卡片按 ✕：這條不改。記成「檢查過」，內容沒再改的話之後檢查不會再標它。
  function handleDismiss(flag: ScanFlag) {
    removeFlag(flag);
    void markVariantsReviewedAction([
      { entryId: flag.entryId, achievementId: flag.achievementId, variantIndex: flag.variantIndex, text: flag.text },
    ]);
  }

  // 「這類不用再提醒」／「恢復提醒」：畫面先改，背景存到帳號。恢復的那一類要重新檢查才會再出現。
  async function setRuleMuted(ruleId: string, muted: boolean) {
    const next = muted ? [...new Set([...mutedRules, ruleId])] : mutedRules.filter((r) => r !== ruleId);
    setMutedRules(next);
    if (muted) setFlags((prev) => withoutMuted(prev, next));
    const result = await setRuleMutedAction(ruleId, muted);
    if (result.error) setScanError(`提醒設定沒有存到（${result.error}）`);
  }

  function openRefine(seed: RefineSeed) {
    setHighlight({
      entryId: seed.entryId,
      achievementId: seed.achievementId,
      variantIndex: seed.variantIndex,
      color: "editing",
    });
    setPanel({ mode: "refine", seed });
  }

  function handleCommitted(info: { entryId: string; achievementId: string; variantIndex: number }) {
    setHighlight({
      entryId: info.entryId,
      achievementId: info.achievementId,
      variantIndex: info.variantIndex,
      color: "updated",
    });
    // 這條/這個成就已經處理過了，之前掃描標記的警示要跟著清掉，不然使用者會覺得
    // 「我明明改完了，怎麼黃底警示還在」。同一個 achievement 底下不管標記的是哪個
    // variantIndex 都一併清掉，因為潤飾可能連帶更新了同一組裡的其他寫法。
    setFlags((prev) =>
      prev.filter((f) => !(f.entryId === info.entryId && f.achievementId === info.achievementId)),
    );
  }

  function clearHighlightIfIdle() {
    if (!panel) setHighlight(null);
    setActiveFlagKey(null);
  }

  // 右欄只顯示目前語言的建議。
  const langEntryIds = new Set(entries.filter((e) => e.language === activeLanguage).map((e) => e.id));
  const visibleFlags = flags.filter((f) => langEntryIds.has(f.entryId));

  return (
    <SectionLabelsProvider initial={initialSectionLabels}>
      <div className="canvas-layout">
        <div className="canvas-main" onClick={clearHighlightIfIdle}>
          <div className="canvas-bar">
            <div className="canvas-bar-start">
              <LangSwitch
                options={[
                  { value: "zh" as const, label: `中文履歷${hasZh ? "" : "（尚無資料）"}` },
                  { value: "en" as const, label: `英文履歷${hasEn ? "" : "（尚無資料）"}` },
                ]}
                value={activeLanguage}
                onChange={setActiveLanguage}
              />
              <LayoutMenu language={activeLanguage} layout={layout} onChange={changeLayout} />
              {/* 上一步／下一步：跟「Aa」一樣是灰色純圖示，沒有紀錄時變淡、不能按。 */}
              <div className="canvas-history">
                <button
                  type="button"
                  className="icon-btn canvas-history-btn"
                  onClick={handleUndo}
                  disabled={restoring || isScanning || past.length === 0}
                  title="上一步（⌘Z／Ctrl+Z）"
                  aria-label="上一步"
                >
                  <UndoIcon />
                </button>
                <button
                  type="button"
                  className="icon-btn canvas-history-btn"
                  onClick={handleRedo}
                  disabled={restoring || isScanning || future.length === 0}
                  title="下一步（⇧⌘Z／Shift+Ctrl+Z）"
                  aria-label="下一步"
                >
                  <RedoIcon />
                </button>
              </div>
            </div>
            <div className="canvas-bar-actions">
              {scanError && <span className="text-error">{scanError}</span>}
              <Link href={`/experience/add?lang=${activeLanguage}`} className="btn btn-secondary">
                新增經歷
              </Link>
              <button type="button" className="btn btn-secondary" disabled={isScanning} onClick={handleScan}>
                檢查整份經歷資料庫
              </button>
            </div>
          </div>
          {scanProgress !== null && (
            <ProgressBar
              value={scanProgress}
              label={
                scan && scan.batches > 1
                  ? `正在逐條檢查經歷資料庫（第 ${Math.min(scan.done + 1, scan.batches)} / ${scan.batches} 批）…`
                  : "正在逐條檢查經歷資料庫…"
              }
            />
          )}
          {scanNote && scanProgress === null && <p className="scan-note">{scanNote}</p>}
          {mutedRules.length > 0 && (
            <div className="muted-rules">
              <span>
                已關閉的提醒
                <InfoTip label="已關閉提醒的說明">
                  <ul>
                    <li>關掉的類別，檢查時不會再標記</li>
                    <li>生成履歷時一樣會照規則寫</li>
                    <li>恢復之後重新檢查，就會再出現</li>
                  </ul>
                </InfoTip>
              </span>
              {mutedRules.map((id) => (
                <span key={id} className="muted-rule-chip">
                  {BULLET_RULE_TAGS.find((t) => t.id === id)?.name ?? id}
                  <button type="button" className="btn-link" onClick={() => void setRuleMuted(id, false)}>
                    恢復
                  </button>
                </span>
              ))}
            </div>
          )}
          <ExperienceCanvas
            key={canvasVersion}
            entries={entries}
            background={background[activeLanguage]}
            otherBackground={background[activeLanguage === "zh" ? "en" : "zh"]}
            language={activeLanguage}
            layout={layout}
            onActivateFlag={setActiveFlagKey}
            highlight={highlight}
            flags={visibleFlags}
            activeFlagKey={activeFlagKey}
          />
        </div>

        {/* 右欄有兩種狀態：
            - 有檢查建議（審閱模式）：只放建議卡片，每張對齊畫布上對應的那一條（像 Google Docs 的註解）。
            - 建議都處理完（套用或 ✕ 忽略）：換成每條寫法的角度標籤，一樣對齊那一條。
            兩種一起放會互相推擠、對不齊，所以一次只顯示一種。 */}
        <div className="canvas-sidebar canvas-sidebar--rail">
          {visibleFlags.length > 0 ? (
            <>
              <p className="flag-rail-summary">
                還有 {visibleFlags.length} 條建議
                <InfoTip label="建議的說明">
                  <ul>
                    <li>每條按 ✓ 套用改寫、按 ✕ 忽略，或點「跟 AI 聊」補資訊</li>
                    <li>全部處理完，右欄會換回每條寫法的角度標籤</li>
                  </ul>
                </InfoTip>
              </p>
              <FlagRail
                flags={visibleFlags}
                entries={entries}
                activeKey={activeFlagKey}
                onActivate={setActiveFlagKey}
                onAccept={handleAccept}
                onDismiss={handleDismiss}
                onRefine={openRefine}
                onMute={(ruleId) => void setRuleMuted(ruleId, true)}
              />
            </>
          ) : (
            <TagRail entries={entries.filter((e) => e.language === activeLanguage)} />
          )}
        </div>
      </div>

      {panel && (
        <ElicitationPanel
          entries={entries.filter((e) => e.language === activeLanguage)}
          refineSeed={panel.mode === "refine" ? panel.seed : undefined}
          defaultLanguage={activeLanguage}
          onClose={() => setPanel(null)}
          onCommitted={handleCommitted}
        />
      )}
    </SectionLabelsProvider>
  );
}
