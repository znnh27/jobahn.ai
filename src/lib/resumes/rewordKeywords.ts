import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { askClaude } from "@/lib/ai/askClaude";
import { toTraditional } from "@/lib/text/toTraditional";
import { toFullWidthPunctuation } from "@/lib/text/fullWidthPunctuation";
import { addCjkSpacing } from "@/lib/text/cjkSpacing";
import { readBackground } from "./background";
import type { GeneratedResume } from "./generateResume";

// 履歷頁 JD 條件清單的「換成 JD 用字」：某些 JD 關鍵字沒有逐字出現在履歷裡，但履歷可能已經有對應的事實，
// 只是用字不同（JD 寫 stakeholder management，履歷寫「跨部門溝通」）。請 AI 找出那一句、只改用字不改事實。
// 找不到有事實的句子就說找不到，不硬塞（硬塞就是關鍵字堆砌，也違反每句都要有事實撐著）。
// 回傳的修改用前後對照給使用者看，按套用才換進畫布；這裡不存檔。

type Resume = GeneratedResume["resume"];

export type RewordLocation =
  | { section: "summary" }
  | { section: "work_experience" | "leadership"; entry: number; bullet: number }
  | { section: "skills" };

export interface RewordEdit {
  location: RewordLocation;
  /** 改之前的整句（技能是空字串，代表要加進技能那一行）。 */
  before: string;
  /** 改之後的整句（技能是要加的那個技能）。 */
  after: string;
  keyword: string;
  reason: string;
}

const SYSTEM_PROMPT = `你是履歷用字助手。招募官在 ATS 裡搜尋人才是逐字比對，使用者想把某些 JD 關鍵字用進履歷，但前提是履歷本來就有對應的事實。

你的工作：對每個關鍵字，在目前的履歷裡找「講的是同一件事、只是用字不同」的那一句，把那一小段換成 JD 的原字。

規則（最重要）：
1. 只改用字，不改事實：數字、專案、做法、參與程度都不能變；不能加履歷沒有的經驗、成果或技能。
2. 找不到講同一件事的句子，就不要改，放進 notFound。寧可找不到，也不要把關鍵字硬塞進不相干的句子。
3. 關鍵字要照 JD 原字逐字放進去（大小寫照抄），而且要放在具體的敘述裡，不要放在句首當標籤。
4. 一句只改需要的那一小段，其他字原封不動；改完一樣要通順、符合履歷寫法，中文句子用全形標點。
   「已經用到的 JD 關鍵字」一個都不能改掉或拆開（例如句子裡有 user interviews，就不能把它改成 user research），要用加的方式把新關鍵字放進去。
5. 工具、軟體、技能類的關鍵字，如果「使用者的技能清單」裡有，但履歷的技能那一行沒有，可以用 section "skills" 加進去（after 只放那個技能名稱）；技能清單裡也沒有就不要加。
6. location 用履歷 JSON 的位置：摘要是 { "section": "summary" }；經歷是 { "section": "work_experience" 或 "leadership", "entry": 第幾段（從 0 開始）, "bullet": 第幾條（從 0 開始）}；技能是 { "section": "skills" }。
7. before 要跟履歷裡那一句一字不差（技能給空字串）；after 是改好的整句。
   好幾個關鍵字要放進同一句時，合併成一個修改（keyword 寫「A、B」），before 一律是履歷原文，不要拆成好幾個修改疊在一起。
8. reason 用繁體中文一句話說明為什麼這句講的是同一件事。

只輸出 JSON，不要其他文字、不要 markdown code fence：
{ "edits": [{ "keyword": string, "location": object, "before": string, "after": string, "reason": string }], "notFound": [{ "keyword": string, "reason": string }] }`;

function textAt(resume: Resume, loc: RewordLocation): string | null {
  if (loc.section === "summary") return resume.summary ?? "";
  if (loc.section === "skills") return "";
  return resume[loc.section]?.[loc.entry]?.bullets?.[loc.bullet] ?? null;
}

function readLocation(raw: unknown): RewordLocation | null {
  const r = raw as { section?: unknown; entry?: unknown; bullet?: unknown } | null;
  if (r?.section === "summary" || r?.section === "skills") return { section: r.section };
  if ((r?.section === "work_experience" || r?.section === "leadership") && Number.isInteger(r.entry) && Number.isInteger(r.bullet)) {
    return { section: r.section, entry: r.entry as number, bullet: r.bullet as number };
  }
  return null;
}

