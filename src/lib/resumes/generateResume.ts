import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { askClaude } from "@/lib/ai/askClaude";
import { BULLET_RULES } from "@/lib/experience/bulletRules";
import { computeAtsScore, type JdImportance } from "./atsScore";
import { readLayoutDefaults, type ResumeLayoutSettings } from "./typography";
import { toFullWidthPunctuation } from "@/lib/text/fullWidthPunctuation";
import { toTraditional } from "@/lib/text/toTraditional";

const SUMMARY_RULES = `Professional Summary 寫作規則（一定要遵守）：
1. 先看 JD 最重視的 1-2 項核心能力/條件，從經歷資料庫裡挑選跟這些條件最相關的主題與成就來寫，其餘經歷不用勉強塞進來湊滿。
2. 用綜合陳述寫成一段話，不是把 bullet 條列拼接起來；控制在 3-4 句話內。
3. 第一句定位使用者的核心優勢/專業定位，中間 1-2 句呼應 JD 最看重的能力並帶出經歷資料庫裡的具體佐證（能帶量化成果就帶），最後視情況一句帶出跟這個職缺/領域的契合度。
4. 禁止空泛形容詞堆疊（例如「passionate」「driven」「results-oriented」單獨出現卻沒有具體事實撐著），每個特質描述都要有實際內容佐證，不能只是形容詞。
5. 不要直接重複 work_experience 裡已經寫的 bullet 原句，用更高層次的方式歸納主題，避免跟下面內容重疊感太重。
6. 一樣要降低 AI 感、避免堆疊術語，寫得像人類自然會寫的用詞。`;

// bullet 本身的寫法用經歷資料庫共用的那一份規則（lib/experience/bulletRules.ts），
// 這裡只補「挑內容、排一份履歷」才需要的規則。
const WRITING_RULES = `${BULLET_RULES}

排履歷的規則（一定要遵守）：
1. 規則 6 的「依目標 JD 決定留不留」：這次的目標 JD 就是下面給的 JD。
2. 每段工作經歷最多 4 條 bullet，只放對這個職缺有幫助的內容，其餘略過不用全部塞進去。每段經歷裡的 bullet 依跟這份 JD 的相關度排序，最相關的放最前面。
3. 履歷內容要能一頁 A4 呈現，不要塞得過多過滿。放不下時，優先拿掉跟這份 JD 關聯度最低的內容（通常是最舊、或最不相關的經歷），不要每一句都砍幾個字讓全部內容都變得倉促。
4. JD 原文用字要盡量真的出現在履歷裡（不是只有意思接近），但要放在具體案例的敘述裡（見規則 7），前提是使用者真的有對應的真實經歷可以支撐，不能為了關鍵字硬掰。
5. 同一段經歷可以依這份 JD 換敘事角度（例如投系統規劃職缺強調規劃，投行銷職缺強調成長數據），但底層事實跟程度不能變。`;

// 英文版/中文版各自只拿自己那份，不要兩份一起塞給同一次生成。
const EN_RULES = `英文版額外規則（一定要遵守）：
1. 每條 bullet 用強動詞開頭（Led, Built, Launched, Redesigned, Increased 等）。弱開頭一律不用：Responsible for, Assisted, Helped, Participated in, Worked on, Served as, Acted as。
2. 不寫 I、my、me 等第一人稱。
3. 過去的工作用過去式，現職用現在式。
4. 講自己的貢獻，不是團隊整體做了什麼；團隊成果要寫清楚自己負責的那一塊。
5. 不用形容詞自誇（例如 excellent, outstanding, passionate, hardworking），改用事實和數字證明。
6. 職稱用國際通用說法，不要直譯台灣特有職稱（例如「專員」依實際工作內容改成 Specialist / Associate / Coordinator）。
7. 數字單位用 K、M、B（例如 3 萬 → 30K，1,200 萬 → 12M）；新台幣金額加註換算的 USD（例如 NT$3M (~USD 95K)），或直接用 USD。
8. 日期格式全份統一，沿用 Mar. 2024 – Aug. 2024 這種寫法。
9. 全部用半形標點，不能殘留全形符號或中文字。
10. JD 是英文時，優先使用 JD 原字，不自己換同義詞（例如 JD 寫 stakeholder management，就不要寫成 cross-team coordination）。
輸出前逐條自我檢查以上規則，全部符合才輸出。`;

