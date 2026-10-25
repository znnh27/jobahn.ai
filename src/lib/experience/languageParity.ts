import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { askClaude } from "@/lib/ai/askClaude";
import { toTraditional } from "@/lib/text/toTraditional";
import { toFullWidthPunctuation } from "@/lib/text/fullWidthPunctuation";
import { addCjkSpacing } from "@/lib/text/cjkSpacing";

// 使用者要求：中文版跟英文版的經歷資料庫任何時候都要對得上。上傳履歷是兩個語言分開解析的，
// 只出現在英文履歷裡的經歷，中文資料庫就不會有（反過來也一樣），生成中文履歷時就用不到。
// 這裡比對兩邊，缺的整段經歷或缺的成就翻成另一個語言補上。
//
// 配對方式：兩個語言的期間寫法是統一的（Nov. 2024 – May. 2026），先用「類型＋期間」配對同一段經歷；
// 配不到的、或配到了但成就件數不一樣的，一次交給 AI 判斷要補什麼。
// AI 判斷過「不用補」的狀態會記下來（profile_data.data.language_parity），同樣的狀態下次不再問。

type Lang = "zh" | "en";

interface EntryRow {
  id: string;
  language: string;
  entry_type: string;
  org_name: string;
  location: string | null;
  role_variants: unknown;
  period_variants: unknown;
  achievements: unknown;
}

interface Variant {
  text: string;
  angleLabel?: string;
  source?: string;
}

interface Achievement {
  id: string;
  variants: Variant[];
}

const SYSTEM_PROMPT = `你是履歷雙語同步助手。使用者的經歷資料庫分成中文版和英文版，兩邊的內容要對得上。下面列出兩邊對不上的地方，請判斷要補什麼，並把要補的內容翻成另一個語言。

規則：
1. 不是逐字翻譯，用目標語言的履歷寫法重新表達同一件事，維持動詞開頭＋具體任務＋量化成果。數字、事實、參與程度都不能變，不能加原本沒有的內容。
2. 公司名用官方的中文／英文名稱（例如「台積電」↔「TSMC」）；不確定官方名稱就保留原文，不要自己編。職稱用目標語言常見的說法，地點轉成目標語言的寫法（Taipei ↔ 台北）。期間照原文的格式抄（例如 Nov. 2024 – May. 2026），兩個語言都用這個格式。
3. 「沒配對的經歷」：先看另一個語言「沒配對的經歷」裡有沒有其實是同一段的（同一家公司、同一個職位，期間寫法可能不同）。有的話放進 same_entries，不要重複新增；真的沒有才放進 new_entries。
4. 「件數不一樣的經歷」（包含你在 same_entries 配起來的）：逐件比對兩邊的成就，看意思不看字面。某一邊有、另一邊沒有對應的，翻好放進 add_achievements；兩邊其實都有（只是拆法或寫法不同）就不用補。
5. 中文一律用繁體、台灣用語、全形標點；中文字跟英文、數字之間加一個半形空格。工具、產品名、專有名詞（Figma、SQL、A/B 測試、KPI）保留英文，其他一般英文單字一律翻成中文，中文句子裡不要夾英文（例如 review → 審查、onboarding → 到職訓練）。
6. 只輸出 JSON，不要其他文字、不要用 markdown code fence 包起來：
{
  "same_entries": [{ "ref": string, "other_ref": string }],
  "new_entries": [{ "ref": string, "org_name": string, "location": string | null, "role": string, "period": string, "achievements": [{ "from": string, "text": string, "angle_label": string }] }],
  "add_achievements": [{ "target_ref": string, "achievements": [{ "from": string, "text": string, "angle_label": string }] }]
}
ref／other_ref／target_ref 用輸入裡的編號（例如 "e3"）。new_entries 的 ref 是「原本那段」的編號，會新增到另一個語言。add_achievements 的 target_ref 是「要補進去的那一段」的編號。achievements 的 from 是原文那件成就的編號（例如 "e3.a2"）。`;

export interface ParityResult {
  entriesAdded: number;
  achievementsAdded: number;
}

/**
 * 比對中英文經歷資料庫，缺的補上。targets 是要補齊的語言：
 * - 上傳履歷後：另一個語言已經有資料才補（只用英文的人不用每次上傳都翻一份中文）。
 * - 生成履歷前：要生成哪個語言就補哪個語言。
 * 兩邊一致時不呼叫 AI；AI 失敗時不擋原本的流程，回傳 0。
 */
