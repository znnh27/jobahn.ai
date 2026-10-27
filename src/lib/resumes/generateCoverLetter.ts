import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { askClaude } from "@/lib/ai/askClaude";
import { REMEMBER_RULE, rememberNotes } from "@/lib/ai/userMemory";
import { COVERAGE_RULES, readScoreBasis, type GeneratedResume } from "./generateResume";
import { coveredByResume } from "./atsScore";
import { buildContactLine, pickName, readContact } from "./contact";
import { isCompanyResearchAvailable, researchCompany } from "@/lib/jobs/researchCompany";
import { companyMentionedInJd, searchableCompanyName } from "@/lib/jobs/companyInJd";
import { letterLength, letterLengthUnit } from "@/lib/text/letterLength";
import { toFullWidthPunctuation } from "@/lib/text/fullWidthPunctuation";
import { toTraditional } from "@/lib/text/toTraditional";

type Resume = GeneratedResume["resume"];

// 寫作規則來自作者長期人工修改求職信後整理的寫作準則。
// 例子都換成通用的，不放使用者本人的經歷（這套 prompt 所有使用者共用）。
const COVER_LETTER_RULES = `求職信結構（四段式，篇幅半頁到一頁）：
1. 開頭自我介紹：姓名、目前背景一句話帶過、從哪裡得知這個職缺（資料裡沒有就略過，不要編）、簡短的應徵動機（1 到 2 句）。
2. 應徵動機：為什麼是「這間公司」，不是泛用的「為什麼是這個產業」。有提供公司研究素材時，從裡面挑 1 到 2 個具體、只有這間公司才有的特色（特有的用詞、制度、做法，例如「扁平組織讓新人也能發言」「學徒制文化」「橫跨上百個城市的據點網絡」；不是「創新」「以客戶為中心」這種每間公司都會講的空話），跟使用者的實際經歷或做事風格連結成一句自然的話，不要生硬地並列「公司特色」加「我的特質」。沒有素材、或素材裡找不到夠具體的內容時，改寫以這個職位工作內容為主的動機，絕對不能編造公司特色。
3. 個人亮點：2 到 3 個具體案例，最好對應履歷裡已經寫的內容，用不同的語氣重新敘事（不是逐字複製履歷 bullet），並明確扣回 JD 的資格要求。逐條核對 JD 符合度清單，重要的資格都要在信裡找得到呼應。
   履歷沒寫到、或部分符合的條件，是求職信最該補的地方：到經歷資料庫找有沒有對應的事實（履歷只有一頁，很多經歷沒放進去），有就寫進來；部分符合的照 gap 寫的「缺：○○」優先補缺的那幾件。經歷資料庫也找不到的，才照誠實原則 3 處理。
4. 結尾：感謝對方撥空閱讀、提醒履歷已附上、期待後續機會。聯絡方式由系統接在署名下方，信裡不用再寫。
段落之間不要重複：同一個特質、同一組數字在整封信只出現一次。

誠實原則（最重要）：
1. 每一句都要有履歷或資料裡的事實支撐。不能為了對應 JD 關鍵字編造、誇大，也不能把某個方法或技巧套到錯誤的專案上（方法歸屬錯了跟捏造一樣嚴重）。
2. 不要用「上線」「發布」、launched、released 這類暗示正式產品發表的字眼，除非資料裡明確寫了已經正式上線；個人專案、小範圍測試的產品用「開發」「實測」這類中性說法。
3. JD 要求、但使用者完全沒有相關經歷的，不要假裝有。可以在結尾段誠實承認，用展現熱情、期待成長的語氣（例如「這正是吸引我的地方，我期待在這樣的環境裡快速學習」），不要用消極被動的語氣（例如「這點我心裡有數，也做好了準備」）。
4. 團隊合作、獨立作業這類特質有時是互斥的重點，每次都要看這份 JD 實際要的是什麼再決定強調哪一個，而且只能寫資料裡看得出來的特質，不能憑空推論。
5. 如果要用「使用者正在開發一個 AI 工具」這件事當佐證去補缺口，只能提到「有在開發一個 AI 工具」這個事實本身，絕對不要描述這個工具的細節、功能、或用途。

語氣與格式（中英共用）：
1. 英文用 "Dear Hiring Manager," 開頭，中文用「招聘主管您好，」開頭。
2. 不用破折號（em-dash「—」，中文破折號也不用），改用逗號、分號，或拆成兩句。
3. 避免 AI 感：不用三個以上的形容詞或動詞堆疊當句子骨架，不用三項並列湊字數，不用聽起來像模板的業務套話（例如 "I'd love to put my skills to work for your clients"）。用平實、直接、像真人會講的話寫。
4. 不要把 JD 原文的關鍵字直接放在句子開頭當宣稱（例如「我擅長假設驅動的問題解決」），要讓這個能力從具體案例的敘述裡自然浮現。
5. 一個句子講一件事，太長就拆成兩句，不要把因果關係、時間順序全部揉在同一句。
6. 非技術職缺不用過度技術化的詞，換成一般人看得懂的說法。
7. 同一個資訊（例如某段經歷的公司名稱、某個特質）在同一段裡不要出現兩次。`;

