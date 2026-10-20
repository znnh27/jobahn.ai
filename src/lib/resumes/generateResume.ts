import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { askClaude } from "@/lib/ai/askClaude";
import { BULLET_RULES } from "@/lib/experience/bulletRules";
import { computeAtsScore, type JdImportance } from "./atsScore";
import { resolveJdItems, type JdBaseItem } from "./jdChecklist";
import { readContact, type ResumeContact } from "./contact";
import { normalize, readBackground, type LanguageBackground } from "./background";
import { ensureBackgroundLanguage } from "./translateBackground";
import { resolveMetrics } from "./typography";
import {
  BODY_PT_MAX,
  BODY_PT_STEP,
  readLayoutDefaults,
  readLayoutSettings,
  type ResumeLayoutSettings,
} from "./typography";
import { toFullWidthPunctuation } from "@/lib/text/fullWidthPunctuation";
import { toTraditional } from "@/lib/text/toTraditional";

const SUMMARY_RULES = `Professional Summary 寫作規則（一定要遵守）：
1. 先看 JD 最重視的 1-2 項核心能力/條件，從經歷資料庫裡挑選跟這些條件最相關的主題與成就來寫，其餘經歷不用勉強塞進來湊滿。
2. 用綜合陳述寫成一段話，不是把 bullet 條列拼接起來；控制在 3-4 句話內。
3. 第一句定位使用者的核心優勢/專業定位，中間 1-2 句呼應 JD 最看重的能力並帶出經歷資料庫裡的具體佐證（能帶量化成果就帶），最後視情況一句帶出跟這個職缺/領域的契合度。
4. 禁止空泛形容詞堆疊（例如「passionate」「driven」「results-oriented」單獨出現卻沒有具體事實撐著），每個特質描述都要有實際內容佐證，不能只是形容詞。
5. 不要直接重複 work_experience 裡已經寫的 bullet 原句，用更高層次的方式歸納主題，避免跟下面內容重疊感太重。
6. 一樣要降低 AI 感、避免堆疊術語，寫得像人類自然會寫的用詞。
7. 使用者資料裡的 summaries 是他自己以前寫過的 Summary，用來理解他怎麼定位自己、有哪些可以拿來寫的事實，不要整段照抄；事實一樣不能超出經歷資料庫和這些 Summary 裡有的內容。`;

// bullet 本身的寫法用經歷資料庫共用的那一份規則（lib/experience/bulletRules.ts），
// 這裡只補「挑內容、排一份履歷」才需要的規則。
const WRITING_RULES = `${BULLET_RULES}

排履歷的規則（一定要遵守）：
1. 規則 6 的「依目標 JD 決定留不留」：這次的目標 JD 就是下面給的 JD。
2. 先依這份 JD 把經歷資料庫裡的經歷分成「主要經歷」（跟 JD 直接相關）和「次要經歷」（跟 JD 沒那麼直接、但能展現能力）。每段經歷的 bullet 依跟 JD 的相關度排序，最相關的放最前面。
3. 履歷一定要剛好填滿一頁 A4，少於一頁會讓人覺得經歷太少：主要經歷優先放、bullet 放好放滿；主要經歷都放完了還不滿一頁，就接著放次要經歷。真的放不下才取捨，優先拿掉跟這份 JD 關聯度最低的內容（通常是最舊、或最不相關的次要經歷），不要每一句都砍幾個字讓全部內容都變得倉促。
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
4. role、period、location、學歷、技能、語言能力也都要轉成英文。`;

// 反過來：使用者只有英文經歷（例如只上傳了英文履歷）時，中文版改從英文經歷重寫。
// 以前只有中→英的退路，只有英文資料的人產出的中文履歷會整份沒有經歷。
const EN_TO_ZH_RULES = `來源轉換規則（這次的經歷資料庫是英文，但要產出中文版履歷）：
1. 不是逐句翻譯，而是依中文履歷慣例重寫，用台灣用語。事實和數字不能改，只改寫法。
2. 避免翻譯腔，例如不要把 "Led" 一律翻成「帶領」、不要寫「透過……，成功地……」這種長串修飾。
3. "org" 欄位跟 org_name 一字不改（外商、英文公司名在中文履歷裡本來就常保留英文）。
4. role、period、location、學歷、技能、語言能力轉成中文寫法；專有名詞、產品名、工具名保留英文。`;

