"use client";

import { useEffect, useRef, useState } from "react";
import { ExperienceCanvas, type ExperienceEntry, type HighlightTarget } from "./ExperienceCanvas";
import Link from "next/link";
import { FlagRail } from "./FlagRail";
import { TagRail } from "./TagRail";
import { InfoTip } from "@/app/InfoTip";
import { activeStoredFlag } from "@/lib/experience/storedFlag";
import { ElicitationPanel } from "./ElicitationPanel";
import { LangSwitch } from "@/app/LangSwitch";
import { LayoutMenu } from "@/app/LayoutMenu";
import { readLayoutSettings, type ResumeLayoutSettings } from "@/lib/resumes/typography";
import type { ProfileBackground } from "@/lib/resumes/background";
import { ProgressBar } from "@/app/ProgressBar";
import {
  applyFlagRewriteAction,
  markVariantsReviewedAction,
  saveDefaultLayoutAction,
  scanExperienceDbAction,
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
          ? [{ entryId: entry.id, achievementId: ach.id, variantIndex, text: v.text, suggestion: f.suggestion, rewrite: f.rewrite }]
          : [];
      }),
    ),
  );
}

export function ExperiencePageClient({
  entries,
  background,
  initialLayouts,
}: {
  entries: ExperienceEntry[];
  /** 經歷以外的 Summary、學歷、技能、語言（每個語言各一份）。 */
  background: ProfileBackground;
  /** 使用者調過的字級／上下間距（存在帳號裡，也是新履歷的預設排版）。 */
  initialLayouts: LayoutMap;
}) {
  const [layouts, setLayouts] = useState<LayoutMap>(initialLayouts);
  const layoutSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [panel, setPanel] = useState<PanelState>(null);
  const [activeFlagKey, setActiveFlagKey] = useState<string | null>(null);
  const [activeLanguage, setActiveLanguage] = useState<"zh" | "en">("zh");
  const [highlight, setHighlight] = useState<HighlightTarget | null>(null);
  const [flags, setFlags] = useState<ScanFlag[]>(() => storedFlags(entries));
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
      if (passed.length > 0) void markVariantsReviewedAction(passed);
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
    <>
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
          <ExperienceCanvas
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
                  每條按 ✓ 套用改寫、按 ✕ 忽略，或點「跟 AI 聊」補資訊。全部處理完，右欄會換回每條寫法的角度標籤。
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
    </>
  );
}