const SYSTEM_PROMPT = `你是求職信寫作助手。使用者會給你：JD、已經定案的履歷內容、使用者的經歷資料庫（履歷沒放進去的經歷跟成就也在裡面）、JD 符合度清單（標記履歷還缺少哪些條件），有時還有剛上網查到的公司研究素材。

你的任務：寫一封求職信，語氣自然、針對這個職缺客製化，用經歷資料庫裡、履歷沒放進去的事實，補上 JD 有列出但履歷沒寫到的條件跟特質。

${COVER_LETTER_RULES}

結尾敬語（例如 "Sincerely,"、「敬祝 順心」）的下一行，只寫 {{SIGNATURE}} 這個記號，不要寫任何名字，系統會自動換成使用者的名字跟聯絡方式。

只輸出求職信本文（含開頭問候與署名），不要有其他說明文字、不要用 markdown 包起來。`;

// 只寫「目標語言：zh」時，AI 看到的素材如果是英文履歷，常常會直接沿用英文寫。語言要講清楚。
const LANGUAGE_INSTRUCTION: Record<string, string> = {
  zh: `整封信一律用繁體中文（台灣用語）撰寫。就算下面的履歷素材是英文，也要改寫成中文，不要直接照抄英文；專有名詞、產品名、工具名可以保留英文。
中文額外規則：
1. 全部用全形標點（，。；：「」），不要混用半形逗號、句號。
2. 避免翻譯腔（例如「即使……也是如此」「在……的交會點」），用中文母語者會自然講出的句子結構。
3. 避免不像人話的用詞，例如「早期職涯產品人才」這種硬翻的職稱式開場。
4. 地點、日期格式整封信前後一致，不要中英夾雜。`,
  en: `Write the entire letter in English, even if the resume material below is in Chinese. Rewrite naturally in English instead of translating word for word.
英文額外規則：
1. 自我介紹用自然的英文語序，例如 "I am Alex Chen"，不要用「姓, 名」的名單格式（"I am Chen, Alex"）。
2. 專有名詞、認證縮寫、組織全名要用正確的大小寫跟單複數（例如 iOS 不是 IOS、LinkedIn 不是 Linkedin）。`,
};

// 軟實力、工作條件履歷證明不了、履歷頁也不算分，交給求職信（2026-10-24 Z 定案）。
// 只給這份 JD 自己的條件；工作條件只給使用者在這份應徵按過「可以配合」的（不能讓 AI 自己假設使用者願意配合）。
function traitSection(items: GeneratedResume["jd_match_checklist"]): string | null {
  const traits = items.filter((i) => i.kind === "trait").map((i) => `- ${i.item}`);
  if (traits.length === 0) return null;
  return `===== 這份 JD 要的特質（軟實力，履歷證明不了，交給求職信）=====
履歷或經歷資料庫裡找得到具體事例的特質都要寫到，用事例自然帶出來（例如「主動」就講他自己發起的改善），不要直接寫「我很主動積極」這種形容詞。
可以併進第三段的案例裡，一個案例帶出一兩個特質，不用每個特質各寫一段；有字數上限時，優先寫 JD 寫在前面、事例最有力的。資料裡看不出來的特質不要硬寫。
${traits.join("\n")}`;
}

function conditionSection(items: GeneratedResume["jd_match_checklist"]): string | null {
  const confirmed = items.filter((i) => i.kind === "condition" && i.answer === "yes").map((i) => `- ${i.item}`);
  if (confirmed.length === 0) return null;
  return `===== 使用者確認可以配合的工作條件 =====
在結尾段用一句話自然提到可以配合（能搭配真實佐證就帶上，例如語言能力、海外經驗），不要寫成一段。清單以外的工作條件一律不提。
${confirmed.join("\n")}`;
}

const SIGNATURE_MARK = "{{SIGNATURE}}";

/** 把 {{SIGNATURE}} 換成署名（名字＋聯絡方式）；AI 漏寫記號時接在信尾。 */
function placeSignature(text: string, signature: string): string {
  if (text.includes(SIGNATURE_MARK)) {
    return text.replace(SIGNATURE_MARK, signature).replace(/\n{3,}/g, "\n\n").trimEnd();
  }
  return signature ? `${text}\n${signature}` : text;
}

/** 中文字佔所有字母（中文字＋英文字母）的比例夠高，才算是中文信。 */
function looksChinese(text: string): boolean {
  const cjk = (text.match(/[\u4e00-\u9fff]/g) ?? []).length;
  const latin = (text.match(/[A-Za-z]/g) ?? []).length;
  return cjk > 0 && cjk / (cjk + latin) > 0.5;
}

export interface CoverLetterOptions {
  /** 每個語言的字數上限（中文算字、英文算 words），沒有就不限。 */
  wordLimits: Record<string, number>;
  /** 先上網研究這間公司（需要 FIRECRAWL_API_KEY）。 */
  research: boolean;
}

export interface CoverLetterGenerateInfo {
  /** 有勾研究時：參考了哪些網頁；查不到是空陣列。沒勾研究是 null。 */
  researchSources: string[] | null;
  /** JD 裡沒寫填的公司名稱時，回傳實際拿去搜尋的名稱，畫面上提醒使用者確認信裡的公司是對的。 */
  companyMismatch: string | null;
}