const ZH_RULES = `中文版額外規則（一定要遵守）：
1. bullet 用動作動詞開頭，不用「負責、參與、協助」起頭。
2. 用中文自然的寫法，避免翻譯腔，不要寫「透過……，成功地……」「負責……的……」這種長串修飾。
3. 專業術語、產品名、工具名保留英文（例如 A/B Test、Figma、Google Analytics）。
4. 數字用「萬、百萬」，中文句子用全形標點。`;

// 使用者只有中文經歷、沒有英文經歷時，英文版改從中文經歷重寫。
const ZH_TO_EN_RULES = `來源轉換規則（這次的經歷資料庫是中文，但要產出英文版履歷）：
1. 不是逐句翻譯，而是依英文履歷慣例重寫。事實和數字不能改，只改寫法。
2. 中文的「負責、協助、參與」不能直譯成 Responsible for / Assisted in / Participated in，要改寫成實際做的具體動作。
3. 例外：這次 "org" 欄位不用跟 org_name 一字不改，要轉成公司的英文名稱（有官方英文名就用官方的）；外國人不認識的公司，在英文名稱後加一句簡介（產業、規模或產品），例如：XX Bank, a Taiwanese commercial bank with 100+ branches。
4. role、period、location、學歷、技能也都要轉成英文。`;

export const COVERAGE_RULES =`JD 符合度清單的判定標準（務必嚴格遵守，這是評分結果每次跑出來不一致的主要原因，要特別小心）：
1. covered 只有在內容裡有「明確、具體、可以直接指認」的事實對應到這個 JD 項目時，才標記 true。單純「產業相關」、「性質類似」、「可以類推應該也做得到」都不算，一律標記 false。
2. 領域/類型不同不能算通過。例如 JD 要求「數位/軟體產品的 0 到 1 經驗」，如果內容寫的是硬體或 IoT 產品的跨國協作，不算 covered，要在缺口說明清楚差在「產品類型不同」，不要含糊帶過。
3. 每次判斷同一個項目，都要用同一套標準重新逐項檢查：先問「這句話有沒有字面上或近乎字面上支持這個要求」，不要憑整體印象覺得「這個人應該做得到」就標 true，也不要因為前一次判斷是 true 就傾向維持 true（或反過來），每次都要重新看內容本身。
4. 如果只是職務相近、可以類推、但沒有具體事實佐證，一律標 false，並在缺口裡具體寫出缺的是什麼，不要寫模稜兩可的描述。`;

const SYSTEM_PROMPT = `你是履歷客製化助手。使用者會給你：這個職缺的 JD、使用者的經歷資料庫、使用者的個人資料（聯絡方式、學歷、技能）。

經歷資料庫的結構說明：每筆經歷（同一家公司同一個職位）底下的 achievements 是「同一件事的不同寫法」分組——同一個 achievement 底下的每個 variant 講的是同一件真實的事，只是措辭角度不同，variant.angleLabel 標註這個寫法強調的重點（例如「強調數據分析」「強調從 0 到 1 實作」）。同一個 achievement 底下的多個 variant 不是好幾件不同的事，不要當成好幾條 bullet 分別寫進履歷。

你的任務：分析 JD 要求哪些條件，針對每個要放進履歷的 achievement，從它底下的 variant 裡挑一個角度最貼近 JD 的當作事實依據，再照下面的寫作規則寫成這份履歷的 bullet，合併成一份完整履歷（Professional Summary、工作經歷、領導經驗/專案、學歷、技能）。

經歷資料庫裡的寫法不一定優化過（使用者可能還沒用過資料庫的檢查、潤飾功能），常見問題是流水帳、步驟描述、弱動詞開頭、沒有成果、一句塞太多事。不要原封不動照抄：每一條都要對照寫作規則檢查，不符合就重寫；已經符合規則的寫法可以保留。重寫只改寫法、不改事實：數字、專案歸屬、做法都只能用資料庫裡有的，不能新增資料庫沒有的數字、成果或方法。

重要：輸出的每一段工作經歷/領導經驗的 "org" 欄位，一定要跟輸入的經歷資料庫裡對應那筆的 org_name 完全一致（一字不改），不要精簡、不要改寫、不要移除括號內的說明文字。這個欄位之後系統要拿去跟資料庫比對，改寫過會導致比對失敗。

${SUMMARY_RULES}

${WRITING_RULES}

只輸出 JSON，不要有其他文字、不要用 markdown code fence 包起來。輸出格式（嚴格遵守）：
{
  "summary": string,
  "work_experience": [{ "org": string, "role": string, "period": string, "location": string|null, "bullets": string[] }],
  "leadership": [{ "org": string, "role": string, "period": string, "location": string|null, "bullets": string[] }],
  "education": [{ "school": string, "period": string, "location": string|null, "detail": string|null }],
  "skills": string[]
}`;

