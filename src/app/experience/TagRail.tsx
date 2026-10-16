"use client";

import { useLayoutEffect, useRef, useState } from "react";
import type { ExperienceEntry } from "./ExperienceCanvas";

// 每條寫法的角度標籤（例如「強調跨部門合作與量化成果」）放在右欄，像 Word 的註解欄：
// - 每段經歷一個淺色底塊，上下對齊畫布上那段經歷，最上面寫公司名稱。
// - 塊裡每個標籤（左邊一條短色條＋文字）對齊畫布上自己那一條；放不下時往下讓，底塊跟著長高。
// 不放在畫布裡：畫布要跟正式履歷長得一模一樣。
// 滑過標籤，畫布上那一條會淡淡標亮；滑過畫布上那一條，標籤也會亮起來。
// 有檢查建議時右欄換成建議卡片（FlagRail），這個元件不會出現。窄螢幕單欄時不顯示（見 CSS）。

const TAG_GAP = 4;
const BLOCK_GAP = 8;
const BLOCK_PAD = 10;

type Box = { top: number; height: number };

export function TagRail({ entries }: { entries: ExperienceEntry[] }) {
  const railRef = useRef<HTMLDivElement>(null);
  const elRefs = useRef<Map<string, HTMLElement>>(new Map());
  const [boxes, setBoxes] = useState<Record<string, Box>>({});
  const [railHeight, setRailHeight] = useState(0);
  const [hoverKey, setHoverKey] = useState<string | null>(null);

  const groups = entries
    .map((entry) => ({
      id: entry.id,
      org: entry.orgName,
      tags: entry.achievements
        .flatMap((ach) => ach.variants.map((v, vi) => ({ key: `${entry.id}:${ach.id}:${vi}`, label: v.angleLabel })))
        .filter((t) => t.label),
    }))
    .filter((g) => g.tags.length > 0);

  const signature = groups.map((g) => `${g.id}:${g.org}:${g.tags.map((t) => `${t.key}=${t.label}`).join(",")}`).join("|");

  const ref = (key: string) => (el: HTMLElement | null) => {
    if (el) elRefs.current.set(key, el);
    else elRefs.current.delete(key);
  };

  useLayoutEffect(() => {
    const rail = railRef.current;
    if (!rail) return;
    const main = rail.closest(".canvas-layout")?.querySelector(".canvas-main");

    const layout = () => {
      const railTop = rail.getBoundingClientRect().top;
      const rect = (sel: string) => document.querySelector<HTMLElement>(sel)?.getBoundingClientRect() ?? null;
      const h = (key: string) => elRefs.current.get(key)?.offsetHeight ?? 0;

      const next: Record<string, Box> = {};
      let floor = 0;
      // 照畫布上的順序由上往下排。
      const ordered = groups
        .map((g) => ({ g, r: rect(`[data-entry-key="${g.id}"]`) }))
        .filter((x): x is { g: (typeof groups)[number]; r: DOMRect } => x.r !== null)
        .sort((a, b) => a.r.top - b.r.top);

      for (const { g, r } of ordered) {
        const blockTop = Math.max(r.top - railTop, floor);
        const headKey = `head:${g.id}`;
        next[headKey] = { top: blockTop + BLOCK_PAD, height: h(headKey) };
        let tagFloor = blockTop + BLOCK_PAD + h(headKey) + TAG_GAP;
        for (const t of g.tags) {
          const tr = rect(`[data-variant-key="${t.key}"]`);
          if (!tr) continue;
          const top = Math.max(tr.top - railTop, tagFloor);
          next[t.key] = { top, height: h(t.key) };
          tagFloor = top + h(t.key) + TAG_GAP;
        }
        const blockBottom = Math.max(r.bottom - railTop, tagFloor - TAG_GAP + BLOCK_PAD);
        next[`block:${g.id}`] = { top: blockTop, height: blockBottom - blockTop };
        floor = blockBottom + BLOCK_GAP;
      }
      setBoxes(next);
      setRailHeight(floor);
    };

    let frame = 0;
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(layout);
    };
    // 每段、每條的高度一變（字型載入完、換行改變、編輯）位置就會跑掉，所以都監看。
    const resizeObserver = new ResizeObserver(schedule);
    const observeTargets = () => {
      resizeObserver.disconnect();
      if (main) resizeObserver.observe(main);
      main?.querySelectorAll("[data-variant-key], [data-entry-key]").forEach((el) => resizeObserver.observe(el));
    };
    layout();
    observeTargets();
    const mutationObserver = new MutationObserver(() => {
      observeTargets();
      schedule();
    });
    if (main) mutationObserver.observe(main, { childList: true, subtree: true, characterData: true });
    window.addEventListener("resize", schedule);
    void document.fonts?.ready.then(schedule);

    // 滑過畫布上的某一條 → 對應的標籤亮起來。
    const onOver = (e: Event) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>("[data-variant-key]");
      setHoverKey(el?.dataset.variantKey ?? null);
    };
    // 從畫布移到右欄的標籤上時不要清掉（React 的 onMouseEnter 會比原生的 mouseleave 早觸發）。
    const onLeave = (e: Event) => {
      if (((e as MouseEvent).relatedTarget as HTMLElement | null)?.closest?.(".tag-rail")) return;
      setHoverKey(null);
    };
    main?.addEventListener("mouseover", onOver);
    main?.addEventListener("mouseleave", onLeave);
    return () => {
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      mutationObserver.disconnect();
      window.removeEventListener("resize", schedule);
      main?.removeEventListener("mouseover", onOver);
      main?.removeEventListener("mouseleave", onLeave);
    };
    // groups 每次 render 都是新陣列，用內容當依賴。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  // 滑過標籤 → 畫布上那一條淡淡標亮。
  useLayoutEffect(() => {
    if (!hoverKey) return;
    const el = document.querySelector<HTMLElement>(`[data-variant-key="${hoverKey}"]`);
    el?.classList.add("exp-variant--tag-hover");
    return () => el?.classList.remove("exp-variant--tag-hover");
  }, [hoverKey]);

  // 位置還沒算好之前先藏起來，避免一開始全部疊在頂端閃一下。
  const placed = (key: string) => (boxes[key] ? { top: boxes[key].top } : { top: 0, visibility: "hidden" as const });
  const block = (id: string) => {
    const b = boxes[`block:${id}`];
    return b ? { top: b.top, height: b.height } : { visibility: "hidden" as const };
  };

  return (
    <div className="tag-rail" ref={railRef} style={{ minHeight: railHeight }}>
      {groups.map((g) => (
        <div key={g.id}>
          <div className="tag-rail-block" style={block(g.id)} />
          <p ref={ref(`head:${g.id}`)} className="tag-rail-org" style={placed(`head:${g.id}`)}>
            {g.org}
          </p>
          {g.tags.map((t) => (
            <span
              key={t.key}
              ref={ref(t.key)}
              className={`tag-rail-tag ${hoverKey === t.key ? "tag-rail-tag--hover" : ""}`}
              style={placed(t.key)}
              onMouseEnter={() => setHoverKey(t.key)}
              onMouseLeave={() => setHoverKey(null)}
            >
              {t.label}
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}