export async function generateCoverLetterForApplication(
  supabase: SupabaseClient,
  userId: string,
  applicationId: string,
  options: CoverLetterOptions,
): Promise<CoverLetterGenerateInfo> {
  const { data: application, error: appError } = await supabase
    .from("applications")
    .select("job_description, company_name, resume_snapshot, cover_letter_language, jd_match_checklist")
    .eq("id", applicationId)
    .eq("user_id", userId)
    .single();

  if (appError || !application) {
    throw new Error(`找不到這筆應徵紀錄：${appError?.message ?? "unknown"}`);
  }

  if (!application.resume_snapshot) {
    throw new Error("履歷還沒定案，請先完成履歷定案再寫求職信");
  }

  const languages: string[] = application.cover_letter_language ?? [];
  if (languages.length === 0) {
    throw new Error("請先選擇求職信語言版本");
  }

  const resumeSnapshot: Record<string, GeneratedResume["resume"]> = application.resume_snapshot;
  const checklist: Record<string, GeneratedResume["jd_match_checklist"]> =
    application.jd_match_checklist ?? {};

  const { data: profile } = await supabase
    .from("profile_data")
    .select("data")
    .eq("user_id", userId)
    .maybeSingle();
  const contact = readContact(profile?.data);

  // 經歷資料庫：履歷只有一頁，很多經歷沒放進去，求職信要補缺口跟軟實力時從這裡找事實。
  // 這個語言還沒有資料時，用另一個語言的。
  const { data: entryRows } = await supabase
    .from("experience_entries")
    .select("language, entry_type, org_name, location, role_variants, period_variants, achievements")
    .eq("user_id", userId);
  const allEntries = (entryRows ?? []) as Array<{ language: string } & Record<string, unknown>>;
  const entryLanguage = (lang: string) =>
    allEntries.some((e) => e.language === lang) ? lang : (allEntries[0]?.language ?? lang);
  const entriesFor = (lang: string) => allEntries.filter((e) => e.language === entryLanguage(lang));

  // JD 裡找不到填的公司名稱（真實發生過：公司名稱填 A 公司，JD 卻貼成 B 公司的職缺），公司研究可能查到別間公司，
  // 這種情況一律不研究，應徵動機只照 JD 寫，並提醒使用者確認公司名稱。
  // JD 沒寫公司名稱很常見（104 的內文常常只有工作內容），不代表填錯：建立應徵時已經提醒過使用者，
  // 這裡照樣研究，只是要求 AI 只用跟 JD 對得上的內容，畫面上也再提醒一次確認公司。
  const companyMismatch =
    companyMentionedInJd(application.company_name, application.job_description) === false
      ? searchableCompanyName(application.company_name ?? "")
      : null;

  // 公司研究每次都重新查（不沿用上一次或別的職缺的資料），各語言版本共用同一份。
  const research =
    options.research && isCompanyResearchAvailable()
      ? await researchCompany(application.company_name ?? "", application.job_description ?? "")
      : null;
  const mismatchNote = companyMismatch
    ? `\nJD 裡沒有寫公司名稱，這份資料是用使用者填的「${companyMismatch}」搜尋的。只用產業、業務、產品跟 JD 工作內容對得上的內容；對不上就當作查錯了，不要用。`
    : "";
  const researchSection = !options.research
    ? `===== 公司研究 =====\n這次沒有查公司資料。第二段（應徵動機）以這個職位的工作內容為主，不要編造公司特色。`
    : research
      ? `===== 公司研究素材（剛上網查的「${searchableCompanyName(application.company_name ?? "")}」相關頁面）=====\n只用明確是在講這間公司的內容；搜尋結果可能混到同名或無關的頁面，看不出來是這間公司的就不要用。${mismatchNote}\n\n${research.material}`
      : `===== 公司研究 =====\n查不到這間公司夠具體的公開資料。第二段（應徵動機）以這個職位的工作內容為主，不要編造公司特色。`;

  const draft: Record<string, string> = {};

  for (const lang of languages) {
    // 求職信語言不一定等於履歷語言，找不到完全對應時就用第一個有的履歷版本當內容依據
    const resumeLang = resumeSnapshot[lang] ? lang : Object.keys(resumeSnapshot)[0];
    const { layout: _layout, ...resume } = resumeSnapshot[resumeLang]; // eslint-disable-line @typescript-eslint/no-unused-vars
    const checklistForResume = checklist[resumeLang] ?? [];
    const name = pickName(contact, lang);
    // 署名＝名字＋聯絡方式（結尾段要附聯絡方式，由程式放，不讓 AI 自己寫，AI 會亂編）。
    const signature = [name, buildContactLine(contact, lang)].filter(Boolean).join("\n");

    // 字數上限扣掉署名的長度，AI 寫的本文才是剩下能用的字數。
    const limit = options.wordLimits[lang];
    const bodyLimit = limit ? Math.max(50, limit - letterLength(signature, lang)) : null;
    const unit = letterLengthUnit(lang);
    const limitInstruction = bodyLimit
      ? `字數上限：信的本文（不含 {{SIGNATURE}}）一定要在 ${bodyLimit} ${unit}以內，${lang === "zh" ? "中文算字數，不含空白" : "count words"}。篇幅縮短時保留四段結構，優先減少第三段的案例數量（留最有力的 1 到 2 個）。`
      : null;

    const userPrompt = [
      LANGUAGE_INSTRUCTION[lang] ?? `目標語言：${lang}`,
      name ? `使用者的名字（開頭自我介紹用）：${name}` : null,
      limitInstruction,
      `===== JD =====`,
      application.job_description,
      `===== 已定案的履歷內容 =====`,
      JSON.stringify(resume, null, 2),
      `===== 使用者經歷資料庫（${entryLanguage(lang)}；履歷沒放進去的事實可以從這裡找，只能用這裡有的事實）=====`,
      JSON.stringify(entriesFor(lang), null, 2),
      `===== JD 符合度清單（逐條核對；尚未涵蓋、部分符合的是求職信要補的地方）=====`,
      JSON.stringify(
        checklistForResume
          .filter((i) => (i.kind ?? "requirement") === "requirement")
          .map((i) => ({
            item: i.item,
            importance: i.importance ?? null,
            covered: coveredByResume(i),
            partial: !coveredByResume(i) && !!i.partial,
            gap: i.gap ?? null,
          })),
        null,
        2,
      ),
      traitSection(checklistForResume),
      conditionSection(checklistForResume),
      researchSection,
    ]
      .filter((part): part is string => part !== null)
      .join("\n\n");

    const ask = (prompt: string) =>
      askClaude({ userId, feature: "cover_letter", systemPrompt: SYSTEM_PROMPT, userPrompt: prompt, maxTokens: 2000, supabase });

    let text = (await ask(userPrompt)).text.trim();
    // 中文版偶爾還是會被英文素材帶著寫成英文，檢查一次，不對就明講再寫一次。
    if (lang === "zh" && !looksChinese(text)) {
      text = (
        await ask(
          `${userPrompt}\n\n注意：你上一次把這封信寫成英文了，這是錯的。這次整封信（包含開頭問候跟結尾敬語）都一定要用繁體中文寫。`,
        )
      ).text.trim();
    }
    // 超過字數上限：告訴 AI 實際寫了多少，請它縮短重寫一次。
    const bodyLength = letterLength(text.replace(SIGNATURE_MARK, ""), lang);
    if (bodyLimit && bodyLength > bodyLimit) {
      text = (
        await ask(
          `${userPrompt}\n\n===== 上一版（太長）=====\n${text}\n\n上一版本文有 ${bodyLength} ${unit}，超過上限 ${bodyLimit} ${unit}。請在保留四段結構、事實不變的前提下縮短到 ${bodyLimit} ${unit}以內，只輸出縮短後的完整求職信。`,
        )
      ).text.trim();
    }

    if (lang === "zh") text = toFullWidthPunctuation(toTraditional(text));
    draft[lang] = placeSignature(text, signature);
  }

  const { error: updateError } = await supabase
    .from("applications")
    // 信換了，上一封信的比對結果就不適用，清掉（頁面會先顯示只算履歷的對照）。
    .update({ cover_letter_draft: draft, cover_letter_checklist: null })
    .eq("id", applicationId)
    .eq("user_id", userId);

  if (updateError) throw new Error(`儲存求職信失敗：${updateError.message}`);

  return { researchSources: options.research ? (research?.sources ?? []) : null, companyMismatch };
}

