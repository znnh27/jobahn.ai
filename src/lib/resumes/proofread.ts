import "server-only";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { askClaude } from "@/lib/ai/askClaude";
import { loadMemory } from "@/lib/ai/userMemory";
import { addCjkSpacing } from "@/lib/text/cjkSpacing";
import { toFullWidthPunctuation } from "@/lib/text/fullWidthPunctuation";
import { toTraditional } from "@/lib/text/toTraditional";
import { parseJsonResponse, type GeneratedResume } from "./generateResume";
import { maskSignature } from "./generateCoverLetter";
import { readContact } from "./contact";
import { resumeFields, type ProofreadCategory, type ProofreadIssue } from "./proofreadTypes";

// 「校稿」：履歷頁、求職信頁的按鈕（2026-10-28 Z 要求）。只給建議，使用者一項一項按「套用」才會改。
// - 格式（中文的全形標點、中英文之間的空格）用程式檢查，結果穩定，也不用花 AI 的時間。
// - 錯字文法、事實、前後不一交給 AI（AI 腔 2026-10-28 拿掉：主觀、每次挑的不一樣，交給生成時的規則）；事實拿經歷資料庫跟「AI 記住的事」（askClaude 自動帶）對照。
// AI 抄的原文在內容裡找不到就丟掉（不能套用、也可能是它自己編的）。

type Resume = GeneratedResume["resume"];

const CATEGORIES: ProofreadCategory[] = ["typo", "format", "fact", "consistency"];
const MAX_ISSUES = 30;

const SYSTEM_PROMPT = `你是求職文件的校稿助手。逐句檢查使用者的履歷或求職信，找出需要修改的地方。只挑真的有問題的，沒問題就回空陣列，不要為了湊數硬挑，也不要挑只是「可以寫得更好」的句子。

檢查項目（category）：
- typo：錯字、別字、簡體字、簡繁誤轉（例如「而不是隻完成」應為「只完成」、「幹擾」應為「干擾」）、的／得／地誤用、漏字、多字、語句不通。英文：拼字、文法、單複數、冠詞、專有名詞大小寫（iOS、LinkedIn）、同一段經歷裡時態不一致（已經結束的經歷用過去式）。
- fact：跟經歷資料庫的事實對不上：數字、比例、對象、因果被改掉（例如資料庫寫「額外創造約 17% 專案營收」，內容寫成「加碼開發預算 17%」）；資料庫裡找不到的成就、職稱、年資；違反「使用者要求 AI 記住的事」（例如已經離職卻寫成目前任職、年資寫錯）。
  經歷資料庫裡同一件事有好幾個版本時，以來源不是「AI 潤飾」的版本為準；AI 潤飾版本的數字、對象跟其他版本對不上時，以其他版本為準。
- consistency：同一件事前後寫法不一（例如摘要跟 bullet 的數字不同、公司名稱寫法不一）；求職信裡的公司名稱、應徵職稱跟 JD 對不上。

不用檢查：全形半形標點、中文跟英文數字之間的空格（系統另外檢查）；文筆、語氣、句子好不好讀（AI 腔這類寫法問題交給生成時的規則，校稿不挑）；版面、長度；跟 JD 的符合度。

輸出規則：
- quote：從原文一字不差抄出有問題的那一段，系統會拿它去原文裡找、直接換掉。抄最短但看得懂的一段（通常是一個詞組或一句），不要整段。
- replacement：換掉 quote 的文字，只改有問題的地方，其他字照抄；整段要刪掉就給空字串。typo、consistency 一定要給改好的寫法，不能只指出問題；fact 類改回經歷資料庫的說法。只有要使用者自己補資料才改得了的（例如資料庫裡找不到這個數字），才給 null。
- reason：一句話說哪裡有問題，用繁體中文，不要提規則編號。
- 同一個問題只列一次，依原文出現的順序排。
- 只輸出 JSON，不要有其他文字、不要用 markdown code fence 包起來。`;

