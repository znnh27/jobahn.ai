import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { askClaude } from "@/lib/ai/askClaude";
import { NATURAL_WRITING_RULES } from "@/lib/text/naturalWriting";
import { EN_RULES, ZH_RULES, parseJsonResponse, polishChinese, type GeneratedResume } from "./generateResume";
import { applyResumePatch, isResumeShape, resumeForPatch } from "./resumePatch";
import { pinEntryFacts } from "./pinEntryFacts";

// 應徵履歷在一個語言改了內容（打字、跟 AI 聊、補充、校稿、上一步…），同樣的修改套到另一個語言（2026-11-01 Z 要求中英文內容一致）。
// 畫面停止編輯幾秒後呼叫（canvas.tsx），只回傳改好的另一個語言，不存檔；畫面換進草稿後由自動存檔存。
// 跟「跟 AI 聊」一樣只回傳改到的地方（resumePatch.ts），不整份重寫。

type Resume = GeneratedResume["resume"];

const SYSTEM_PROMPT = `你是履歷雙語同步助手。使用者有同一份履歷的兩個語言版本，剛在其中一個語言（來源）改了內容，你要把同樣的修改套到另一個語言（目標）的版本，兩個版本的內容才會一致。

1. 「這次來源改了的地方」是程式比對「來源改之前」跟「來源改之後」列出來的，列出的每一處都是實質修改，每一處都要在目標版本做對應的修改、輸出對應的 op，不能略過。
   要同步的是「修改這個動作」，不是比對結果像不像：來源把摘要縮短了，目標的摘要也要縮短；來源補了一句，目標也要補。不要因為目標版本的資訊看起來已經涵蓋來源改之後的內容，就判斷不用改。
2. 在目標版本找到對應的地方，做同樣的修改。對應關係看內容講的是不是同一件事，通常 id 也一樣，但不一定。
3. 沒列到的地方一字不動。
4. 改寫或新增的那條，事實、數字跟來源改之後的那條一樣，照目標語言的履歷寫法重寫（見下面的語言規則），不是逐字翻譯，避免翻譯腔。
5. 技能改了的話，目標版本做一樣的增刪，技能名稱照來源的寫法一字不差，不用轉成目標語言（技能都是工具、方法的名稱，例如 PowerPoint、Google Analytics、A/B Testing）。目標語言的技能清單裡沒有也照加，不能因為清單裡沒有就不改。
6. 新增整段經歷時，公司名稱、職稱、期間、地點照「目標語言經歷資料庫」裡同一家公司的寫法；資料庫沒有才自己轉成目標語言的寫法。

${NATURAL_WRITING_RULES}

只輸出 JSON，不要有其他文字、不要用 markdown code fence 包起來。輸出格式：{ "mode": "patch" | "full", "ops": op[], "resume": 整份目標版本履歷 | null }
- 預設用 patch：ops 只列出目標版本要改的地方，用目標版本的 id 指名，沒列到的程式會保持原樣，resume 給 null。
- op 有這幾種：
  { "op": "summary", "text": string }：改寫摘要
  { "op": "replace", "id": "w0-2", "text": string }：改寫這條 bullet
  { "op": "insert", "entry": "w0", "after": "w0-2" | null, "text": string }：在這段經歷新增一條，接在 after 那條後面；after 給 null 就放在第一條。同一個 after 新增好幾條，會照 ops 的順序往下排
  { "op": "delete", "id": "w0-2" }：刪掉這條
  { "op": "skills", "skills": string[] }：整組換掉技能
- 這幾種情況改用 full，resume 給整份目標版本履歷（不要帶 id），ops 給空陣列：
  要改公司、職稱、期間、地點，新增或拿掉整段經歷，或調整 bullet、經歷的順序；改動超過大概一半的 bullet。
  full 的格式：{ "summary": string, "work_experience": [{ "org": string, "role": string, "period": string, "location": string|null, "bullets": string[] }], "leadership": [同 work_experience], "education": [{ "school": string, "period": string, "location": string|null, "detail": string|null }], "skills": string[], "languages": string[] }`;