interface ExperienceEntryRow {
  language: string;
  entry_type: string;
  org_name: string;
  location: string | null;
  role_variants: unknown;
  period_variants: unknown;
  achievements: unknown;
}

export interface GeneratedResume {
  resume: {
    summary: string;
    work_experience: Array<{
      org: string;
      role: string;
      period: string;
      location: string | null;
      bullets: string[];
    }>;
    leadership: Array<{
      org: string;
      role: string;
      period: string;
      location: string | null;
      bullets: string[];
    }>;
    education: Array<{ school: string; period: string; location: string | null; detail: string | null }>;
    skills: string[];
    /** 使用者在畫布上調的字級跟間距，沒有就用預設值（見 typography.ts）。 */
    layout?: ResumeLayoutSettings;
  };
  jd_match_checklist: JdChecklistItem[];
  ats_score: number;
  /** 舊資料用的缺口清單。新資料的缺口說明直接放在每一項的 gap 裡，這個欄位由 gap 組出來。 */
  ats_gaps: string[];
}

export interface JdChecklistItem {
  /** JD 條件（短句）。 */
  item: string;
  covered: boolean;
  source: "resume" | "cover_letter" | null;
  /** 必要條件還是加分條件。第一次建立清單時標好，之後固定不變，用來算分數（見 atsScore.ts）。舊資料沒有。 */
  importance?: JdImportance | null;
  /** 有涵蓋時：履歷裡哪一句對應到這項。舊版格式留下來的欄位，現在不產生也不顯示。 */
  evidence?: string | null;
  /** 沒涵蓋時：具體缺什麼、跟現有經驗差在哪、可以怎麼補。舊資料沒有這個欄位。 */
  gap?: string | null;
}

/** 中文版的摘要跟 bullet：簡體字轉繁體、半形標點轉全形（AI 偶爾會混進來）。公司名要跟資料庫比對，不動。 */
function polishChinese(resume: GeneratedResume["resume"]) {
  const fix = (t: string) => toFullWidthPunctuation(toTraditional(t));
  resume.summary = fix(resume.summary ?? "");
  for (const e of [...(resume.work_experience ?? []), ...(resume.leadership ?? [])]) {
    e.bullets = (e.bullets ?? []).map(fix);
  }
}