interface RawIssue {
  field?: unknown;
  category?: unknown;
  quote?: unknown;
  replacement?: unknown;
  reason?: unknown;
}

interface Segment {
  /** 履歷是格子的 id，求職信是 null。 */
  field: string | null;
  where: string | null;
  text: string;
}

/** 中文句子的全形標點、中英文之間的空格：一句一項，原文跟改好的都顯示整句。 */
function formatIssues(segments: Segment[]): ProofreadIssue[] {
  const issues: ProofreadIssue[] = [];
  for (const seg of segments) {
    for (const raw of seg.text.split(/(?<=[。！？；\n])/)) {
      const sentence = raw.trim();
      if (!sentence) continue;
      const punctuated = toFullWidthPunctuation(sentence);
      const fixed = addCjkSpacing(punctuated);
      if (fixed === sentence) continue;
      const reasons = [
        punctuated !== sentence && "中文句子要用全形標點",
        fixed !== punctuated && "中文跟英文、數字之間要空一格",
      ].filter(Boolean);
      issues.push({
        id: crypto.randomUUID(),
        category: "format",
        field: seg.field,
        where: seg.where,
        quote: sentence,
        replacement: fixed,
        reason: `${reasons.join("；")}。`,
      });
    }
  }
  return issues;
}

/** 經歷資料庫整理成 AI 看得懂的清單，每個版本標出來源（AI 潤飾的版本不能當事實依據）。 */
function formatEntries(rows: Array<Record<string, unknown>>): string {
  // 職稱存成 { role }、期間存成 { period }（見 experience_entries）。以前只讀 text，職稱、期間整個是空的，
  // AI 就把每一段的職稱都判成「資料庫找不到」（2026-10-28）。
  const texts = (value: unknown, key: "role" | "period"): string[] =>
    Array.isArray(value)
      ? value
          .map((v) => (typeof v === "string" ? v : typeof v?.[key] === "string" ? v[key] : typeof v?.text === "string" ? v.text : ""))
          .filter(Boolean)
      : [];
  return rows
    .map((row) => {
      const achievements = Array.isArray(row.achievements) ? row.achievements : [];
      const lines = achievements.flatMap((a: { variants?: Array<{ text?: string; source?: string }> }, i: number) =>
        (a.variants ?? [])
          .filter((v) => typeof v.text === "string" && v.text.trim())
          .map((v) => `  - 第 ${i + 1} 件（來源：${v.source ?? "未標示"}）：${v.text}`),
      );
      return [
        `【${row.entry_type === "work" ? "正式工作" : "社團、專案"}】${row.org_name}｜${texts(row.role_variants, "role").join(" / ")}｜${texts(row.period_variants, "period").join(" / ")}`,
        ...lines,
      ].join("\n");
    })
    .join("\n\n");
}

function formatBackground(background: Pick<Resume, "languages" | "education">): string {
  return [
    `語言：${(background.languages ?? []).join("、") || "（無）"}`,
    ...(background.education ?? []).map((e) => `學歷：${e.school}｜${e.detail ?? ""}｜${e.period}`),
  ].join("\n");
}

async function loadEntries(supabase: SupabaseClient, userId: string, language: string): Promise<string> {
  const { data } = await supabase
    .from("experience_entries")
    .select("language, entry_type, org_name, role_variants, period_variants, achievements")
    .eq("user_id", userId);
  const rows = (data ?? []) as Array<{ language: string } & Record<string, unknown>>;
  const own = rows.filter((r) => r.language === language);
  return formatEntries(own.length > 0 ? own : rows);
}