/**
 * 求職信比對標準：「補充進求職信」寫的時候、「重新比對」判斷的時候用同一套（2026-10-27 Z 要求：
 * 以前補充時寫的能力陳述直接打勾，重新比對卻用另一套標準判掉，補了等於沒補）。
 */
const LETTER_COVERAGE_RULES = `求職信比對標準（補充跟比對共用，補得進去就一定比得到）：
1. 信裡要有一句明確回應這項條件的句子，讀的人一看就知道在講這件事；只沾到邊、要靠推論才連得上的不算。
2. 有具體事例最好；沒有事例時，明確說自己具備這項能力或可以配合這個條件的句子也算（例如「我能以英文獨立進行簡報與合約溝通」「我熟悉用 GA 做成效追蹤分析」），這類句子是使用者自己按「補充」、確認自己具備後才寫進來的。
3. 只表達學習意願、或承認還沒有經驗的句子不算（例如「我還沒有用過 Power BI，期待在工作中補齊」「相信能快速上手」）。
4. kind 是 "trait" 的項目（軟實力）：具體事例，或說明自己怎麼做事的原則句都算（例如「我做事重視規範與原則，遇到灰色地帶會先確認界線再行動」）；只貼形容詞（例如「我積極主動」「我正直誠信」）不算。
5. partial 是 true 的項目：履歷已經涵蓋一部分，gap 寫的「缺：○○」每一件，信裡都要有對應的句子才算；履歷已經有的部分不用再寫一次。
6. 語言程度照後面通用判定標準 7 的對照表。`;

const RECHECK_SYSTEM_PROMPT = `你是求職信比對助手。使用者會給你 JD、幾項「履歷沒寫到的 JD 條件」、跟一封求職信。

你的任務：逐項判斷這封求職信有沒有補上這項條件。判斷要穩定：同一封信每次判斷結果都要一樣。

${LETTER_COVERAGE_RULES}

下面是履歷用的通用判定標準；跟上面的求職信比對標準衝突時，以求職信比對標準為準：

${COVERAGE_RULES}

只輸出 JSON，不要有其他文字、不要用 markdown code fence 包起來。item 文字照抄。輸出格式：
{ "results": [{ "item": string, "covered": boolean, "evidence": string, "reason": string }] }
evidence：covered 是 true 時，從信裡逐字抄出回應這項的那一句（完整一句，一個字都不能改，系統會拿它去信裡比對）；covered 是 false 時給空字串。
reason：covered 是 false 時，用繁體中文一句話說信裡還缺什麼；covered 是 true 時給空字串。`;

