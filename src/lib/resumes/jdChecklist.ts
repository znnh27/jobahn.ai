import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { askClaude } from "@/lib/ai/askClaude";
import { parseAiJson } from "@/lib/ai/parseAiJson";
import type { JdImportance, JdItemKind } from "./atsScore";

export type { JdItemKind } from "./atsScore";

// JD 條件清單（ATS 評分的題目）：同一份 JD 一定要拆出同一份清單，分數才比得起來。
// 以前「拆 JD」跟「判斷履歷有沒有寫到」放在同一次 AI 呼叫，而且中英文各拆一次，
// 結果同一份 JD 每次拆出來的項目數、語言都不一樣（例如一次 7 項英文、一次 8 項中文）。
// 現在拆 JD 獨立成一步，一份應徵只拆一次、各語言共用；同一位使用者貼了一字不差的 JD，直接沿用上次的清單。

// 每一項分三類（JdItemKind，定義在 atsScore.ts）：requirement＝硬實力，要有事實佐證、算履歷分數；
// trait＝軟實力、人格特質，履歷不評分、交給求職信；condition＝出差、外派這類工作條件，問使用者能不能配合。

export interface JdBaseItem {
  item: string;
  importance: JdImportance | null;
  /** 舊清單沒有這個欄位，當成 requirement。 */
  kind?: JdItemKind;
  /** 已經用三類（含軟實力）分類過。2026-10-24 以前建立的清單沒有，重新評分時會補分類一次（classifyJdItems）。 */
  kindChecked?: boolean;
}

type StoredChecklists = Record<
  string,
  Array<{ item: string; importance?: JdImportance | null; kind?: JdItemKind | null; kindChecked?: boolean | null }>
> | null;

/** 空白、換行的差異不算不同的 JD。 */
export function normalizeJd(jd: string): string {
  return jd.replace(/\s+/g, " ").trim();
}

/** JD 是中文還是英文：中日韓字元佔文字的三成以上就當中文。條件清單用 JD 的語言寫。 */
export function detectJdLanguage(jd: string): "zh" | "en" {
  const cjk = (jd.match(/[一-鿿]/g) ?? []).length;
  const latin = (jd.match(/[A-Za-z]/g) ?? []).length;
  return cjk > 0 && cjk / (cjk + latin / 5) >= 0.3 ? "zh" : "en";
}

/**
 * 不用問應徵者能不能配合的「工作條件」：只寫在哪裡上班、一般日班、「無需出差」這類否定句、待遇福利。
 * 抽取規則已經叫 AI 不要列，但 AI 每次判斷不一定一樣，程式再擋一次（2026-10-27 Z 回報：只寫了工作地點也要確認能不能配合）。
 * 有「需、須、常駐、派駐、外地、輪班、夜班、假日」這類要配合的字就保留，例如「工作地點：需常駐新竹客戶端」。
 */
export function isInfoOnlyCondition(item: string): boolean {
  const text = item.trim();
  if (/無需|不需|無須|毋須|免出差|不用出差|不必|no travel|not required|no need/i.test(text)) return true;
  if (/需|須|必須|常駐|派駐|外地|外派|出差|輪班|夜班|大夜|假日|待命|加班|require|must|travel|relocat|shift|on-call|overtime/i.test(text)) return false;
  return /^(工作|上班)(地點|地址|時段|時間)|^地點|^location|^work location|^office|日班|day shift|待遇|薪資|福利|salary|benefit/i.test(text);
}

/** 從已存的各語言清單挑一份當共用清單：優先挑跟 JD 同語言的那份，順序固定。 */
function pickStored(stored: StoredChecklists, jdLang: "zh" | "en"): JdBaseItem[] | null {
  if (!stored) return null;
  for (const lang of [jdLang, jdLang === "en" ? "zh" : "en", ...Object.keys(stored)]) {
    const list = stored[lang]?.filter((i) => !(i.kind === "condition" && isInfoOnlyCondition(i.item)));
    if (list && list.length > 0) {
      return list.map((i) => ({
        item: i.item,
        importance: i.importance ?? null,
        kind: i.kind ?? "requirement",
        kindChecked: !!i.kindChecked,
      }));
    }
  }
  return null;
}

/**
 * 這份應徵要用的 JD 條件清單（只有條件跟必要/加分，不含判斷）。
 * 1. 這份應徵已經有清單 → 沿用（重新生成、重新評分都不會變）。
 * 2. 同一位使用者有別的應徵貼了一字不差的 JD → 沿用那份。
 * 3. 都沒有才請 AI 從 JD 拆。
 */