export const COVERAGE_RULES =`JD 符合度清單的判定標準（務必嚴格遵守，這是評分結果每次跑出來不一致的主要原因，要特別小心）：
1. covered 只有在內容裡有「明確、具體、可以直接指認」的事實對應到這個 JD 項目時，才標記 true。單純「產業相關」、「性質類似」、「可以類推應該也做得到」都不算，一律標記 false。
2. 領域/類型不同不能算通過。例如 JD 要求「數位/軟體產品的 0 到 1 經驗」，如果內容寫的是實體門市的展店專案，不算 covered，要在缺口說明清楚差在「產品類型不同」，不要含糊帶過。
3. 每次判斷同一個項目，都要用同一套標準重新逐項檢查：先問「這句話有沒有字面上或近乎字面上支持這個要求」，不要憑整體印象覺得「這個人應該做得到」就標 true，也不要因為前一次判斷是 true 就傾向維持 true（或反過來），每次都要重新看內容本身。
4. 如果只是職務相近、可以類推、但沒有具體事實佐證，一律標 false，並在缺口裡具體寫出缺的是什麼，不要寫模稜兩可的描述。`;

const SYSTEM_PROMPT = `你是履歷客製化助手。使用者會給你：這個職缺的 JD、使用者的經歷資料庫、使用者過去寫過的 Summary 跟學歷、技能、語言能力。

經歷資料庫的結構說明：每筆經歷（同一家公司同一個職位）底下的 achievements 是「同一件事的不同寫法」分組——同一個 achievement 底下的每個 variant 講的是同一件真實的事，只是措辭角度不同，variant.angleLabel 標註這個寫法強調的重點（例如「強調數據分析」「強調從 0 到 1 實作」）。同一個 achievement 底下的多個 variant 不是好幾件不同的事，不要當成好幾條 bullet 分別寫進履歷。

你的任務：分析 JD 要求哪些條件，針對每個要放進履歷的 achievement，從它底下的 variant 裡挑一個角度最貼近 JD 的當作事實依據，再照下面的寫作規則寫成這份履歷的 bullet，合併成一份完整履歷（Professional Summary、工作經歷、領導經驗/專案、學歷、技能、語言能力）。

學歷、技能、語言能力：
1. education、languages 照使用者資料一字不改照抄全部項目，校名、科系、輔修都不能改寫或翻譯（系統也會直接用使用者資料覆蓋）。
2. skills 從使用者的技能裡挑跟這份 JD 相關的放前面，跟 JD 完全無關、又佔版面的可以拿掉；每一項都要跟使用者資料裡的寫法一字不差，不能加使用者資料裡沒有的技能。語言能力不要放進 skills。
3. 使用者資料裡沒有 languages 就給空陣列。

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
  "skills": string[],
  "languages": string[]
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
    /** 語言能力，例如「German (B2)」。舊的履歷沒有這個欄位。 */
    languages?: string[];
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

  // JD 條件清單只拆一次，各語言共用（見 jdChecklist.ts）。
  const sharedItems = await resolveJdItems({
    supabase,
    userId,
    applicationId,
    jd: application.job_description,
    stored: existingChecklists,
  });

  const layoutDefaults = readLayoutDefaults(profile?.data);
  const resumeDraft: Record<string, GeneratedResume["resume"]> = {};
  const checklists: Record<string, GeneratedResume["jd_match_checklist"]> = {};
  const atsScores: Record<string, number> = {};
  const atsGaps: Record<string, string[]> = {};

  for (const lang of languages) {
    let langEntries = (entries as ExperienceEntryRow[]).filter((e) => e.language === lang);
    let sourceLanguage = lang;
    // 這個語言沒有經歷資料時，改用另一個語言的經歷重寫（中→英、英→中都要有）。
    if (langEntries.length === 0) {
      const other = lang === "en" ? "zh" : "en";
      langEntries = (entries as ExperienceEntryRow[]).filter((e) => e.language === other);
      sourceLanguage = other;
    }

    // 這個語言還沒有學歷、技能、語言能力就先從另一個語言翻好存起來（只翻一次），
    // 生成出來的學歷、語言能力一律照這份一字不改（pinBackground）。
    const background = await ensureBackgroundLanguage({ supabase, userId, language: lang === "zh" ? "zh" : "en" });
    const pin = (r: Resume) => pinBackground(r, background);

    const userPrompt = buildUserPrompt({
      jd: application.job_description,
      language: lang,
      sourceLanguage,
      entries: langEntries,
      profile: profile?.data ?? {},
      background: withReferenceSummaries(background, profile?.data),
    });

    const response = await askClaude({
      userId,
      feature: "resume_generate",
      systemPrompt: SYSTEM_PROMPT,
      userPrompt,
      maxTokens: 8000,
      supabase,
    });

    const resume = pin(parseJsonResponse<GeneratedResume["resume"]>(response.text));
    if (lang === "zh") polishChinese(resume);
    // 經歷資料庫調過字級／上下間距的話，新履歷直接用那個設定。
    const defaultLayout = layoutDefaults[lang as "zh" | "en"];
    if (defaultLayout) resume.layout = defaultLayout;
    // 用下載時同一套排版量，調到剛好一頁：沒填滿就補內容、超出就拿掉最不相關的。
    resumeDraft[lang] = await fitOnePage({
      supabase,
      userId,
      lang,
      resume,
      contact: readContact(profile?.data),
      basePrompt: userPrompt,
      entries: langEntries,
      pin,
    });
    const filled = resumeDraft[lang];

    // 檢查清單／評分一律走同一個評分函式（跟 rescore 共用），不要讓生成當下的評分
    // 跟之後 rescore 用不同的 prompt 各自判斷，否則同一份內容兩次評分結果會兜不起來。
    const scored = await scoreResumeAgainstJd({
      supabase,
      userId,
      jd: application.job_description,
      language: lang,
      resumeContent: filled,
      items: itemsForLanguage(existingChecklists[lang], sharedItems),
      previousJudgments: [],
      // 整份重新生成，內容全換了，不拿上一版比對，每一項都重新判斷。
      previousResume: null,
    });
    checklists[lang] = scored.jd_match_checklist;
    atsScores[lang] = scored.ats_score;
    atsGaps[lang] = scored.ats_gaps;
    basis.resume[lang] = filled;
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

const SCORE_SYSTEM_PROMPT = `你是履歷跟 JD 的比對助手。使用者會給你 JD、一份固定的 JD 條件清單、跟一份履歷內容。你不打分數（分數由系統照公式算），只負責判斷每一項條件有沒有寫到。