type Checklist = GeneratedResume["jd_match_checklist"];

/** 比對句子時忽略空白、換行的差異。 */
const squash = (text: string) => text.replace(/\s+/g, " ").trim();

/**
 * 用求職信比對標準判斷一封信：履歷寫到的固定打勾，履歷沒寫到的交給 AI 判斷信有沒有補上。
 * 回傳這個語言完整的對照清單，跟沒補上的項目各缺什麼。「重新比對」跟「補充進求職信」都用這個。
 *
 * 句子當證據（2026-10-27 Z 要求：補了新的內容，之前補好、一個字都沒動的項目卻被判回沒寫到）：
 * 通過時 AI 要抄出信裡對應的那一句存在 evidence；之後那一句還一字不差留在信裡，就直接維持打勾、不再問 AI。
 * local-cli 模式關不掉 AI 的隨機性，同一句話每次判斷可能不一樣，只有句子被改掉、刪掉的項目才重新判斷。
 */
async function judgeLetterChecklist(params: {
  supabase: SupabaseClient;
  userId: string;
  jobDescription: string;
  resumeItems: Checklist;
  letter: string;
  /** 上一次的對照結果（同一個語言），有證據句子、而且句子還在信裡的項目直接沿用。 */
  previous?: Checklist | null;
}): Promise<{ checklist: Checklist; reasons: Map<string, string> }> {
  const { supabase, userId, jobDescription, resumeItems, letter, previous } = params;
  const flatLetter = squash(letter);
  const inLetter = (sentence: string | null | undefined) => !!sentence && flatLetter.includes(squash(sentence));

  const evidence = new Map<string, string>();
  for (const p of previous ?? []) {
    if (p.covered && p.source === "cover_letter" && inLetter(p.evidence)) evidence.set(p.item.trim(), p.evidence as string);
  }
  const covered = new Set(evidence.keys());
  const reasons = new Map<string, string>();
  const missing = resumeItems.filter((i) => !coveredByResume(i) && !covered.has(i.item.trim()));

  if (missing.length > 0 && letter.trim()) {
    const response = await askClaude({
      userId,
      feature: "jd_recheck",
      systemPrompt: RECHECK_SYSTEM_PROMPT,
      userPrompt: [
        `===== JD =====`,
        jobDescription,
        `===== 履歷沒寫到的 JD 條件 =====`,
        JSON.stringify(
          missing.map((i) => ({ item: i.item, kind: i.kind ?? "requirement", partial: !!i.partial, gap: i.partial ? i.gap : null })),
          null,
          2,
        ),
        `===== 求職信內容 =====`,
        letter,
      ].join("\n\n"),
      maxTokens: 2000,
      temperature: 0,
      supabase,
    });
    const parsed = JSON.parse(
      response.text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, ""),
    ) as { results: { item: string; covered: boolean; evidence?: string; reason?: string }[] };
    for (const r of parsed.results) {
      const item = r.item.trim();
      if (r.covered) {
        covered.add(item);
        // 抄錯字、找不到的句子不存，下次這項會再判斷一次。
        if (inLetter(r.evidence)) evidence.set(item, (r.evidence as string).trim());
      } else if (r.reason) reasons.set(item, toTraditional(r.reason));
    }
  }

  const checklist = resumeItems.map((i) => {
    if (coveredByResume(i)) return { ...i, covered: true, source: "resume" as const };
    const byLetter = covered.has(i.item.trim());
    return {
      ...i,
      covered: byLetter,
      source: byLetter ? ("cover_letter" as const) : null,
      evidence: byLetter ? (evidence.get(i.item.trim()) ?? null) : null,
    };
  });
  return { checklist, reasons };
}

/**
 * 求職信頁的 JD 條件對照：履歷＋求職信合起來算。
 * - 履歷已經定案，履歷寫到的項目直接固定打勾，不再讓 AI 重判。
 * - AI 只判斷「履歷沒寫到的項目，求職信有沒有補上」。
 * - 這封信跟上次比對時一模一樣，就直接沿用上次的結果，不呼叫 AI。
 * 結果存在 cover_letter_checklist，不動履歷頁用的 jd_match_checklist。
 */