/** AI 回傳的項目：類別、原文對得上才留，replacement 跟中文輸出一樣整理過（繁體、全形標點、中英空格）。 */
function cleanAiIssues(raw: RawIssue[], segments: Segment[], language: string): ProofreadIssue[] {
  const issues: ProofreadIssue[] = [];
  for (const r of raw) {
    const category = CATEGORIES.includes(r.category as ProofreadCategory) ? (r.category as ProofreadCategory) : null;
    const quote = typeof r.quote === "string" ? r.quote.trim() : "";
    if (!category || !quote) continue;
    const seg =
      segments.find((s) => s.field === (typeof r.field === "string" ? r.field : null) && s.text.includes(quote)) ??
      segments.find((s) => s.text.includes(quote));
    if (!seg) continue;
    let replacement = typeof r.replacement === "string" ? r.replacement.trim() : null;
    if (replacement && language === "zh") replacement = addCjkSpacing(toFullWidthPunctuation(toTraditional(replacement)));
    if (replacement === quote) continue;
    const reason = typeof r.reason === "string" ? toTraditional(r.reason.trim()) : "";
    issues.push({ id: crypto.randomUUID(), category, field: seg.field, where: seg.where, quote, replacement, reason });
  }
  return issues;
}

/** 依原文出現的順序排：先照格子的順序，同一格裡照位置。 */
function sortByPosition(issues: ProofreadIssue[], segments: Segment[]): ProofreadIssue[] {
  const order = (i: ProofreadIssue) => {
    const s = segments.findIndex((seg) => seg.field === i.field && seg.text.includes(i.quote));
    return s * 100000 + (s >= 0 ? segments[s].text.indexOf(i.quote) : 0);
  };
  return [...issues].sort((a, b) => order(a) - order(b));
}

// ===== 校稿紀錄（applications.proofread，見 migration 0011）=====
// 同一份內容每次校稿結果要一樣、處理過的不要再出現（2026-10-28 Z 問「這樣要重複校稿幾遍？」）：
// - checked：每一格（履歷的摘要、bullet，求職信的段落）上次檢查時的文字 → 那一格的建議。文字沒變就沿用，不再問 AI；
//   只有改過、或新的格子才送去檢查。AI 每次挑的不完全一樣（local-cli 模式關不掉隨機性），這樣沒改的地方就不會換一批建議。
// - dismissed：按過「略過」「知道了」的建議（類別＋原文），之後檢查到一樣的就不列。
// - basis：經歷資料庫、JD、語言學歷、AI 記住的事的指紋。這些變了，事實要重新對，checked 全部作廢（dismissed 保留）。
// 沒跑 migration（欄位不存在）時照樣校稿，只是不記。

type ProofreadKind = "resume" | "letter";

interface LangState {
  basis: string;
  checked: Record<string, ProofreadIssue[]>;
  dismissed: string[];
}

type ProofreadStore = Partial<Record<ProofreadKind, Record<string, LangState>>>;

const MAX_DISMISSED = 500;

const signature = (i: Pick<ProofreadIssue, "category" | "quote">) => `${i.category}|${i.quote}`;

/** 讀校稿紀錄；欄位不存在（還沒跑 migration）回 null。 */
async function loadStore(supabase: SupabaseClient, userId: string, applicationId: string): Promise<ProofreadStore | null> {
  const { data, error } = await supabase
    .from("applications")
    .select("proofread")
    .eq("id", applicationId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) return null;
  return (data?.proofread ?? {}) as ProofreadStore;
}

async function saveLangState(
  supabase: SupabaseClient,
  userId: string,
  applicationId: string,
  kind: ProofreadKind,
  language: string,
  update: (prev: LangState | null) => LangState,
): Promise<void> {
  const store = await loadStore(supabase, userId, applicationId);
  if (!store) return;
  const next: ProofreadStore = { ...store, [kind]: { ...(store[kind] ?? {}), [language]: update(store[kind]?.[language] ?? null) } };
  await supabase.from("applications").update({ proofread: next }).eq("id", applicationId).eq("user_id", userId);
}