export async function suggestKeywordRewording(params: {
  supabase: SupabaseClient;
  userId: string;
  applicationId: string;
  language: string;
  resume: Resume;
  keywords: string[];
  /** 這些關鍵字掛的 JD 條件（其他關鍵字是 null），給 AI 參考上下文。 */
  item: string | null;
  /** 履歷已經逐字用到的 JD 關鍵字：改用字時不能把它們改掉（不然補了一個、掉了一個）。 */
  keep?: string[];
}): Promise<{ edits: RewordEdit[]; notFound: { keyword: string; reason: string }[] }> {
  const { supabase, userId, applicationId, language, resume, keywords, item, keep = [] } = params;
  const { data: application } = await supabase
    .from("applications")
    .select("job_description")
    .eq("id", applicationId)
    .eq("user_id", userId)
    .single();
  if (!application) throw new Error("找不到這筆應徵紀錄");
  const { data: profile } = await supabase.from("profile_data").select("data").eq("user_id", userId).maybeSingle();
  const skills = readBackground(profile?.data)[language === "zh" ? "zh" : "en"].skills;

  const response = await askClaude({
    userId,
    feature: "keyword_reword",
    systemPrompt: SYSTEM_PROMPT,
    userPrompt: [
      `===== 要用進履歷的 JD 關鍵字 =====`,
      keywords.map((k) => `- ${k}`).join("\n"),
      item ? `===== 這些關鍵字出自這條 JD 條件 =====\n${item}` : "",
      keep.length > 0 ? `===== 已經用到的 JD 關鍵字（不能改掉）=====\n${keep.join("、")}` : "",
      `===== JD =====`,
      application.job_description,
      `===== 使用者的技能清單 =====`,
      skills.length > 0 ? skills.join("、") : "（無）",
      `===== 目前的履歷（${language}）=====`,
      JSON.stringify({ ...resume, layout: undefined }, null, 2),
    ]
      .filter(Boolean)
      .join("\n\n"),
    maxTokens: 3000,
    temperature: 0,
    supabase,
  });

  let parsed: { edits?: unknown[]; notFound?: { keyword?: unknown; reason?: unknown }[] };
  try {
    parsed = JSON.parse(response.text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, ""));
  } catch {
    throw new Error("AI 回傳的內容不是有效的 JSON，請再試一次");
  }

  const fix = (t: string) => (language === "zh" ? addCjkSpacing(toFullWidthPunctuation(toTraditional(t))) : t);
  const edits: RewordEdit[] = [];
  const rejected: { keyword: string; reason: string }[] = [];
  for (const raw of parsed.edits ?? []) {
    const e = raw as { keyword?: unknown; location?: unknown; before?: unknown; after?: unknown; reason?: unknown };
    const keyword = typeof e.keyword === "string" ? e.keyword : "";
    const location = readLocation(e.location);
    const after = typeof e.after === "string" ? fix(e.after.trim()) : "";
    if (!keyword || !location || !after) continue;
    const current = textAt(resume, location);
    // 程式再檢查一次：位置要存在、before 要跟履歷一字不差、改完的句子真的有用到關鍵字，不然不給使用者看。
    // 一個修改可能同時放好幾個關鍵字（「A、B」），每個都要真的出現在改完的句子裡。
    const containsKeyword = keyword
      .split(/[、,，]/)
      .map((k) => k.trim())
      .filter(Boolean)
      .every((k) => after.toLowerCase().includes(k.toLowerCase()));
    const beforeMatches = location.section === "skills" || current === e.before;
    if (current === null || !beforeMatches || !containsKeyword) {
      rejected.push({ keyword, reason: "這次沒有找到可以直接套用的改法，可以再按一次試試，或自己在畫布上改" });
      continue;
    }
    // 改完不能把原本已經用到的關鍵字弄丟（補了一個、掉了一個）。
    const lost = keep.find(
      (k) => (current ?? "").toLowerCase().includes(k.toLowerCase()) && !after.toLowerCase().includes(k.toLowerCase()),
    );
    if (lost) {
      rejected.push({ keyword, reason: `這樣改會把原本已經用到的「${lost}」改掉，沒有採用` });
      continue;
    }
    edits.push({
      location,
      before: current,
      after,
      keyword,
      reason: typeof e.reason === "string" ? toTraditional(e.reason) : "",
    });
  }
  const notFound = [
    ...(parsed.notFound ?? [])
      .filter((n) => typeof n.keyword === "string")
      .map((n) => ({ keyword: n.keyword as string, reason: typeof n.reason === "string" ? toTraditional(n.reason) : "" })),
    ...rejected,
    // 已經被某個修改順帶放進去的（例如改成 checkout funnels，funnels 也有了）不算找不到。
  ].filter((n) => !edits.some((e) => e.after.toLowerCase().includes(n.keyword.toLowerCase())));
  return { edits, notFound };
}