export async function recheckJdMatchWithCoverLetter(
  supabase: SupabaseClient,
  userId: string,
  applicationId: string,
  editedCoverLetterDraft: Record<string, string>,
): Promise<Record<string, Checklist>> {
  const { data: application, error: appError } = await supabase
    .from("applications")
    .select("job_description, resume_snapshot, jd_match_checklist, cover_letter_checklist, cover_letter_language, score_basis")
    .eq("id", applicationId)
    .eq("user_id", userId)
    .single();

  if (appError || !application) {
    throw new Error(`找不到這筆應徵紀錄：${appError?.message ?? "unknown"}`);
  }

  const resumeSnapshot: Record<string, GeneratedResume["resume"]> = application.resume_snapshot ?? {};
  const resumeChecklists: Record<string, Checklist> = application.jd_match_checklist ?? {};
  const previous: Record<string, Checklist> = application.cover_letter_checklist ?? {};
  const basis = readScoreBasis(application.score_basis);
  const languages: string[] = application.cover_letter_language ?? [];
  const updated: Record<string, Checklist> = { ...previous };

  for (const lang of languages) {
    const resumeLang = resumeSnapshot[lang] ? lang : Object.keys(resumeSnapshot)[0];
    const coverLetter = editedCoverLetterDraft[lang] ?? "";
    if (previous[lang] && basis.cover_letter[lang] === coverLetter) continue;

    const { checklist } = await judgeLetterChecklist({
      supabase,
      userId,
      jobDescription: application.job_description,
      resumeItems: resumeChecklists[resumeLang] ?? [],
      letter: coverLetter,
      previous: previous[lang],
    });
    updated[lang] = checklist;
    basis.cover_letter[lang] = coverLetter;
  }

  const { error: updateError } = await supabase
    .from("applications")
    .update({ cover_letter_draft: editedCoverLetterDraft, cover_letter_checklist: updated, score_basis: basis })
    .eq("id", applicationId)
    .eq("user_id", userId);

  if (updateError) throw new Error(`儲存重新比對結果失敗：${updateError.message}`);

  return updated;
}

const REVISE_SYSTEM_PROMPT = `你是求職信修改助手。使用者會給你：JD、已經定案的履歷內容、目前的求職信，跟一句想怎麼改的要求。

照使用者的要求修改目前的求職信，修改時一樣要遵守下面的寫作規則：

${COVER_LETTER_RULES}

修改規則：
1. 沒被要求的地方原則上不要動；被要求改一段，就只改那一段。
2. 只能用履歷、JD 裡有的事實。要求加的內容資料裡沒有，就不要編，在 reply 說明缺什麼、建議怎麼補。
3. 信裡的 {{SIGNATURE}} 記號一字不改留在原位，系統會換成使用者的名字跟聯絡方式。
4. 使用者要求縮短或加長時，reply 裡說明大概改成多少字。
5. reply 用繁體中文一兩句話說明改了哪裡，口語、不要生硬。
6. 「要保留的內容」列的 JD 條件，信裡目前有句子在回應它（多半是使用者按「補充」加進來的）。除非使用者這次明確要求刪改那一項，改信時這些句子都要留著：可以調整措辭、位置，但不能刪掉，也不能改到不再明確回應那項條件。
7. ${REMEMBER_RULE}
8. 只輸出 JSON，不要有其他文字、不要用 markdown code fence 包起來：{ "reply": string, "letter": string, "remember": string[] }`;

/**
 * 求職信頁的「跟 AI 聊」：照使用者的一句話改這個語言版本的信，回傳改好的整封信跟一句說明。
 * 這裡不存檔、不重新比對；頁面換進草稿後會自動存檔，可以按「復原上一版」拿回來。
 * 署名（名字＋聯絡方式）是程式放的，先換回記號再給 AI，改完再放回去，AI 不會改到聯絡方式。
 */
export async function reviseCoverLetterWithChat(params: {
  supabase: SupabaseClient;
  userId: string;
  applicationId: string;
  language: string;
  letter: string;
  history: { role: "user" | "assistant"; text: string }[];
  instruction: string;
}): Promise<{ reply: string; letter: string }> {
  const { supabase, userId, applicationId, language, letter, history, instruction } = params;

  const { data: application } = await supabase
    .from("applications")
    .select("job_description, resume_snapshot, cover_letter_checklist")
    .eq("id", applicationId)
    .eq("user_id", userId)
    .single();
  if (!application) throw new Error("找不到這筆應徵紀錄");

  const { data: profile } = await supabase.from("profile_data").select("data").eq("user_id", userId).maybeSingle();
  const { body, restore } = maskSignature(letter, readContact(profile?.data), language);

  const snapshot: Record<string, Resume> = application.resume_snapshot ?? {};
  const resumeLang = snapshot[language] ? language : Object.keys(snapshot)[0];
  const { layout: _layout, ...resume } = snapshot[resumeLang] ?? ({} as Resume); // eslint-disable-line @typescript-eslint/no-unused-vars
  // 目前靠這封信補上的 JD 條件（補充完會自動存），改信時要保留（2026-10-27：聊天改信把補充的句子改掉，重新比對又變回沒寫到）。
  const keep: string[] = ((application.cover_letter_checklist ?? {})[language] ?? [])
    .filter((i: Checklist[number]) => i.covered && i.source === "cover_letter")
    .map((i: Checklist[number]) => i.item);

  const response = await askClaude({
    userId,
    feature: "cover_letter_chat",
    systemPrompt: REVISE_SYSTEM_PROMPT,
    userPrompt: [
      LANGUAGE_INSTRUCTION[language] ?? `目標語言：${language}`,
      `===== JD =====`,
      application.job_description,
      `===== 已定案的履歷內容 =====`,
      JSON.stringify(resume, null, 2),
      `===== 目前的求職信 =====`,
      body,
      keep.length > 0 ? `===== 要保留的內容（信裡回應這幾項 JD 條件的句子不能刪）=====\n${keep.map((i) => `- ${i}`).join("\n")}` : "",
      history.length > 0
        ? `===== 之前的對話 =====\n${history.map((t) => `${t.role === "user" ? "使用者" : "AI"}：${t.text}`).join("\n")}`
        : "",
      `===== 使用者這次的要求 =====`,
      instruction,
    ]
      .filter(Boolean)
      .join("\n\n"),
    maxTokens: 3000,
    supabase,
  });

  let parsed: { reply?: string; letter?: string; remember?: string[] };
  try {
    parsed = JSON.parse(response.text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, ""));
  } catch {
    throw new Error("AI 回傳的內容不是有效的 JSON，請再試一次");
  }
  let revised = (parsed.letter ?? "").trim();
  if (!revised) throw new Error("AI 沒有回傳修改後的信，請再試一次");
  if (language === "zh") revised = toFullWidthPunctuation(toTraditional(revised));
  await rememberNotes(supabase, userId, (parsed.remember ?? []).map((t) => toTraditional(t)));
  return { reply: toTraditional(parsed.reply ?? "改好了。"), letter: restore(revised) };
}