async function runProofread(params: {
  supabase: SupabaseClient;
  userId: string;
  applicationId: string;
  language: string;
  feature: string;
  kind: ProofreadKind;
  segments: Segment[];
  /** 給 AI 看的全文；toCheck 是這次要檢查的格子（其他格子只當參考）。 */
  content: (toCheck: Set<string>) => string;
  /** 履歷的語言、學歷：照使用者資料一字不改放的，不在經歷資料庫裡，也是事實依據（沒給的話，AI 會說「資料庫沒有德文能力」）。 */
  background: Pick<Resume, "languages" | "education"> | null;
}): Promise<ProofreadIssue[]> {
  const { supabase, userId, applicationId, language, feature, kind, segments, content, background } = params;
  const { data: application } = await supabase
    .from("applications")
    .select("company_name, job_title, job_description")
    .eq("id", applicationId)
    .eq("user_id", userId)
    .single();
  if (!application) throw new Error("找不到這筆應徵紀錄");

  const entries = await loadEntries(supabase, userId, language);
  const factsBlock = [
    `===== 應徵的公司跟職稱 =====\n${application.company_name ?? "（未填）"}｜${application.job_title ?? "（未填）"}`,
    `===== JD =====\n${application.job_description ?? "（沒有 JD）"}`,
    `===== 經歷資料庫（事實的依據）=====\n${entries || "（沒有資料）"}`,
    background ? `===== 使用者的語言能力、學歷（也是事實的依據）=====\n${formatBackground(background)}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
  const memory = (await loadMemory(supabase, userId)).map((n) => n.text).join("\n");
  const basis = createHash("sha256").update(`${factsBlock}\n${memory}`).digest("hex");

  const store = await loadStore(supabase, userId, applicationId);
  const prev = store?.[kind]?.[language] ?? null;
  const cache = prev && prev.basis === basis ? prev.checked : {};
  const dismissed = new Set(prev?.dismissed ?? []);

  // 文字沒變的格子沿用上次的結果，只檢查改過、或新的格子。
  const toCheck = new Set(segments.filter((seg) => !(seg.text in cache)).map((seg) => seg.text));
  const fresh: ProofreadIssue[] = [];
  if (toCheck.size > 0) {
    const partial = toCheck.size < segments.length;
    const response = await askClaude({
      userId,
      feature,
      systemPrompt: SYSTEM_PROMPT,
      userPrompt: [
        `目標語言：${language === "zh" ? "繁體中文（台灣用語）" : "English"}`,
        factsBlock,
        content(toCheck),
        partial
          ? kind === "resume"
            ? "只檢查開頭有 ★ 的格子；沒有 ★ 的已經檢查過，只當前後對照的參考，不要列它們的問題。"
            : "只檢查「這次要檢查的段落」；其他段落已經檢查過，只當前後對照的參考，不要列它們的問題。"
          : "",
        kind === "resume"
          ? `輸出格式：{ "issues": [{ "field": string, "category": string, "quote": string, "replacement": string | null, "reason": string }] }`
          : `輸出格式：{ "issues": [{ "category": string, "quote": string, "replacement": string | null, "reason": string }] }`,
      ]
        .filter(Boolean)
        .join("\n\n"),
      maxTokens: 6000,
      temperature: 0,
      effort: "medium",
      supabase,
    });
    const parsed = parseJsonResponse<{ issues?: RawIssue[] }>(response.text);
    const checkedSegments = segments.filter((seg) => toCheck.has(seg.text));
    // 格式問題程式查得到，AI 給的格式項目不要，避免同一句出現兩次。
    fresh.push(
      ...cleanAiIssues(Array.isArray(parsed.issues) ? parsed.issues : [], checkedSegments, language).filter(
        (i) => i.category !== "format",
      ),
    );
  }

  // 這次的結果：沒改過的格子用紀錄裡的（位置、格子代號照現在的重新標），改過的用這次檢查的。
  const checked: Record<string, ProofreadIssue[]> = {};
  const aiIssues: ProofreadIssue[] = [];
  for (const seg of segments) {
    const issues = toCheck.has(seg.text)
      ? fresh.filter((i) => i.field === seg.field && seg.text.includes(i.quote))
      : (cache[seg.text] ?? []).map((i) => ({ ...i, field: seg.field, where: seg.where }));
    checked[seg.text] = issues;
    aiIssues.push(...issues);
  }
  if (store) {
    await saveLangState(supabase, userId, applicationId, kind, language, (p) => ({
      basis,
      checked,
      dismissed: p?.dismissed ?? [],
    }));
  }

  const format = language === "zh" ? formatIssues(segments) : [];
  const issues = [...format, ...aiIssues].filter((i) => !dismissed.has(signature(i)));
  return sortByPosition(issues, segments).slice(0, MAX_ISSUES);
}

/** 按「略過」「知道了」：記下來，之後校稿不再列；也從紀錄裡拿掉，畫面重新整理後不會又出現。 */
export async function dismissProofreadIssues(params: {
  supabase: SupabaseClient;
  userId: string;
  applicationId: string;
  kind: ProofreadKind;
  language: string;
  issues: Array<Pick<ProofreadIssue, "category" | "quote">>;
}): Promise<void> {
  const { supabase, userId, applicationId, kind, language, issues } = params;
  const sigs = new Set(issues.map(signature));
  await saveLangState(supabase, userId, applicationId, kind, language, (p) => ({
    basis: p?.basis ?? "",
    checked: Object.fromEntries(
      Object.entries(p?.checked ?? {}).map(([text, list]) => [text, list.filter((i) => !sigs.has(signature(i)))]),
    ),
    dismissed: [...new Set([...(p?.dismissed ?? []), ...sigs])].slice(-MAX_DISMISSED),
  }));
}

export async function proofreadResume(params: {
  supabase: SupabaseClient;
  userId: string;
  applicationId: string;
  language: string;
  resume: Resume;
}): Promise<ProofreadIssue[]> {
  const fields = resumeFields(params.resume);
  const segments: Segment[] = fields.map((f) => ({ field: f.id, where: f.label, text: f.text }));
  return runProofread({
    ...params,
    feature: "resume_proofread",
    kind: "resume",
    background: params.resume,
    segments,
    content: (toCheck) =>
      `===== 要校稿的履歷（每一行開頭的 [ ] 是格子代號，輸出時放進 field；★ 只是標記，不是原文）=====\n${fields
        .map((f) => `${toCheck.has(f.text) ? "★" : ""}[${f.id}]（${f.label}）${f.text}`)
        .join("\n")}`,
  });
}

export async function proofreadLetter(params: {
  supabase: SupabaseClient;
  userId: string;
  applicationId: string;
  language: string;
  letter: string;
}): Promise<ProofreadIssue[]> {
  const { supabase, userId, applicationId, language, letter } = params;
  // 署名（名字＋聯絡方式）是程式放的，不校：「電話: +886…」不是中文句子，不能被改成全形。
  const { data: profile } = await supabase.from("profile_data").select("data").eq("user_id", userId).maybeSingle();
  const { body } = maskSignature(letter, readContact(profile?.data), language);
  // 一段一格：改了哪一段，下次只重新檢查那一段。
  const segments: Segment[] = body
    .replace("{{SIGNATURE}}", "\n\n")
    .split(/\n\s*\n/)
    .map((text) => ({ field: null, where: null, text: text.trim() }))
    .filter((s) => s.text);
  // 語言能力、學歷從這份應徵的履歷拿（同語言的版本，沒有就用另一個）。
  const { data: app } = await supabase
    .from("applications")
    .select("resume_draft")
    .eq("id", applicationId)
    .eq("user_id", userId)
    .maybeSingle();
  const drafts = (app?.resume_draft ?? {}) as Record<string, Resume>;
  const resume = drafts[language] ?? Object.values(drafts)[0] ?? null;
  return runProofread({
    ...params,
    feature: "cover_letter_proofread",
    kind: "letter",
    segments,
    background: resume,
    content: (toCheck) =>
      [
        `===== 要校稿的求職信（{{SIGNATURE}} 是系統放的署名，不用檢查）=====\n${body}`,
        toCheck.size < segments.length
          ? `===== 這次要檢查的段落 =====\n${segments
              .filter((seg) => toCheck.has(seg.text))
              .map((seg) => seg.text)
              .join("\n\n")}`
          : "",
      ]
        .filter(Boolean)
        .join("\n\n"),
  });
}
