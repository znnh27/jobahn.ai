"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ScanFlag } from "./actions";
import type { ExperienceEntry, RefineRequest } from "./ExperienceCanvas";
import { CheckIcon, CloseIcon } from "@/app/icons";
import { BULLET_RULE_TAGS, type BulletRuleTag } from "@/lib/experience/bulletRules";

const TAG_BY_ID = new Map(BULLET_RULE_TAGS.map((t) => [t.id, t]));

// 「檢查整份經歷資料庫」的建議，像 Google Docs 註解一樣放在右欄：
// - 每張卡片盡量對齊畫布上對應的那一條；被點選的那張一定對齊，其他的往上下讓開。
// - 點卡片 → 畫布捲到那一條並標亮；點畫布上有標記的那一條 → 對應卡片亮起來、對齊過去。
// - 卡片右上角像 Word 註解：✓ 套用 AI 給的改寫、✕ 忽略這條建議（之後檢查不會再標，除非內容又改了）。
// 窄螢幕（單欄）時不對齊，改成一般清單（見 CSS .flag-rail）。

export function flagKey(f: { entryId: string; achievementId: string; variantIndex: number }) {
  return `${f.entryId}:${f.achievementId}:${f.variantIndex}`;
}

const CARD_GAP = 8;

export function FlagRail({
  flags,
  entries,
  activeKey,
  onActivate,
  onAccept,
  onDismiss,
  onRefine,
  onMute,
}: {
  flags: ScanFlag[];
  entries: ExperienceEntry[];
  activeKey: string | null;
  onActivate: (key: string) => void;
  onAccept: (flag: ScanFlag) => void;
  onDismiss: (flag: ScanFlag) => void;
  onRefine: (seed: RefineRequest) => void;
  /** 「這類不用再提醒」：之後檢查不再標記這一類。 */
  onMute: (ruleId: string) => void;
}) {

  const railRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const [tops, setTops] = useState<Record<string, number>>({});
  const [order, setOrder] = useState<string[]>([]);
  const [railHeight, setRailHeight] = useState(0);

  // 卡片一律照 flags 畫出來，這裡只負責算位置跟排序。
  // （以前是「在畫布上找得到那一條才畫卡片」，確認潤飾後內容重新載入的那一刻剛好找不到，
  // 卡片就整排消失，要等下次視窗大小變動才回來。）
  useLayoutEffect(() => {
    const rail = railRef.current;
    if (!rail) return;
    const main = rail.closest(".canvas-layout")?.querySelector(".canvas-main");

    const layout = () => {
      const railTop = rail.getBoundingClientRect().top;
      const items = flags.map((f, i) => {
        const key = flagKey(f);
        const el = document.querySelector<HTMLElement>(`[data-flag-key="${key}"]`);
        return {
          key,
          // 找不到對應那一條（例如內容正在重新載入）就排在最後，位置之後重算。
          target: el ? el.getBoundingClientRect().top - railTop : Number.MAX_SAFE_INTEGER - flags.length + i,
          height: cardRefs.current.get(key)?.offsetHeight ?? 0,
        };
      });
      items.sort((a, b) => a.target - b.target);

      const placed = new Array<number>(items.length);
      const anchor = items.findIndex((it) => it.key === activeKey);
      const clampTarget = (t: number) => (t >= Number.MAX_SAFE_INTEGER - flags.length ? 0 : Math.max(0, t));
      const packDown = (from: number) => {
        for (let i = from; i < items.length; i++) {
          const floor = i === 0 ? 0 : placed[i - 1] + items[i - 1].height + CARD_GAP;
          placed[i] = Math.max(clampTarget(items[i].target), floor);
        }
      };

      if (anchor === -1) {
        packDown(0);
      } else {
        // 被點選的那張對齊它那一條，前面的往上讓、後面的往下讓，都盡量靠近自己那一條。
        placed[anchor] = clampTarget(items[anchor].target);
        for (let i = anchor - 1; i >= 0; i--) {
          placed[i] = Math.min(clampTarget(items[i].target), placed[i + 1] - items[i].height - CARD_GAP);
        }
        if (anchor > 0 && placed[0] < 0) {
          // 上面放不下就整個從頂端重新往下排（這時被點選的那張會稍微往下）。
          packDown(0);
        } else {
          packDown(anchor + 1);
        }
      }

      const nextTops: Record<string, number> = {};
      items.forEach((it, i) => (nextTops[it.key] = placed[i]));
      const last = items.length - 1;
      setOrder(items.map((it) => it.key));
      setTops(nextTops);
      setRailHeight(last >= 0 ? placed[last] + items[last].height : 0);
    };

    // 畫布內容一變（重新載入、編輯、標記出現或消失）位置就會跑掉，下一個畫面再重算一次。
    let frame = 0;
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(layout);
    };

    layout();
    const resizeObserver = new ResizeObserver(schedule);
    if (main) resizeObserver.observe(main);
    resizeObserver.observe(rail);
    const mutationObserver = new MutationObserver(schedule);
    if (main) mutationObserver.observe(main, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-flag-key"] });
    window.addEventListener("resize", schedule);
    return () => {
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      mutationObserver.disconnect();
      window.removeEventListener("resize", schedule);
    };
  }, [flags, activeKey]);

  // 從畫布點過來的：卡片如果不在畫面裡（窄螢幕單欄時卡片在最下面），捲過去讓使用者看到。
  useLayoutEffect(() => {
    if (!activeKey) return;
    cardRefs.current.get(activeKey)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [activeKey]);

  const entryById = new Map(entries.map((e) => [e.id, e]));
  const byKey = new Map(flags.map((f) => [flagKey(f), f]));
  // 排序還沒算好（或有新的建議）時，先照原本順序畫出來，位置下一個畫面就會補上。
  const orderedKeys = [...order.filter((k) => byKey.has(k)), ...flags.map(flagKey).filter((k) => !order.includes(k))];

  return (
    <div className="flag-rail" ref={railRef} style={{ minHeight: railHeight }}>
      {orderedKeys.map((key) => {
        const f = byKey.get(key)!;
        const entry = entryById.get(f.entryId);
        const variant = entry?.achievements.find((a) => a.id === f.achievementId)?.variants[f.variantIndex];
        return (
          <div
            key={key}
            ref={(el) => {
              if (el) cardRefs.current.set(key, el);
              else cardRefs.current.delete(key);
            }}
            className={`flag-card ${activeKey === key ? "flag-card--active" : ""}`}
            style={{ top: tops[key] ?? 0 }}
            role="button"
            tabIndex={0}
            onClick={() => {
              onActivate(key);
              document.querySelector(`[data-flag-key="${key}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" });
            }}
            onKeyDown={(e) => {
              if (e.target !== e.currentTarget) return;
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onActivate(key);
              }
            }}
          >
            <div className="flag-card-head">
              <p className="flag-card-title">⚠ 建議加強</p>
              <div className="flag-card-actions">
                <button
                  type="button"
                  className="icon-btn flag-card-accept"
                  aria-label="套用建議的改寫"
                  title={f.rewrite ? "套用建議的改寫" : "這條沒有現成的改寫，點「跟 AI 聊」補資訊"}
                  disabled={!f.rewrite}
                  onClick={(e) => {
                    e.stopPropagation();
                    onAccept(f);
                  }}
                >
                  <CheckIcon />
                </button>
                <button
                  type="button"
                  className="icon-btn flag-card-dismiss"
                  aria-label="忽略這條建議"
                  title="忽略這條建議（內容沒改的話，之後檢查不會再標）"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDismiss(f);
                  }}
                >
                  <CloseIcon />
                </button>
              </div>
            </div>
            {(f.rules ?? []).length > 0 && (
              <div className="flag-card-tags">
                {(f.rules ?? []).map((id) => {
                  const tag = TAG_BY_ID.get(id);
                  return tag ? <RuleTagButton key={id} tag={tag} onMute={() => onMute(id)} /> : null;
                })}
              </div>
            )}
            <p className="flag-card-text">{f.suggestion}</p>
            {f.rewrite && (
              <p className="flag-card-rewrite">
                <span className="flag-card-rewrite-label">建議改成</span>
                {f.rewrite}
              </p>
            )}
            {entry && variant && (
              <button
                type="button"
                className="btn btn-secondary flag-card-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  onRefine({
                    entryId: f.entryId,
                    achievementId: f.achievementId,
                    variantIndex: f.variantIndex,
                    orgName: entry.orgName,
                    role: entry.roleVariants[0]?.role ?? "",
                    seedText: variant.text,
                    issue: f.suggestion,
                  });
                }}
              >
                跟 AI 聊
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** 卡片上的規則標籤：點一下跳出這類規則的定義，可以選「這類不用再提醒」。點外面或按 Esc 關閉。 */
function RuleTagButton({ tag, onMute }: { tag: BulletRuleTag; onMute: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    function close(e: Event) {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !ref.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  return (
    <span className="flag-rule-tag-wrap" ref={ref} onClick={(e) => e.stopPropagation()}>
      <button type="button" className="flag-rule-tag" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        {tag.name}
      </button>
      {open && (
        <span className="flag-rule-popover" role="dialog" aria-label={tag.name}>
          <span className="flag-rule-popover-title">{tag.name}</span>
          <span className="flag-rule-popover-text">{tag.description}</span>
          <span className="flag-rule-popover-actions">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => {
                setOpen(false);
                onMute();
              }}
            >
              這類不用再提醒
            </button>
          </span>
        </span>
      )}
    </span>
  );
}