export async function ensureLanguageParity(params: {
  supabase: SupabaseClient;
  userId: string;
  targets: Lang[];
  /** 上傳後用：兩個語言都已經有資料才補（只用一個語言的人不用每次上傳都翻一份）。 */
  onlyIfBothLanguages?: boolean;
}): Promise<ParityResult> {
  const { supabase, userId } = params;
  const none = { entriesAdded: 0, achievementsAdded: 0 };

  const { data: rows } = await supabase
    .from("experience_entries")
    .select("id, language, entry_type, org_name, location, role_variants, period_variants, achievements")
    .eq("user_id", userId);
  const entries = ((rows ?? []) as EntryRow[]).filter((e) => e.language === "zh" || e.language === "en");
  const byLang = (l: Lang) => entries.filter((e) => e.language === l);
  // 另一個語言完全沒資料：沒有東西可以對照。上傳後的檢查連 target 自己也要有資料才補。
  const targets = params.targets.filter(
    (t) => byLang(other(t)).length > 0 && (!params.onlyIfBothLanguages || byLang(t).length > 0),
  );
  if (targets.length === 0) return none;

  // 用「類型＋期間」配對。
  const pairs: [EntryRow, EntryRow][] = [];
  const unpaired = new Set(entries.map((e) => e.id));
  for (const en of byLang("en")) {
    const enPeriods = new Set(periodsOf(en).map(normPeriod));
    const zh = byLang("zh").find(
      (z) => unpaired.has(z.id) && z.entry_type === en.entry_type && periodsOf(z).some((p) => enPeriods.has(normPeriod(p))),
    );
    if (!zh) continue;
    pairs.push([en, zh]);
    unpaired.delete(en.id);
    unpaired.delete(zh.id);
  }
  const mismatched = pairs.filter(([en, zh]) => achievementsOf(en).length !== achievementsOf(zh).length);
  const lonely = entries.filter((e) => unpaired.has(e.id));
  // 只處理會補進 targets 的部分：缺的那一邊是 target 才算。
  const relevantLonely = lonely.filter((e) => targets.includes(other(e.language as Lang)));
  const relevantMismatch = mismatched.filter(([en, zh]) => {
    const fewer = achievementsOf(en).length < achievementsOf(zh).length ? "en" : "zh";
    return targets.includes(fewer);
  });
  if (relevantLonely.length === 0 && relevantMismatch.length === 0) return none;

  // 同樣的狀態 AI 已經看過、判斷不用補，就不再問。
  const signature = paritySignature(entries);
  const { data: profile } = await supabase.from("profile_data").select("data").eq("user_id", userId).maybeSingle();
  const profileData = (profile?.data ?? {}) as Record<string, unknown>;
  if (profileData.language_parity === signature) return none;

  const refOf = new Map<string, string>();
  const byRef = new Map<string, EntryRow>();
  entries.forEach((e, i) => {
    refOf.set(e.id, `e${i + 1}`);
    byRef.set(`e${i + 1}`, e);
  });
  const describe = (e: EntryRow) => ({
    ref: refOf.get(e.id),
    language: e.language,
    entry_type: e.entry_type,
    org_name: e.org_name,
    location: e.location,
    roles: rolesOf(e),
    periods: periodsOf(e),
    achievements: achievementsOf(e).map((a, j) => ({ ref: `${refOf.get(e.id)}.a${j + 1}`, text: a.variants[0]?.text ?? "" })),
  });

  const response = await askClaude({
    userId,
    feature: "experience_language_parity",
    systemPrompt: SYSTEM_PROMPT,
    userPrompt: [
      `===== 沒配對的經歷（另一個語言找不到同類型、同期間的經歷）=====`,
      JSON.stringify(lonely.map(describe), null, 2),
      `===== 件數不一樣的經歷（兩邊都有這段，但成就件數不同）=====`,
      JSON.stringify(
        mismatched.map(([en, zh]) => ({ en: describe(en), zh: describe(zh) })),
        null,
        2,
      ),
      `只需要補進這些語言：${targets.map((t) => (t === "zh" ? "中文" : "英文")).join("、")}；缺的那一邊不是這些語言的就不用補。`,
    ].join("\n\n"),
    maxTokens: 16000,
    supabase,
  });

  let plan: {
    same_entries?: { ref: string; other_ref: string }[];
    new_entries?: {
      ref: string;
      org_name: string;
      location: string | null;
      role: string;
      period: string;
      achievements: { from: string; text: string; angle_label: string }[];
    }[];
    add_achievements?: { target_ref: string; achievements: { from: string; text: string; angle_label: string }[] }[];
  };
  try {
    plan = JSON.parse(
      response.text
        .trim()
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/```\s*$/i, ""),
    );
  } catch {
    return none;
  }

  const sourceOf = (fromRef: string, fallback: EntryRow) => {
    const [entryRef, achRef] = fromRef.split(".a");
    const e = byRef.get(entryRef) ?? fallback;
    const a = achievementsOf(e)[Number(achRef) - 1];
    return a?.variants[0]?.source ?? firstSource(e);
  };
  const polish = (lang: Lang, text: string) =>
    lang === "zh" ? addCjkSpacing(toFullWidthPunctuation(toTraditional(text))) : text;
  const result = { ...none };

  for (const n of plan.new_entries ?? []) {
    const src = byRef.get(n.ref);
    if (!src) continue;
    const lang = other(src.language as Lang);
    if (!targets.includes(lang)) continue;
    const achievements: Achievement[] = (n.achievements ?? [])
      .filter((a) => a.text?.trim())
      .map((a) => ({
        id: newAchievementId(),
        variants: [{ text: polish(lang, a.text), angleLabel: a.angle_label ?? "", source: sourceOf(a.from, src) }],
      }));
    const { error } = await supabase.from("experience_entries").insert({
      user_id: userId,
      language: lang,
      entry_type: src.entry_type,
      org_name: lang === "zh" ? toTraditional(n.org_name) : n.org_name,
      location: lang === "zh" ? toTraditional(n.location) : n.location,
      role_variants: [{ role: lang === "zh" ? toTraditional(n.role) : n.role, source: [firstSource(src)] }],
      period_variants: [{ period: n.period || periodsOf(src)[0] || "", source: [firstSource(src)] }],
      achievements,
    });
    if (error) continue;
    result.entriesAdded += 1;
    result.achievementsAdded += achievements.length;
  }

  for (const add of plan.add_achievements ?? []) {
    const target = byRef.get(add.target_ref);
    if (!target) continue;
    const lang = target.language as Lang;
    if (!targets.includes(lang)) continue;
    const fresh = (add.achievements ?? [])
      .filter((a) => a.text?.trim())
      .map((a) => ({
        id: newAchievementId(),
        variants: [{ text: polish(lang, a.text), angleLabel: a.angle_label ?? "", source: sourceOf(a.from, target) }],
      }));
    if (fresh.length === 0) continue;
    const { error } = await supabase
      .from("experience_entries")
      .update({ achievements: [...achievementsOf(target), ...fresh], updated_at: new Date().toISOString() })
      .eq("id", target.id)
      .eq("user_id", userId);
    if (error) continue;
    result.achievementsAdded += fresh.length;
  }

  // 補完之後的狀態記下來；AI 判斷不用補的地方，下次同樣的狀態就不再問。
  if (result.entriesAdded === 0 && result.achievementsAdded === 0) {
    await supabase.from("profile_data").upsert({ user_id: userId, data: { ...profileData, language_parity: signature } });
  }
  return result;
}

function other(lang: Lang): Lang {
  return lang === "zh" ? "en" : "zh";
}

function periodsOf(e: EntryRow): string[] {
  if (!Array.isArray(e.period_variants)) return [];
  return e.period_variants
    .map((v) => (typeof v === "string" ? v : (v as { period?: unknown })?.period))
    .filter((p): p is string => typeof p === "string" && p.trim() !== "");
}

function rolesOf(e: EntryRow): string[] {
  if (!Array.isArray(e.role_variants)) return [];
  return e.role_variants
    .map((v) => (v as { role?: unknown })?.role)
    .filter((r): r is string => typeof r === "string" && r.trim() !== "");
}

function achievementsOf(e: EntryRow): Achievement[] {
  return Array.isArray(e.achievements) ? (e.achievements as Achievement[]).filter((a) => Array.isArray(a?.variants)) : [];
}

function firstSource(e: EntryRow): string {
  const fromPeriod = Array.isArray(e.period_variants)
    ? (e.period_variants as { source?: unknown }[]).flatMap((v) => (Array.isArray(v?.source) ? v.source : []))[0]
    : undefined;
  return typeof fromPeriod === "string" ? fromPeriod : "";
}

/** 期間比對時忽略空白、大小寫、各種破折號。 */
function normPeriod(p: string): string {
  return p.toLowerCase().replace(/[\s.]/g, "").replace(/[–—~～-]/g, "-");
}

/** 兩邊目前的狀態（每段經歷的語言、類型、期間、成就件數）。有任何新增、刪除，簽名就會變。 */
function paritySignature(entries: EntryRow[]): string {
  return entries
    .map((e) => `${e.language}|${e.entry_type}|${periodsOf(e).map(normPeriod).join("/")}|${achievementsOf(e).length}`)
    .sort()
    .join(";");
}

function newAchievementId(): string {
  return `ach_${Math.random().toString(36).slice(2, 10)}`;
}