export async function generateResumeForApplication(
  supabase: SupabaseClient,
  userId: string,
  applicationId: string,
): Promise<void> {
  const { data: application, error: appError } = await supabase
    .from("applications")
    .select("job_description, resume_language, jd_match_checklist, score_basis")
    .eq("id", applicationId)
    .eq("user_id", userId)
    .single();

  if (appError || !application) {
    throw new Error(`找不到這筆應徵紀錄：${appError?.message ?? "unknown"}`);
  }

  // 同一份 JD 重新生成履歷時，沿用原本的 JD 條件清單（條件文字、必要/加分都不變），分數才比得起來。
  const existingChecklists: Record<string, GeneratedResume["jd_match_checklist"]> =
    application.jd_match_checklist ?? {};
  const basis = readScoreBasis(application.score_basis);

  const languages: string[] = application.resume_language ?? [];
  if (languages.length === 0) {
    throw new Error("這筆應徵沒有指定語言版本");
  }

  const { data: entries, error: entriesError } = await supabase
    .from("experience_entries")
    .select("language, entry_type, org_name, location, role_variants, period_variants, achievements")
    .eq("user_id", userId);

  if (entriesError) throw new Error(`讀取經歷資料庫失敗：${entriesError.message}`);
  if (!entries || entries.length === 0) {
    throw new Error("經歷資料庫是空的，請先到經歷資料庫頁面上傳履歷");
  }

  const { data: profile } = await supabase
    .from("profile_data")
    .select("data")
    .eq("user_id", userId)
    .maybeSingle();

  const layoutDefaults = readLayoutDefaults(profile?.data);
  const resumeDraft: Record<string, GeneratedResume["resume"]> = {};
  const checklists: Record<string, GeneratedResume["jd_match_checklist"]> = {};
  const atsScores: Record<string, number> = {};
  const atsGaps: Record<string, string[]> = {};

  for (const lang of languages) {
    let langEntries = (entries as ExperienceEntryRow[]).filter((e) => e.language === lang);
    let sourceLanguage = lang;
    if (lang === "en" && langEntries.length === 0) {
      langEntries = (entries as ExperienceEntryRow[]).filter((e) => e.language === "zh");
      sourceLanguage = "zh";
    }

    const userPrompt = buildUserPrompt({
      jd: application.job_description,
      language: lang,
      sourceLanguage,
      entries: langEntries,
      profile: profile?.data ?? {},
    });

    const response = await askClaude({
      userId,
      feature: "resume_generate",
      systemPrompt: SYSTEM_PROMPT,
      userPrompt,
      maxTokens: 8000,
      supabase,
    });

    const resume = parseJsonResponse<GeneratedResume["resume"]>(response.text);
    if (lang === "zh") polishChinese(resume);
    // 經歷資料庫調過字級／上下間距的話，新履歷直接用那個設定。
    const defaultLayout = layoutDefaults[lang as "zh" | "en"];
    if (defaultLayout) resume.layout = defaultLayout;
    resumeDraft[lang] = resume;

    // 檢查清單／評分一律走同一個評分函式（跟 rescore 共用），不要讓生成當下的評分
    // 跟之後 rescore 用不同的 prompt 各自判斷，否則同一份內容兩次評分結果會兜不起來。
    const scored = await scoreResumeAgainstJd({
      supabase,
      userId,
      jd: application.job_description,
      language: lang,
      resumeContent: resume,
      existingItems: existingChecklists[lang] ?? [],
      // 整份重新生成，內容全換了，不拿上一版比對，每一項都重新判斷。
      previousResume: null,
    });
    checklists[lang] = scored.jd_match_checklist;
    atsScores[lang] = scored.ats_score;
    atsGaps[lang] = scored.ats_gaps;
    basis.resume[lang] = resume;
  }

  const { error: updateError } = await supabase
    .from("applications")
    .update({
      resume_draft: resumeDraft,
      jd_match_checklist: checklists,
      ats_score: averageScore(atsScores),
      ats_gaps: atsGaps,
      score_basis: basis,
      status: "draft",
    })
    .eq("id", applicationId)
    .eq("user_id", userId);

  if (updateError) throw new Error(`儲存生成結果失敗：${updateError.message}`);
}

const SCORE_SYSTEM_PROMPT = `你是履歷跟 JD 的比對助手。使用者會給你 JD、一份 JD 條件清單（可能是空的）、跟一份履歷內容。你不打分數（分數由系統照公式算），只負責判斷每一項條件有沒有寫到。

1. 清單是空的：自己從 JD 列出關鍵條件（通常 6 到 10 項，一項一件事，用 JD 的語言寫），每一項標 importance：JD 寫成硬性要求的是 "required"，寫 preferred / nice to have / 加分的是 "preferred"。
   清單不是空的：item 文字跟 importance 一律照抄，不能改寫、新增、刪除、合併項目。舊清單如果沒有 importance，這次依 JD 補上，之後就固定。
2. 每一項判斷 covered（有沒有寫到），source 有寫到填 "resume"，沒寫到填 null。
3. 沒寫到的項目，gap 要寫得具體、可以照著做：缺的是什麼具體事實、使用者現有經驗跟這項要求差在哪（例如產品類型不同、年資不夠、只有協助沒有主導）、可以怎麼補（挖掘哪一類經驗寫進履歷，或留到求職信說明）。有寫到的 gap 是 null。gap 一律用繁體中文。
   範例：item「2 年以上主導數位產品規劃經驗（AI、大數據相關尤佳）」→ gap「缺乏 2 年以上主導 AI、大數據或演算法相關數位產品的具體事實；現有經驗是銀行 App 改版與 IoT 硬體專案，產品類型不同，現職年資也還不到 2 年。如果有做過跟資料分析、推薦或自動化相關的功能，可以挖出來寫成一條；沒有的話在求職信說明轉換動機。」
4. **判斷要穩定**：如果有給「上次的判斷」跟「這次履歷改了哪些地方」，只有跟改動內容直接相關的項目可以改變 covered；跟改動無關的項目，covered、source、gap 一律照抄上次的判斷，不要重新詮釋。

${COVERAGE_RULES}

只輸出 JSON，不要有其他文字、不要用 markdown code fence 包起來。輸出格式（嚴格遵守）：
{
  "jd_match_checklist": [{ "item": string, "importance": "required"|"preferred", "covered": boolean, "source": "resume"|null, "gap": string|null }]
}`;