/**
 * 署名（名字＋聯絡方式）是程式放的：給 AI 之前換回 {{SIGNATURE}} 記號，改完再放回去，AI 不會改到聯絡方式。
 * 原本的信找不到署名（使用者自己改掉了）就不硬加。
 */
function maskSignature(letter: string, contact: ReturnType<typeof readContact>, language: string) {
  const signature = [pickName(contact, language), buildContactLine(contact, language)].filter(Boolean).join("\n");
  const at = signature ? letter.lastIndexOf(signature) : -1;
  const body = at >= 0 ? `${letter.slice(0, at)}${SIGNATURE_MARK}${letter.slice(at + signature.length)}` : letter;
  return { body, restore: (text: string) => (at >= 0 ? placeSignature(text, signature) : text) };
}

const ADD_SYSTEM_PROMPT = `你是求職信修改助手。使用者從 JD 條件清單裡自己挑了幾項，要你補進現有的求職信。

${COVER_LETTER_RULES}

補充規則：
1. 清單裡每一項都是使用者親自勾選、按按鈕要求補的，等於使用者確認「我具備這一項」，每一項都要補進信裡，不能退回。
   - 履歷、經歷資料庫有對應事實：在信裡最適合的段落加一兩句，或改寫一句既有的句子讓它涵蓋這一項；能併進既有的案例就併，不要每一項各開一段。
   - 找不到對應事實：上面誠實原則 1、3 的「沒有事實不能寫」對這幾項不適用，使用者的確認就是依據。寫一句明確說自己具備這項的能力陳述（例如「我能以英文獨立進行簡報與合約溝通」），軟實力寫做事原則的陳述（例如「我做事重視規範與原則，遇到灰色地帶會先確認界線再行動」），item 也列進 no_example。不要寫成「期待學習」「還沒有經驗」這種句子，那樣等於沒補。
   - 寫成能力陳述時仍然不能編造具體細節：不能捏造專案、公司、數字、時間、事件，也不能說成是在某個既有專案裡做到的（歸屬錯了跟捏造一樣嚴重）。
   - 誠實原則 5 只限制不能描述 AI 工具的細節，不是不能補；用不到工具細節就改寫成能力陳述。
2. partial 是 true 的項目，履歷已經涵蓋一部分，gap 裡寫的「缺：○○」每一件都要補到，履歷已經有的部分不用再寫。
3. kind 是 "trait" 的項目（軟實力）：有事例就用具體事例帶出這個特質，不要只寫「我很主動積極」這種形容詞；找不到事例的照規則 1 寫成做事原則的陳述（說怎麼做事，不是貼形容詞）。
4. 只動為了補這幾項必須加的句子、或必須改的那一句，其他地方一字不改：不要順便潤飾、不要調整段落順序、不要刪掉原本的內容。
5. 補完之後系統會用下面的「求職信比對標準」檢查每一項，寫的句子一定要通過。有 previous_fail 的項目是上一輪補了但沒通過比對，previous_fail 寫了缺什麼：照它改寫或加強那一句，不要再寫一樣的句子。

${LETTER_COVERAGE_RULES}

6. 信裡的 {{SIGNATURE}} 記號一字不改留在原位。
7. 只輸出 JSON，不要有其他文字、不要用 markdown code fence 包起來：
{ "letter": string, "added": string[], "no_example": string[] }
added 列出補進信裡的每一項（應該是清單全部），no_example 列出其中寫成能力陳述、沒有具體事例的項目；兩者都照抄清單裡的文字。`;

export interface AddToLetterItem {
  item: string;
  kind: "requirement" | "trait" | "condition";
  partial: boolean;
  gap: string | null;
}

/**
 * 求職信頁 JD 條件清單的「補充進求職信」：使用者自己挑要補的條件（沒寫到、部分符合、軟實力），
 * 使用者勾選就等於確認自己具備，AI 每一項都要補：有事實用事例寫，找不到事實就寫成能力陳述（不編造細節）。
 * 補完用「重新比對」同一套標準檢查，沒過的再補一次；回傳的對照清單就是照這封信判斷的結果。
 * 這裡不存檔；頁面換進草稿（新加的字標綠底）後連右欄對照一起自動存檔，可以按「復原上一版」拿回來。
 */