export async function resolveJdItems(params: {
  supabase: SupabaseClient;
  userId: string;
  applicationId: string;
  jd: string;
  stored: StoredChecklists;
}): Promise<JdBaseItem[]> {
  const jdLang = detectJdLanguage(params.jd);

  const own = pickStored(params.stored, jdLang);
  if (own) return own;

  const { data: others } = await params.supabase
    .from("applications")
    .select("id, job_description, jd_match_checklist, created_at")
    .eq("user_id", params.userId)
    .neq("id", params.applicationId)
    .order("created_at", { ascending: true });
  const target = normalizeJd(params.jd);
  for (const other of others ?? []) {
    if (normalizeJd(other.job_description ?? "") !== target) continue;
    const reused = pickStored(other.jd_match_checklist, jdLang);
    if (reused) return reused;
  }

  return extractJdItems(params.supabase, params.userId, params.jd, jdLang);
}

const EXTRACT_SYSTEM_PROMPT = `你負責把 JD 拆成「應徵條件清單」，用來檢查履歷有沒有寫到每一項。同一份 JD 每次拆出來都要一樣，所以照原文列，不要自己歸納。

規則：
1. JD 有條件區段（例如 Requirements、Qualifications、What you'll need、Nice to have、Preferred、Bonus、必備條件、條件需求、加分條件）時：
   - 區段裡的一條就是一項，item 照抄原文，只去掉開頭的項目符號跟句尾標點。不改寫、不翻譯、不合併、不拆開、不自己加項目。
   - 硬性要求的區段標 "required"；Nice to have、Preferred、Bonus、加分 這類區段標 "preferred"。
   - 工作內容／職責（What you'll do、Responsibilities、工作內容）不列進來。
2. JD 完全沒有條件區段時，才從職責跟描述歸納 6 到 10 項，一項一件事，都標 "required"。
3. 上面列出來的項目，kind 依內容分：
   - "trait"：軟實力、人格特質、工作態度、價值觀，只講「是怎樣的人」、沒有具體的技能或經驗可以查證（例如主動積極、樂於挑戰、正直誠信、抗壓性高、細心負責、團隊合作、良好溝通能力、學習能力強）。
   - "requirement"：其他全部，包含經歷年資、技能工具、學歷科系、語言能力、證照，以及「用某種能力做某件具體的事」（例如「能以英文獨立進行商務會議與簡報」是語言能力，算 requirement）。一條裡同時有硬實力跟軟實力時，算 requirement。
4. 另外掃過整份 JD（包含工作內容、職責、福利、其他說明），把「需要應徵者額外配合」的工作條件各列一項，kind 標 "condition"，不是能力或經驗：
   - 要列：需要出差（國內／國外，有寫地點就保留）、外派、輪班、夜班或假日班、假日或夜間待命、常態加班、須常駐客戶端或派駐外地、需要立即到職或限期到職。
   - 不列：工作地點（只寫在哪裡上班）、一般日班的上班時段、「無需出差」「不用外派」這類不用配合的否定句、可以遠端的說明、休假制度、可上班日寫「不限」。這些是職缺資訊，不用問應徵者能不能配合。
   - item 照 JD 原文擷取那一句的重點（例如 JD 寫「需不定期出差至○○拜訪客戶」就列「需不定期出差至○○」），不改寫意思；JD 沒寫的工作條件不要列。
   - JD 寫「必須、需要、能配合」標 "required"；寫「有機會、可能、加分」標 "preferred"。
   - 已經在第 1 點的條件區段列過的同一件事，不要重複列，把那一項的 kind 改成 "condition" 就好。
   - 薪資、福利、公司介紹不算工作條件。
5. item 一律用指定的語言寫。

只輸出 JSON，不要其他文字、不要 markdown code fence：
{ "items": [{ "item": string, "importance": "required" | "preferred", "kind": "requirement" | "trait" | "condition" }] }`;

