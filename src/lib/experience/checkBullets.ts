import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { askClaude } from "@/lib/ai/askClaude";
import { parseAiJson } from "@/lib/ai/parseAiJson";
import { toTraditional } from "@/lib/text/toTraditional";
import { BULLET_RULES, BULLET_RULE_TAGS, RULE_TAG_INSTRUCTIONS, readRuleTags, stripRuleRefs } from "./bulletRules";

// 「跟 AI 聊」寫完 bullet 之後的檢查（2026-10-29 Z 試用時拿到沒數字的流水帳：規則有給，但沒人把關）。
// 經歷資料庫的問答、JD 缺口挖掘、履歷頁的「跟 AI 聊」都呼叫這一支，標準才會一致（Z 要求全系統一致）。
// - 寫法問題（流水帳、一條塞好幾件事、弱動詞開頭…）直接換成改寫版本。
// - 缺數字光靠改寫補不了（不能編），回傳一句建議，由呼叫端顯示給使用者。

export interface BulletCheckItem {
  text: string;
  /** 使用者明確說過這件沒有數字：不標缺數字。 */
  noMetric?: boolean;
}

export interface BulletCheckResult {
  /** 檢查後的文字：有寫法問題就是改寫版本，沒有就是原文。 */
  text: string;
  rewritten: boolean;
  /** 還缺數字或成果時，建議可以補什麼；不缺就是 null。 */
  missingEvidence: string | null;
}

/** 檢查失敗回傳 null，呼叫端照原本的文字用，不擋流程。 */
export async function checkBullets(params: {
  supabase: SupabaseClient;
  userId: string;
  feature: string;
  items: BulletCheckItem[];
  /** 使用者關掉的提醒類別，這幾類不標。 */
  mutedRules?: Set<string>;
  /** 履歷頁有目標 JD（規則 6 協作過程留不留看 JD）；經歷資料庫沒有。 */
  jd?: string;
  /** 履歷頁使用者這次的指令。改寫不能違反它（例如叫 AI 拿掉數字，就不能補回去）。 */
  instruction?: string;
}): Promise<BulletCheckResult[] | null> {
  const { supabase, userId, feature, items, jd, instruction } = params;
  if (items.length === 0) return [];
  const muted = params.mutedRules ?? new Set<string>();
  const mutedNames = BULLET_RULE_TAGS.filter((t) => muted.has(t.id)).map((t) => `${t.id}（${t.name}）`);

  const systemPrompt = `你是履歷內容品質檢查助手。使用者會給你一批剛寫好的 bullet（每條有編號），照下面的規則逐條檢查。${jd ? "規則 6 的「依目標 JD 決定留不留」：目標 JD 附在最後。" : "這是經歷資料庫，還沒有目標 JD。"}

${BULLET_RULES}

另外也要抓錯字、漏字、重複字。

${RULE_TAG_INSTRUCTIONS}
${mutedNames.length > 0 ? `\n使用者已經關掉這幾類提醒，這幾類的問題不用標記：${mutedNames.join("、")}。\n` : ""}${
    instruction
      ? `\n這批 bullet 是照使用者這個指令改的：「${instruction}」。指令優先於規則：照指令做出來的結果不算違規（例如使用者要求拿掉數字，就不標缺數字、rewrite 也不能把數字補回去；要求縮短，rewrite 就不能變長）。\n`
      : ""
  }
全部符合就是通過，不用列出來；有任何一條不符合就要列出：
- rewrite：照規則改好的版本，語言跟原文相同，中文一律繁體。只能用原文裡已經有的事實跟數字，不能編造；只有缺數字的話給 null。
- evidenceHint：rules 有 evidence 時，用繁體中文一句話建議可以補哪種數字或替代證據（例如「改之前的報名人數是多少？」「做完之後有沒有其他團隊開始用？」），不要提規則編號；沒有 evidence 就給 null。

只輸出 JSON，不要其他文字：
{ "flags": [{ "index": number, "rules": string[], "rewrite": string | null, "evidenceHint": string | null }] }`;

  try {
    const response = await askClaude({
      userId,
      feature,
      systemPrompt,
      userPrompt: [items.map((d, i) => `[${i}] ${d.text}`).join("\n"), jd ? `===== 目標 JD =====\n${jd}` : ""]
        .filter(Boolean)
        .join("\n\n"),
      maxTokens: 3000,
      temperature: 0,
      supabase,
    });
    const cleaned = response.text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "");
    const parsed = parseAiJson(cleaned, "checkBullets") as {
      flags?: { index: number; rules?: unknown; rewrite?: string | null; evidenceHint?: string | null }[];
    };
    const byIndex = new Map((parsed.flags ?? []).map((f) => [f.index, f]));

    return items.map((d, i) => {
      const f = byIndex.get(i);
      const rules = f ? readRuleTags(f.rules).filter((r) => !muted.has(r)) : [];
      const missing = rules.includes("evidence") && !d.noMetric;
      const fixable = rules.some((r) => r !== "evidence");
      const rewrite = fixable && f?.rewrite?.trim() ? toTraditional(f.rewrite.trim()) : null;
      return {
        text: rewrite ?? d.text,
        rewritten: rewrite !== null && rewrite !== d.text,
        missingEvidence: missing
          ? stripRuleRefs(toTraditional(f?.evidenceHint?.trim() || "補上數字或具體成果會更有說服力。"))
          : null,
      };
    });
  } catch {
    return null;
  }
}