1. 清單是固定的：item 文字跟 importance 一律照抄，不能改寫、新增、刪除、合併項目，每一項都要判斷。舊清單如果 importance 是 null，這次依 JD 補上（JD 寫成硬性要求的是 "required"，寫 preferred / nice to have / 加分的是 "preferred"），之後就固定。
2. 每一項判斷 covered（有沒有寫到），source 有寫到填 "resume"，沒寫到填 null。
3. 沒寫到的項目，gap 要寫得具體、可以照著做：缺的是什麼具體事實、使用者現有經驗跟這項要求差在哪（例如產品類型不同、年資不夠、只有協助沒有主導）、可以怎麼補（挖掘哪一類經驗寫進履歷，或留到求職信說明）。有寫到的 gap 是 null。gap 一律用繁體中文。
   範例：item「2 年以上主導數位產品規劃經驗（AI、大數據相關尤佳）」→ gap「缺乏 2 年以上主導 AI、大數據或演算法相關數位產品的具體事實；現有經驗是電商網站改版與實體活動企劃，產品類型不同，現職年資也還不到 2 年。如果有做過跟資料分析、推薦或自動化相關的功能，可以挖出來寫成一條；沒有的話在求職信說明轉換動機。」
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
    `語言：${(r.languages ?? []).join(", ")}`,
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
  /** 這次要判斷的 JD 條件（固定的題目，AI 不能改）。 */
  items: JdBaseItem[];
  /** 上次的判斷，只有在有 previousResume、要比對差異時才會用到。 */
  previousJudgments: GeneratedResume["jd_match_checklist"];
  /** 上次評分時的履歷。跟這次一模一樣就不呼叫 AI；不一樣就只把差異告訴 AI。 */
  previousResume: Resume | null;
}): Promise<Pick<GeneratedResume, "jd_match_checklist" | "ats_score" | "ats_gaps">> {
  const previous = params.previousResume ? params.previousJudgments : [];
  const previousByItem = new Map(previous.map((i) => [i.item.trim(), i]));
  const hasAllJudgments =
    params.items.length > 0 && params.items.every((i) => i.importance && previousByItem.has(i.item.trim()));

  let items: GeneratedResume["jd_match_checklist"];
  if (params.previousResume && hasAllJudgments && sameResume(params.previousResume, params.resumeContent)) {
    // 內容完全沒改：直接沿用上次的判斷，分數一定一樣。
    items = params.items.map((i) => previousByItem.get(i.item.trim())!);
  } else {
    const diff = previous.length > 0 ? diffLines(params.previousResume!, params.resumeContent) : null;
    const userPrompt = [
      `===== JD =====`,
      params.jd,
      previous.length > 0
        ? `===== JD 條件清單跟上次的判斷（item、importance 照抄）=====\n${JSON.stringify(
            params.items.map(({ item, importance }) => {
              const p = previousByItem.get(item.trim());
              return { item, importance, covered: p?.covered ?? false, source: p?.source ?? null, gap: p?.gap ?? null };
            }),
            null,
            2,
          )}`
        : `===== JD 條件清單（item、importance 照抄）=====\n${JSON.stringify(params.items, null, 2)}`,
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
    items = lockItems(params.items, previousByItem, parsed.jd_match_checklist);
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
 * 條件文字跟必要/加分由程式鎖住（AI 偶爾會改寫條件文字或多列一項）：
 * 照固定清單的順序，用條件文字對回 AI 這次的判斷；AI 漏掉的項目沿用上次的判斷，沒有上次就當沒寫到。
 */
function lockItems(
  base: JdBaseItem[],
  previousByItem: Map<string, JdChecklistItem>,
  fresh: GeneratedResume["jd_match_checklist"],
): GeneratedResume["jd_match_checklist"] {
  const normalize = (item: JdChecklistItem): JdChecklistItem => ({
    item: item.item,
    importance: item.importance === "preferred" ? "preferred" : "required",
    covered: !!item.covered,
    source: item.covered ? "resume" : null,
    gap: item.covered ? null : (item.gap ?? null),
  });
  const byItem = new Map(fresh.map((i) => [i.item.trim(), i]));
  return base.map((b) => {
    const key = b.item.trim();
    // AI 這次漏判或把條件文字改掉了，就沿用上次的判斷。
    const judged = byItem.get(key) ?? previousByItem.get(key) ?? { item: b.item, covered: false, source: null, gap: null };
    return normalize({
      ...judged,
      item: b.item,
      // 清單已經有 importance 就固定用清單的；舊資料沒有才用這次 AI 補的。
      importance: b.importance ?? judged.importance,
    });
  });
}

/** 這個語言已經有清單就沿用它（舊應徵的中英文清單可能不同，不去動）；沒有就用共用清單。 */
function itemsForLanguage(
  stored: GeneratedResume["jd_match_checklist"] | undefined,
  shared: JdBaseItem[],
): JdBaseItem[] {
  if (stored && stored.length > 0) return stored.map((i) => ({ item: i.item, importance: i.importance ?? null }));
  return shared;
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
  let sharedItems: JdBaseItem[] | null = null;

  for (const lang of languages) {
    const resumeContent = editedResumeDraft[lang];
    if (!resumeContent) continue;
    // 正常情況生成時就有清單了；萬一沒有（例如舊資料），才去拆一次，各語言共用。
    if (!existingChecklists[lang]?.length && !sharedItems) {
      sharedItems = await resolveJdItems({
        supabase,
        userId,
        applicationId,
        jd: application.job_description,
        stored: existingChecklists,
      });
    }

    const scored = await scoreResumeAgainstJd({
      supabase,
      userId,
      jd: application.job_description,
      language: lang,
      resumeContent,
      items: itemsForLanguage(existingChecklists[lang], sharedItems ?? []),
      previousJudgments: existingChecklists[lang] ?? [],
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

/** 一頁要填到這個比例才算滿；不到就補內容，經歷資料庫用完了就放大排版。 */
const TARGET_FILL_RATIO = 0.92;
/** 補內容最多幾輪。 */
const FILL_ROUNDS = 3;

/**
 * 生成完用下載時同一套程式排 PDF 量版面，調到剛好一頁：
 * - 第一頁用不到 92%：請 AI 從經歷資料庫補內容（先主要經歷、再次要經歷），告訴它大約還剩幾行，
 *   最多補三輪；補完超出一頁就丟掉那一版、下一輪只補一半。
 * - 經歷資料庫的內容都用完了還不滿：放寬間距、放大內文字級，直到剛好一頁。
 * - 超出一頁：請 AI 拿掉跟 JD 最不相關的內容，告訴它要拿掉幾行（最多兩輪）。
 *   還是超出就留超出最少的那版，畫布上會照常顯示超出一頁的提示。
 */
async function fitOnePage(params: {
  supabase: SupabaseClient;
  userId: string;
  lang: string;
  resume: Resume;
  contact: ResumeContact;
  /** 生成時的完整 prompt（JD、經歷資料庫、個人資料），調整時沿用。 */
  basePrompt: string;
  /** 這次生成用的經歷資料庫，用來判斷還有沒有內容可以補。 */
  entries: ExperienceEntryRow[];
  /** AI 改完的版本一樣要把學歷、技能、語言換回經歷資料庫的寫法。 */
  pin: (r: Resume) => Resume;
}): Promise<Resume> {
  const { measureResumePdf } = await import("@/lib/documents/measureResumePdf");
  const { BODY_WIDTH_PT } = await import("@/lib/documents/ResumePdfDocument");
  const measure = (r: Resume) => measureResumePdf({ contact: params.contact, resume: r, language: params.lang });
  const metrics = resolveMetrics(params.lang, params.resume.layout);
  const contentHeight = 841.89 - 36 * 2;
  const charsPerLine =
    params.lang === "zh"
      ? `中文大約 ${Math.floor(BODY_WIDTH_PT / metrics.body)} 個字`
      : `英文大約 ${Math.floor(BODY_WIDTH_PT / (metrics.body * 0.5))} 個字元`;

  const ask = async (resume: Resume, task: string[]): Promise<Resume | null> => {
    const response = await askClaude({
      userId: params.userId,
      feature: "resume_fit_page",
      systemPrompt: SYSTEM_PROMPT,
      userPrompt: [
        params.basePrompt,
        `===== 目前的履歷 =====`,
        JSON.stringify({ ...resume, layout: undefined }, null, 2),
        `===== 這次要做的事 =====`,
        ...task,
        `- 不能編造經歷資料庫裡沒有的事實。`,
        `- 輸出整份履歷（格式跟原本完全一樣），不是只輸出改動的部分。`,
      ].join("\n\n"),
      maxTokens: 8000,
      supabase: params.supabase,
    });
    try {
      const next = params.pin(parseJsonResponse<Resume>(response.text));
      if (params.lang === "zh") polishChinese(next);
      next.layout = resume.layout;
      return next;
    } catch {
      return null;
    }
  };

  let current = params.resume;
  let fit;
  try {
    fit = await measure(current);
  } catch {
    return current; // 量不到版面就不調，不影響生成。
  }

  // 超出一頁：拿掉最不相關的內容。
  for (let round = 0; fit.pages > 1 && round < 2; round++) {
    const cutLines = Math.ceil(fit.overflowPt / metrics.line) + 1;
    const next = await ask(current, [
      `這份履歷超出一頁 A4 大約 ${cutLines} 行（每行${charsPerLine}）。請拿掉至少 ${cutLines} 行的內容，讓它剛好一頁：`,
      `- 優先整條拿掉跟 JD 最不相關的 bullet；還不夠再拿掉最舊、最不相關的經歷。`,
      `- 不要把每一句都砍幾個字，剩下的內容原則上不要改寫。`,
    ]);
    if (!next) break;
    const nextFit = await measure(next).catch(() => null);
    if (!nextFit) break;
    if (nextFit.pages < fit.pages || nextFit.overflowPt < fit.overflowPt) {
      current = next;
      fit = nextFit;
    } else {
      break;
    }
  }
  if (fit.pages > 1) return current;

  // 一頁沒填滿：分幾輪從經歷資料庫補內容，先補主要經歷、再補次要經歷（留 2 行緩衝，避免剛好擠到第二頁）。
  // 補完超出一頁就丟掉那一版，下一輪只要求補一半的行數。
  let askLines = spareLinesOf(fit.fillRatio);
  for (let round = 0; fit.fillRatio < TARGET_FILL_RATIO && round < FILL_ROUNDS && askLines > 0; round++) {
    if (dbExhausted(current, params.entries)) break;
    const expanded = await ask(current, [
      `這份履歷只用了一頁 A4 的 ${Math.round(fit.fillRatio * 100)}%，下面還空著大約 ${askLines} 行（每行${charsPerLine}）。履歷一定要填滿一頁，少於一頁會讓人覺得經歷太少。請從經歷資料庫補上大約 ${askLines} 行的內容，不能超過：`,
      `- 先把經歷資料庫裡的經歷依這份 JD 分成主要（跟 JD 直接相關）和次要。主要經歷裡還沒寫進履歷的 bullet 先補；主要經歷都放完了，就補次要經歷（整段經歷沒放進來的也要加進來）。`,
      `- 這一步不受每段 bullet 條數上限的限制。`,
      `- 已經寫好的內容原則上不要改，只新增。`,
    ]);
    if (!expanded) break;
    const after = await measure(expanded).catch(() => null);
    if (!after) break;
    if (after.pages > 1) {
      askLines = Math.floor(askLines / 2);
      continue;
    }
    if (after.fillRatio <= fit.fillRatio) break;
    current = expanded;
    fit = after;
    askLines = spareLinesOf(fit.fillRatio);
  }
  if (fit.fillRatio >= TARGET_FILL_RATIO) return current;

  // 經歷資料庫的內容都用完了還是不滿一頁：一步步放寬間距、放大字級，挑還在一頁內、最滿的那個。
  return enlargeToFill(current, params.lang, fit.fillRatio, measure);

  function spareLinesOf(fillRatio: number) {
    return Math.max(0, Math.floor(((1 - fillRatio) * contentHeight) / metrics.line) - 2);
  }
}

/** 經歷資料庫裡的經歷段數、事件數都已經全放進履歷了，沒東西可以補。 */
function dbExhausted(resume: Resume, entries: ExperienceEntryRow[]): boolean {
  const sections = [...(resume.work_experience ?? []), ...(resume.leadership ?? [])];
  const bullets = sections.reduce((n, e) => n + (e.bullets?.length ?? 0), 0);
  const achievements = entries.reduce((n, e) => n + (Array.isArray(e.achievements) ? e.achievements.length : 0), 0);
  return sections.length >= entries.length && bullets >= achievements;
}

/**
 * 試每一種「間距（目前的／寬鬆）× 內文字級（目前的到上限，每次 +0.5pt）」，量 PDF，
 * 挑還在一頁內、填得最滿的那一個。量 PDF 是本機排版、不呼叫 AI，全部試一遍也只要幾秒。
 */
async function enlargeToFill(
  resume: Resume,
  lang: string,
  fillRatio: number,
  measure: (r: Resume) => Promise<{ pages: number; fillRatio: number }>,
): Promise<Resume> {
  const layout = readLayoutSettings(resume.layout, lang);
  const spacings: ResumeLayoutSettings["spacing"][] = layout.spacing === "loose" ? ["loose"] : [layout.spacing, "loose"];
  let best = resume;
  let bestFill = fillRatio;
  for (const spacing of spacings) {
    for (let bodyPt = layout.bodyPt; bodyPt <= BODY_PT_MAX; bodyPt += BODY_PT_STEP) {
      if (spacing === layout.spacing && bodyPt === layout.bodyPt) continue;
      const trial = { ...resume, layout: { ...layout, spacing, bodyPt } };
      const fit = await measure(trial).catch(() => null);
      // 同一種間距，字再放大只會更長，超出一頁就不用再試更大的字。
      if (!fit || fit.pages > 1) break;
      if (fit.fillRatio > bestFill) {
        best = trial;
        bestFill = fit.fillRatio;
      }
    }
  }
  return best;
}

function buildUserPrompt(params: {
  jd: string;
  language: string;
  sourceLanguage: string;
  entries: ExperienceEntryRow[];
  profile: unknown;
  background: LanguageBackground;
}): string {
  const languageRules = [
    params.language === "en" ? EN_RULES : params.language === "zh" ? ZH_RULES : null,
    params.sourceLanguage === "zh" && params.language === "en" ? ZH_TO_EN_RULES : null,
    params.sourceLanguage === "en" && params.language === "zh" ? EN_TO_ZH_RULES : null,
  ].filter(Boolean);

  const profile = (params.profile ?? {}) as Record<string, unknown>;

  return [
    `目標職缺語言版本：${params.language}`,
    ...languageRules,
    `===== JD =====`,
    params.jd,
    `===== 使用者經歷資料庫（${params.sourceLanguage}）=====`,
    JSON.stringify(params.entries, null, 2),
    `===== 使用者的 Summary、學歷、技能、語言能力 =====`,
    JSON.stringify(params.background, null, 2),
    `===== 使用者其他個人資料 =====`,
    // 排版設定跟寫履歷無關，不給 AI 看；background 上面已經給過了。
    // 這裡可能還留著舊版上傳時存的學歷、技能（格式不固定），上面沒有的話可以參考這裡。
    JSON.stringify({ ...profile, resume_layout: undefined, background: undefined }, null, 2),
  ].join("\n\n");
}

/** 這個語言還沒有自己的 Summary 時，拿另一個語言的當參考（Summary 只是素材，不會照抄）。 */
function withReferenceSummaries(background: LanguageBackground, profile: unknown): LanguageBackground {
  if (background.summaries.length > 0) return background;
  const all = readBackground(profile);
  return { ...background, summaries: [...all.zh.summaries, ...all.en.summaries] };
}

/**
 * 學歷、語言能力照經歷資料庫一字不改（AI 會「潤飾」科系名稱，使用者不要這樣）；
 * 技能讓 AI 依 JD 挑選排序，但只留經歷資料庫裡有的、換回資料庫的原字。
 * 經歷資料庫還沒有這些資料（舊帳號沒重新上傳）時，維持 AI 從舊資料整理出來的內容。
 */
function pinBackground(resume: Resume, background: LanguageBackground): Resume {
  if (background.education.length > 0) {
    resume.education = background.education.map((e) => ({
      school: e.school,
      detail: e.detail,
      period: e.period ?? "",
      location: e.location,
    }));
  }
  if (background.languages.length > 0) resume.languages = [...background.languages];
  if (background.skills.length > 0) {
    const byKey = new Map(background.skills.map((skill) => [normalize(skill), skill]));
    const picked = [...new Set((resume.skills ?? []).map((skill) => byKey.get(normalize(skill))))].filter(
      (skill): skill is string => !!skill,
    );
    resume.skills = picked.length > 0 ? picked : [...background.skills];
  }
  return resume;
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