export async function addItemsToCoverLetter(params: {
  supabase: SupabaseClient;
  userId: string;
  applicationId: string;
  language: string;
  letter: string;
  items: AddToLetterItem[];
}): Promise<{
  letter: string;
  added: string[];
  failed: { item: string; reason: string }[];
  noExample: string[];
  checklist: Checklist;
}> {
  const { supabase, userId, applicationId, language, letter, items } = params;

  const { data: application } = await supabase
    .from("applications")
    .select("job_description, resume_snapshot, jd_match_checklist, cover_letter_checklist")
    .eq("id", applicationId)
    .eq("user_id", userId)
    .single();
  if (!application) throw new Error("找不到這筆應徵紀錄");

  const { data: profile } = await supabase.from("profile_data").select("data").eq("user_id", userId).maybeSingle();
  const { body, restore } = maskSignature(letter, readContact(profile?.data), language);

  const snapshot: Record<string, Resume> = application.resume_snapshot ?? {};
  const resumeLang = snapshot[language] ? language : Object.keys(snapshot)[0];
  const { layout: _layout, ...resume } = snapshot[resumeLang] ?? ({} as Resume); // eslint-disable-line @typescript-eslint/no-unused-vars
  const resumeItems: Checklist = (application.jd_match_checklist ?? {})[resumeLang] ?? [];
  const jobDescription: string = application.job_description;
  // 上一次的對照（補充完會自動存）：之前補好的項目，句子沒被動到就直接沿用，不會因為這次補別的又被判掉。
  let previousChecklist: Checklist | null = (application.cover_letter_checklist ?? {})[language] ?? null;

  const { data: entryRows } = await supabase
    .from("experience_entries")
    .select("language, entry_type, org_name, location, role_variants, period_variants, achievements")
    .eq("user_id", userId);
  const allEntries = (entryRows ?? []) as Array<{ language: string } & Record<string, unknown>>;
  const entryLang = allEntries.some((e) => e.language === language) ? language : (allEntries[0]?.language ?? language);

  const asked = new Set(items.map((i) => i.item.trim()));
  const noExample = new Set<string>();

  /** 請 AI 把這幾項補進信裡（信是換掉署名的版本），回傳改好的信。 */
  async function writeItems(current: string, list: Array<AddToLetterItem & { previous_fail?: string }>) {
    const response = await askClaude({
      userId,
      feature: "cover_letter_add",
      systemPrompt: ADD_SYSTEM_PROMPT,
      userPrompt: [
        LANGUAGE_INSTRUCTION[language] ?? `目標語言：${language}`,
        `===== JD =====`,
        jobDescription,
        `===== 已定案的履歷內容 =====`,
        JSON.stringify(resume, null, 2),
        `===== 使用者經歷資料庫（${entryLang}；只能用這裡跟履歷有的事實）=====`,
        JSON.stringify(allEntries.filter((e) => e.language === entryLang), null, 2),
        `===== 要補進信裡的條件 =====`,
        JSON.stringify(list, null, 2),
        `===== 目前的求職信 =====`,
        current,
      ].join("\n\n"),
      maxTokens: 4000,
      supabase,
    });

    let parsed: { letter?: string; no_example?: string[] };
    try {
      parsed = JSON.parse(response.text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, ""));
    } catch {
      throw new Error("AI 回傳的內容不是有效的 JSON，請再試一次");
    }
    let revised = (parsed.letter ?? "").trim();
    if (!revised) throw new Error("AI 沒有回傳修改後的信，請再試一次");
    if (language === "zh") revised = toFullWidthPunctuation(toTraditional(revised));
    for (const i of parsed.no_example ?? []) if (asked.has(i.trim())) noExample.add(i.trim());
    return revised;
  }

  const judge = async (current: string) => {
    const judged = await judgeLetterChecklist({
      supabase,
      userId,
      jobDescription,
      resumeItems,
      letter: current,
      previous: previousChecklist,
    });
    previousChecklist = judged.checklist;
    return judged;
  };
  const failedIn = (checklist: Checklist) =>
    items.filter((i) => !checklist.find((c) => c.item.trim() === i.item.trim())?.covered);

  // 補完立刻用「重新比對」同一套標準檢查；沒通過的照比對說的缺口再補一次，補兩次還是沒過就照實回報。
  // 這樣補完右欄看到的結果，就是之後按「重新比對」會看到的結果。
  let current = await writeItems(body, items);
  let result = await judge(current);
  const retry = failedIn(result.checklist);
  if (retry.length > 0) {
    current = await writeItems(
      current,
      retry.map((i) => ({ ...i, previous_fail: result.reasons.get(i.item.trim()) ?? "信裡沒有明確回應這項的句子" })),
    );
    result = await judge(current);
  }

  const failed = failedIn(result.checklist).map((i) => ({
    item: i.item.trim(),
    reason: result.reasons.get(i.item.trim()) ?? "",
  }));
  const failedSet = new Set(failed.map((f) => f.item));
  const added = [...asked].filter((i) => !failedSet.has(i));
  return {
    letter: current === body ? letter : restore(current),
    added,
    failed,
    noExample: [...noExample].filter((i) => !failedSet.has(i)),
    checklist: result.checklist,
  };
}
