import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { askClaude } from "@/lib/ai/askClaude";
import type { JdImportance } from "./atsScore";

// JD 條件清單（ATS 評分的題目）：同一份 JD 一定要拆出同一份清單，分數才比得起來。
// 以前「拆 JD」跟「判斷履歷有沒有寫到」放在同一次 AI 呼叫，而且中英文各拆一次，
// 結果同一份 JD 每次拆出來的項目數、語言都不一樣（例如一次 7 項英文、一次 8 項中文）。
// 現在拆 JD 獨立成一步，一份應徵只拆一次、各語言共用；同一位使用者貼了一字不差的 JD，直接沿用上次的清單。

export interface JdBaseItem {
  item: string;
  importance: JdImportance | null;
}

type StoredChecklists = Record<string, Array<{ item: string; importance?: JdImportance | null }>> | null;

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

/** 從已存的各語言清單挑一份當共用清單：優先挑跟 JD 同語言的那份，順序固定。 */
function pickStored(stored: StoredChecklists, jdLang: "zh" | "en"): JdBaseItem[] | null {
  if (!stored) return null;
  for (const lang of [jdLang, jdLang === "en" ? "zh" : "en", ...Object.keys(stored)]) {
    const list = stored[lang];
    if (list && list.length > 0) {
      return list.map((i) => ({ item: i.item, importance: i.importance ?? null }));
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
3. item 一律用指定的語言寫。

只輸出 JSON，不要其他文字、不要 markdown code fence：
{ "items": [{ "item": string, "importance": "required" | "preferred" }] }`;

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
  let parsed: { items?: Array<{ item?: unknown; importance?: unknown }> };
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error("AI 拆解 JD 條件時回傳的內容不是有效的 JSON");
  }

  const seen = new Set<string>();
  const items: JdBaseItem[] = [];
  for (const raw of parsed.items ?? []) {
    const item = String(raw.item ?? "").trim().replace(/^[-•*·\s]+/, "").replace(/[.。;；]+$/, "");
    if (!item || seen.has(item)) continue;
    seen.add(item);
    items.push({ item, importance: raw.importance === "preferred" ? "preferred" : "required" });
  }
  if (items.length === 0) throw new Error("AI 沒有從 JD 拆出任何條件，請確認 JD 內容");
  return items;
}