async function extractJdItems(
  supabase: SupabaseClient,
  userId: string,
  jd: string,
  jdLang: "zh" | "en",
): Promise<JdBaseItem[]> {
  const response = await askClaude({
    userId,
    feature: "jd_extract",
    systemPrompt: EXTRACT_SYSTEM_PROMPT,
    userPrompt: `item 用${jdLang === "zh" ? "繁體中文" : "英文"}寫。\n\n===== JD =====\n${jd}`,
    maxTokens: 3000,
    temperature: 0,
    supabase,
  });

  const cleaned = response.text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "");
  let parsed: { items?: Array<{ item?: unknown; importance?: unknown; kind?: unknown }> };
  try {
    parsed = parseAiJson(cleaned, "jdChecklist");
  } catch {
    throw new Error("AI 拆解 JD 條件時回傳的內容不是有效的 JSON");
  }

  const seen = new Set<string>();
  const items: JdBaseItem[] = [];
  for (const raw of parsed.items ?? []) {
    const item = String(raw.item ?? "").trim().replace(/^[-•*·\s]+/, "").replace(/[.。;；]+$/, "");
    if (!item || seen.has(item)) continue;
    if (raw.kind === "condition" && isInfoOnlyCondition(item)) continue;
    seen.add(item);
    items.push({
      item,
      importance: raw.importance === "preferred" ? "preferred" : "required",
      kind: raw.kind === "condition" || raw.kind === "trait" ? raw.kind : "requirement",
      kindChecked: true,
    });
  }
  if (items.length === 0) throw new Error("AI 沒有從 JD 拆出任何條件，請確認 JD 內容");
  return items;
}

const CLASSIFY_SYSTEM_PROMPT = `你負責把 JD 條件分類。每一條判斷是不是「軟實力」：

- "trait"：軟實力、人格特質、工作態度、價值觀，只講「是怎樣的人」、沒有具體的技能或經驗可以查證（例如主動積極、樂於挑戰既有框架、正直誠信、抗壓性高、細心負責、團隊合作、良好溝通能力、學習能力強）。
- "requirement"：其他全部，包含經歷年資、技能工具、學歷科系、語言能力（例如「英文 聽/精通、說/精通」「能以英文獨立進行商務會議」）、證照。一條裡同時有硬實力跟軟實力時，算 requirement。

條件文字照抄，每一條都要分類。只輸出 JSON，不要其他文字、不要 markdown code fence：
{ "items": [{ "item": string, "kind": "requirement" | "trait" }] }`;

/**
 * 2026-10-24 以前建立的清單沒有分出軟實力（kindChecked 是空的）：補分類一次，一份應徵只多一次 AI 呼叫。
 * 工作條件（condition）已經分好、使用者也可能回答過，不動；其他項目由 AI 判斷是硬實力還是軟實力。
 * 各語言的清單一起分（條件文字一樣的只問一次）。回傳分類後的清單，跟有沒有真的補分類。
 */
export async function classifyJdItems<T extends { item: string; kind?: JdItemKind | null; kindChecked?: boolean | null }>(params: {
  supabase: SupabaseClient;
  userId: string;
  checklists: Record<string, T[]>;
}): Promise<{ checklists: Record<string, T[]>; classified: boolean }> {
  const all = Object.values(params.checklists).flat();
  if (all.length === 0 || all.every((i) => i.kindChecked)) return { checklists: params.checklists, classified: false };

  const pending = [...new Set(all.filter((i) => !i.kindChecked && i.kind !== "condition").map((i) => i.item.trim()))];
  const kinds = new Map<string, JdItemKind>();
  if (pending.length > 0) {
    const response = await askClaude({
      userId: params.userId,
      feature: "jd_classify",
      systemPrompt: CLASSIFY_SYSTEM_PROMPT,
      userPrompt: JSON.stringify(pending.map((item) => ({ item })), null, 2),
      maxTokens: 2000,
      temperature: 0,
      supabase: params.supabase,
    });
    try {
      const parsed = parseAiJson(response.text, "jdChecklist") as {
        items?: { item?: string; kind?: string }[];
      };
      for (const r of parsed.items ?? []) {
        if (typeof r.item === "string") kinds.set(r.item.trim(), r.kind === "trait" ? "trait" : "requirement");
      }
    } catch {
      // 分類失敗就先維持原樣、不標記已分類，下次重新評分再試一次。
      return { checklists: params.checklists, classified: false };
    }
  }

  const checklists = Object.fromEntries(
    Object.entries(params.checklists).map(([lang, items]) => [
      lang,
      items.map((i) =>
        i.kindChecked
          ? i
          : { ...i, kind: i.kind === "condition" ? "condition" : (kinds.get(i.item.trim()) ?? "requirement"), kindChecked: true },
      ),
    ]),
  ) as Record<string, T[]>;
  return { checklists, classified: true };
}