type Resume = GeneratedResume["resume"];

/** 上次評分／比對時的內容（存在 applications.score_basis），內容沒改就沿用上次結果。 */
export interface ScoreBasis {
  resume: Record<string, Resume>;
  cover_letter: Record<string, string>;
}

export function readScoreBasis(raw: unknown): ScoreBasis {
  const b = (raw ?? {}) as Partial<ScoreBasis>;
  return { resume: { ...(b.resume ?? {}) }, cover_letter: { ...(b.cover_letter ?? {}) } };
}

function averageScore(scores: Record<string, number>): number | null {
  const values = Object.values(scores);
  return values.length > 0 ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : null;
}

/** 履歷攤平成一行一行（摘要、每條 bullet、技能），用來比對兩個版本差在哪。 */
function resumeLines(r: Resume): string[] {
  return [
    `摘要：${r.summary}`,
    ...[...(r.work_experience ?? []), ...(r.leadership ?? [])].flatMap((e) => e.bullets.map((b) => `${e.org}｜${b}`)),
    `技能：${(r.skills ?? []).join(", ")}`,
  ];
}

/** 只比內容，不比排版設定（字級、間距改了不用重新評分）。 */
function sameResume(a: Resume, b: Resume): boolean {
  const content = ({ layout: _layout, ...rest }: Resume) => rest; // eslint-disable-line @typescript-eslint/no-unused-vars
  return JSON.stringify(content(a)) === JSON.stringify(content(b));
}

async function scoreResumeAgainstJd(params: {
  supabase: SupabaseClient;
  userId: string;
  jd: string;
  language: string;
  resumeContent: Resume;
  existingItems: GeneratedResume["jd_match_checklist"];
  /** 上次評分時的履歷。跟這次一模一樣就不呼叫 AI；不一樣就只把差異告訴 AI。 */
  previousResume: Resume | null;
}): Promise<Pick<GeneratedResume, "jd_match_checklist" | "ats_score" | "ats_gaps">> {
  const existing = params.existingItems;
  const hasImportance = existing.length > 0 && existing.every((i) => i.importance);

  let items: GeneratedResume["jd_match_checklist"];
  if (params.previousResume && hasImportance && sameResume(params.previousResume, params.resumeContent)) {
    // 內容完全沒改：直接沿用上次的判斷，分數一定一樣。
    items = existing;
  } else {
    const diff = params.previousResume && existing.length > 0 ? diffLines(params.previousResume, params.resumeContent) : null;
    const userPrompt = [
      `===== JD =====`,
      params.jd,
      existing.length > 0
        ? `===== JD 條件清單跟上次的判斷（item、importance 照抄）=====\n${JSON.stringify(
            existing.map(({ item, importance, covered, source, gap }) => ({ item, importance: importance ?? null, covered, source, gap: gap ?? null })),
            null,
            2,
          )}`
        : "===== JD 條件清單 =====\n（目前是空的，請你從 JD 列出）",
      diff
        ? `===== 這次履歷改了哪些地方（只有跟這些改動相關的項目可以改變判斷）=====\n新增：\n${diff.added.join("\n") || "（無）"}\n\n刪除：\n${diff.removed.join("\n") || "（無）"}`
        : "",
      `===== 履歷內容（${params.language}）=====`,
      JSON.stringify(params.resumeContent, null, 2),
    ]
      .filter(Boolean)
      .join("\n\n");

    const response = await askClaude({
      userId: params.userId,
      feature: "ats_score",
      systemPrompt: SCORE_SYSTEM_PROMPT,
      userPrompt,
      maxTokens: 6000,
      temperature: 0,
      supabase: params.supabase,
    });

    const parsed = JSON.parse(
      response.text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, ""),
    ) as Pick<GeneratedResume, "jd_match_checklist">;
    items = lockItems(existing, parsed.jd_match_checklist);
  }

  return {
    jd_match_checklist: items,
    ats_score: computeAtsScore(items) ?? 0,
    ats_gaps: items.filter((i) => !i.covered && i.gap).map((i) => i.gap as string),
  };
}

function diffLines(before: Resume, after: Resume) {
  const a = resumeLines(before);
  const b = resumeLines(after);
  return { added: b.filter((l) => !a.includes(l)), removed: a.filter((l) => !b.includes(l)) };
}