export async function syncResumeEdit(params: {
  supabase: SupabaseClient;
  userId: string;
  sourceLanguage: string;
  /** 來源語言上次同步時的內容。 */
  before: Resume;
  /** 來源語言現在的內容。 */
  after: Resume;
  /** 目標語言現在的內容。 */
  target: Resume;
  /** 上次 AI 判斷不用改，使用者按了「還是要同步」。 */
  force?: boolean;
}): Promise<{ resume: Resume; skipped?: string[] }> {
  const { supabase, userId, before, after, target } = params;
  const targetLanguage = params.sourceLanguage === "zh" ? "en" : "zh";
  const changes = describeChanges(before, after);
  // 改到的是學歷這類不同步的欄位（不在 resumeForPatch 裡），不用問 AI。
  if (changes.length === 0) return { resume: target };

  const { data: entryRows } = await supabase
    .from("experience_entries")
    .select("org_name, location, role_variants, period_variants")
    .eq("user_id", userId)
    .eq("language", targetLanguage);
  const targetEntries = entryRows ?? [];

  const userPrompt = [
    `來源語言：${params.sourceLanguage}；目標語言：${targetLanguage}`,
    params.force
      ? `上一次你判斷目標版本不用改，使用者看過後認為要改：這次一定要把來源改了的地方對應改到目標版本，ops 不能是空的。`
      : "",
    targetLanguage === "en" ? EN_RULES : ZH_RULES,
    `===== 來源改之前 =====`,
    JSON.stringify(resumeForPatch(before), null, 2),
    `===== 來源改之後 =====`,
    JSON.stringify(resumeForPatch(after), null, 2),
    `===== 這次來源改了的地方（程式比對出來的，每一處都要同步）=====`,
    changes.map((c) => `- ${c.ai}`).join("\n"),
    `===== 目標版本（現在的內容，ops 用這裡的 id）=====`,
    JSON.stringify(resumeForPatch(target), null, 2),
    `===== 目標語言經歷資料庫裡的公司、職稱、期間、地點 =====`,
    JSON.stringify(targetEntries, null, 2),
  ]
    .filter(Boolean)
    .join("\n\n");

  const response = await askClaude({
    userId,
    feature: "resume_language_sync",
    systemPrompt: SYSTEM_PROMPT,
    userPrompt,
    maxTokens: 8000,
    supabase,
  });

  const parsed = parseJsonResponse<{ mode?: string; ops?: unknown; resume?: unknown }>(response.text);
  let next: Resume | null;
  if (parsed.mode === "full") {
    if (!isResumeShape(parsed.resume)) throw new Error("AI 回傳的格式不對");
    next = parsed.resume;
    // 不套 pinBackground：它會把技能清單裡沒有的技能刪掉、語言能力換回資料庫的，使用者剛加的就同步不過去
    // （2026-11-04 英文加了 PowerPoint、Google Analytics，中文怎麼同步都加不上）。學歷不同步，下面用目標版本原本的。
    pinEntryFacts(next, targetEntries);
  } else {
    next = applyResumePatch(target, parsed.ops ?? []);
    if (!next) throw new Error("AI 回傳的修改對不上目前的內容");
  }
  if (targetLanguage === "zh") polishChinese(next);
  const resume = { ...next, education: target.education, layout: target.layout };
  // AI 一個修改都沒給：列出的地方都沒同步到，畫面要告訴使用者是哪幾處。
  // 有給修改、但改完跟目標一樣，代表目標本來就一致，不算沒同步。
  const noOps = parsed.mode !== "full" && Array.isArray(parsed.ops) && parsed.ops.length === 0;
  return noOps ? { resume, skipped: changes.map((c) => c.label) } : { resume };
}

const FIELD_LABEL = { org: "公司名稱", role: "職稱", period: "期間", location: "地點" } as const;

/**
 * 程式比對來源改了哪幾處，列給 AI。以前讓 AI 自己比，AI 會拿「改完的結果」跟目標比：
 * 中文摘要縮短了，但事實英文版都有，就判斷英文不用改（2026-11-04 Z 回報改了一邊、另一邊沒跟著變）。
 * id 跟 resumeForPatch 的一樣（來源改之後那份的 id）。
 */
function describeChanges(before: Resume, after: Resume): { ai: string; label: string }[] {
  // 只差在標點、空白、大小寫、全半形的不算修改，另一個語言不用跟著改。
  const key = (v: unknown) =>
    JSON.stringify(v ?? null, (_, x) =>
      typeof x === "string" ? x.normalize("NFKC").toLowerCase().replace(/[\s\p{P}]/gu, "") : x,
    );
  // ai：給 AI 看的（用 id 指名）；label：沒同步到時顯示給使用者看的。
  const changes: { ai: string; label: string }[] = [];
  const add = (ai: string, label: string) => changes.push({ ai, label });
  if (key(before.summary) !== key(after.summary)) add("摘要（summary）改寫了", "摘要");
  const sections = [
    ["work_experience", "w", "工作經歷"],
    ["leadership", "l", "領導經驗／專案"],
  ] as const;
  for (const [section, prefix, label] of sections) {
    const b = before[section] ?? [];
    const a = after[section] ?? [];
    if (b.length !== a.length) {
      add(`${label}新增或刪除了整段經歷（改之前 ${b.length} 段，改之後 ${a.length} 段）`, `${label}新增或刪除的經歷`);
      continue;
    }
    a.forEach((entry, i) => {
      const old = b[i];
      const id = `${prefix}${i}`;
      const name = entry.org || old.org || label;
      for (const field of ["org", "role", "period", "location"] as const) {
        if (key(old[field]) !== key(entry[field]))
          add(`${id} 的 ${field} 改了：「${old[field] ?? ""}」→「${entry[field] ?? ""}」`, `${name} 的${FIELD_LABEL[field]}`);
      }
      const ob = old.bullets ?? [];
      const nb = entry.bullets ?? [];
      if (ob.length === nb.length) {
        nb.forEach((text, j) => {
          if (key(ob[j]) !== key(text)) add(`${id}-${j} 改寫了`, `${name} 第 ${j + 1} 條`);
        });
      } else if (key([...ob].sort()) !== key([...nb].sort())) {
        add(`${id} 的 bullet 有新增或刪除（改之前 ${ob.length} 條，改之後 ${nb.length} 條）`, `${name} 新增或刪除的條目`);
      } else {
        add(`${id} 的 bullet 調整了順序`, `${name} 的條目順序`);
      }
    });
  }
  if (key(before.skills) !== key(after.skills)) add("技能（skills）改了", "技能");
  if (key(before.languages) !== key(after.languages)) add("語言能力（languages）改了", "語言能力");
  return changes;
}