/**
 * 清單已經存在時，條件文字跟必要/加分由程式鎖住（AI 偶爾會改寫條件文字或多列一項）：
 * 照舊清單的順序，用條件文字對回 AI 這次的判斷；對不到的項目沿用上次的判斷。
 */
function lockItems(
  existing: GeneratedResume["jd_match_checklist"],
  fresh: GeneratedResume["jd_match_checklist"],
): GeneratedResume["jd_match_checklist"] {
  const normalize = (item: JdChecklistItem): JdChecklistItem => ({
    item: item.item,
    importance: item.importance === "preferred" ? "preferred" : "required",
    covered: !!item.covered,
    source: item.covered ? "resume" : null,
    gap: item.covered ? null : (item.gap ?? null),
  });
  if (existing.length === 0) return fresh.map(normalize);
  const byItem = new Map(fresh.map((i) => [i.item.trim(), i]));
  return existing.map((old) => {
    // AI 這次漏判或把條件文字改掉了，就沿用上次的判斷。
    const judged = byItem.get(old.item.trim()) ?? old;
    return normalize({
      ...judged,
      item: old.item,
      // 舊清單已經有 importance 就固定用舊的；舊資料沒有才用這次 AI 補的。
      importance: old.importance ?? judged.importance,
    });
  });
}

export async function rescoreResumeForApplication(
  supabase: SupabaseClient,
  userId: string,
  applicationId: string,
  editedResumeDraft: Record<string, GeneratedResume["resume"]>,
): Promise<void> {
  const { data: application, error: appError } = await supabase
    .from("applications")
    .select("job_description, resume_language, jd_match_checklist, score_basis")
    .eq("id", applicationId)
    .eq("user_id", userId)
    .single();

  if (appError || !application) {
    throw new Error(`找不到這筆應徵紀錄：${appError?.message ?? "unknown"}`);
  }

  const languages: string[] = application.resume_language ?? [];
  const existingChecklists: Record<string, GeneratedResume["jd_match_checklist"]> =
    application.jd_match_checklist ?? {};
  const basis = readScoreBasis(application.score_basis);
  const checklists: Record<string, GeneratedResume["jd_match_checklist"]> = { ...existingChecklists };
  const atsScores: Record<string, number> = {};
  const atsGaps: Record<string, string[]> = {};

  for (const lang of languages) {
    const resumeContent = editedResumeDraft[lang];
    if (!resumeContent) continue;

    const scored = await scoreResumeAgainstJd({
      supabase,
      userId,
      jd: application.job_description,
      language: lang,
      resumeContent,
      existingItems: existingChecklists[lang] ?? [],
      previousResume: basis.resume[lang] ?? null,
    });

    checklists[lang] = scored.jd_match_checklist;
    atsScores[lang] = scored.ats_score;
    atsGaps[lang] = scored.ats_gaps;
    basis.resume[lang] = resumeContent;
  }

  const { error: updateError } = await supabase
    .from("applications")
    .update({
      resume_draft: editedResumeDraft,
      jd_match_checklist: checklists,
      ats_score: averageScore(atsScores),
      ats_gaps: atsGaps,
      score_basis: basis,
    })
    .eq("id", applicationId)
    .eq("user_id", userId);

  if (updateError) throw new Error(`儲存評分結果失敗：${updateError.message}`);
}

function buildUserPrompt(params: {
  jd: string;
  language: string;
  sourceLanguage: string;
  entries: ExperienceEntryRow[];
  profile: unknown;
}): string {
  const languageRules = [
    params.language === "en" ? EN_RULES : params.language === "zh" ? ZH_RULES : null,
    params.sourceLanguage !== params.language ? ZH_TO_EN_RULES : null,
  ].filter(Boolean);

  return [
    `目標職缺語言版本：${params.language}`,
    ...languageRules,
    `===== JD =====`,
    params.jd,
    `===== 使用者經歷資料庫（${params.sourceLanguage}）=====`,
    JSON.stringify(params.entries, null, 2),
    `===== 使用者個人資料 =====`,
    // 排版設定跟寫履歷無關，不給 AI 看。
    JSON.stringify({ ...(params.profile as Record<string, unknown>), resume_layout: undefined }, null, 2),
  ].join("\n\n");
}

function parseJsonResponse<T>(text: string): T {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "");

  try {
    return JSON.parse(cleaned) as T;
  } catch {
    throw new Error("AI 回傳的內容不是有效的 JSON，解析失敗");
  }
}
