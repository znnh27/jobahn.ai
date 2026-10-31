import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { askClaude } from "@/lib/ai/askClaude";
import { askClaudeForJson, parseAiJson } from "@/lib/ai/parseAiJson";
import { REMEMBER_RULE, rememberNotes } from "@/lib/ai/userMemory";
import { CHAT_REPLY_FORMAT } from "@/lib/ai/chatReply";
import { BULLET_RULES, readRuleTags, stripRuleRefs } from "@/lib/experience/bulletRules";
import { checkBullets } from "@/lib/experience/checkBullets";
import { addAchievement, saveRefinedVariant } from "@/lib/experience/saveRefinedVariant";
import { after } from "next/server";
import { applyResumePatch, isNoopRevision, isResumeShape, noopTargets, resumeForPatch, RESUME_PATCH_FORMAT } from "./resumePatch";
import { ensureLanguageParity } from "@/lib/experience/languageParity";
import { computeAtsScore, countsForResume, coveredByResume, type JdImportance } from "./atsScore";
import { classifyJdItems, resolveJdItems, type JdBaseItem, type JdItemKind } from "./jdChecklist";
import { resolveJdKeywords } from "./jdKeywords";
import { readContact, type ResumeContact } from "./contact";
import { readCustomSectionLabels, type CustomSectionLabels } from "./sectionLabels";
import { normalize, readBackground, type LanguageBackground } from "./background";
import { ensureBackgroundLanguage } from "./translateBackground";
import { pinEntryFacts } from "./pinEntryFacts";
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
import { addCjkSpacing } from "@/lib/text/cjkSpacing";
import { NATURAL_WRITING_RULES } from "@/lib/text/naturalWriting";

const SUMMARY_RULES = `Professional Summary 寫作規則（一定要遵守）：
1. 先看 JD 最重視的 1-2 項核心能力/條件，從經歷資料庫裡挑選跟這些條件最相關的主題與成就來寫，其餘經歷不用勉強塞進來湊滿。
2. 用綜合陳述寫成一段話，不是把 bullet 條列拼接起來；控制在 3-4 句話內。
3. 第一句先講年資跟職能（例如「4 年 B2B 金融科技產品設計經驗」），讓招募官一眼看到幾年相關經驗，再帶出核心優勢；中間 1-2 句呼應 JD 最看重的能力並帶出經歷資料庫裡的具體佐證（能帶量化成果就帶），最後視情況一句帶出跟這個職缺/領域的契合度（工作條件也放這一句，見規則 8）。
4. 禁止空泛形容詞堆疊（例如「passionate」「driven」「results-oriented」單獨出現卻沒有具體事實撐著），每個特質描述都要有實際內容佐證，不能只是形容詞。
5. 不要直接重複 work_experience 裡已經寫的 bullet 原句，用更高層次的方式歸納主題，避免跟下面內容重疊感太重。
6. 一樣要降低 AI 感、避免堆疊術語，寫得像人類自然會寫的用詞，照下面的去 AI 腔規則寫。
7. 使用者資料裡的 summaries 是他自己以前寫過的 Summary，用來理解他怎麼定位自己、有哪些可以拿來寫的事實，不要整段照抄；事實一樣不能超出經歷資料庫和這些 Summary 裡有的內容。
8. 工作條件（出差、外派、輪班、工作地點這類「要不要配合」的事）：只有「這份職缺使用者確認可以配合的工作條件」裡列出的才能寫，寫進最後一句；清單是「（無）」就完全不寫任何工作條件、配合意願，就算 JD 提到國際合作、海外客戶也一樣（那是能力，不是工作條件）。只用半句簡短帶過，接在語言能力或跨國經驗後面（例如「英文流利，可配合出差」），地點、細節留給求職信，不另外寫一整句。不寫「對出差有高度興趣」這種空泛說法。

${NATURAL_WRITING_RULES}`;

// bullet 本身的寫法用經歷資料庫共用的那一份規則（lib/experience/bulletRules.ts），
// 這裡只補「挑內容、排一份履歷」才需要的規則。
const WRITING_RULES = `${BULLET_RULES}

排履歷的規則（一定要遵守）：
1. 規則 6 的「依目標 JD 決定留不留」：這次的目標 JD 就是下面給的 JD。
2. 正式工作經歷（work_experience）永遠是履歷的主體，比社團、專案（leadership）重要，不能因為跟 JD 關聯比較低就把正式工作砍到剩一兩條。每段條數（超過的會被程式直接刪掉）：
   - 最近一份正式工作 3–4 條（資料庫不到 3 件就全寫）。
   - 其他正式工作每段 1–3 條，越舊越少；每段至少 1 條，不能只留公司、職稱、期間。
   - 社團、專案每段最多 3 條。
   同一段裡的 bullet 依跟 JD 的相關度排序，最相關的放最前面（放不下時會從最後一條開始刪）。
   社團、專案是次要內容，用來補足正式工作沒展現到、但 JD 需要的能力；放不放、放幾條主要看跟 JD 的關聯，相關度差不多時優先放比較新的。leadership 陣列依跟 JD 的相關度排序，最相關的放最前面；相關度差不多時，比較新的排前面。
3. 履歷一定要剛好填滿一頁 A4，少於一頁會讓人覺得經歷太少：先把正式工作放到規則 2 的上限，還不滿一頁再放社團、專案；都放完還不滿，系統會放大字級和間距，不要超過上限硬塞。放不下時系統會依這個順序整條拿掉：(1) 最無關的社團、專案；(2) 其他正式工作多出來的 bullet（從最舊的那段先拿）；最近一份正式工作至少留 3 條。
4. JD 原文用字要盡量真的出現在履歷裡（不是只有意思接近），但要放在具體案例的敘述裡（見規則 7），前提是使用者真的有對應的真實經歷可以支撐，不能為了關鍵字硬掰。「JD 關鍵字」清單是招募官會逐字搜尋的字：資料庫裡有對應事實的，寫的時候直接用清單上的原字（例如資料寫「跨部門溝通」、JD 關鍵字是 stakeholder management，就寫 stakeholder management）；沒有對應事實的就不要用。只換「詞」（技能、工具、方法、專有名詞），不搬 JD 的句子或句型（例如 JD 寫「而非僅執行既定 roadmap」，不能寫成「而非只是照規格執行」）。
5. 同一段經歷可以依這份 JD 換敘事角度（例如投系統規劃職缺強調規劃，投行銷職缺強調成長數據），但底層事實跟程度不能變。
6. 正式工作越近越多、越舊越少：最近一份條數最多，往前遞減（條數見規則 2）；每段至少 1 條，bullets 不能是空陣列。社團、專案不套用這條（見規則 2）。
7. 每段經歷的第一條放這段最強的成果（數字最大、跟 JD 最相關、影響最廣的那件事）。招募官掃履歷時每段的第一條最常被看到。
8. 整份履歷最強的 2-3 條，在成果後面補一小段「為什麼重要」，交代對業務或使用者的意義（例如「…將結帳轉換率從 2.8% 提升到 3.6%，每月多帶來約 NT$120 萬營收」）；只能用資料裡有的事實，沒有就不要硬加，其他條不用加。
9. 技能區只放工具、軟體、專業技能（Figma、SQL、A/B Testing、Financial Modeling），不放「領導力、溝通能力、團隊合作、抗壓性」這類軟實力；軟實力要靠經歷裡的事實證明。`;

// 英文版/中文版各自只拿自己那份，不要兩份一起塞給同一次生成。
const EN_RULES = `英文版額外規則（一定要遵守）：
1. 每條 bullet 用強動詞開頭（Led, Built, Launched, Redesigned, Increased 等）。弱開頭一律不用：Responsible for, Assisted, Helped, Participated in, Worked on, Served as, Acted as。
2. 不寫 I、my、me 等第一人稱。
3. 時態依事實：以前的工作一律過去式；現職裡持續在做的職責用現在式（Leads, Owns），已經完成的專案或成果用過去式（Rebuilt, Launched）。同一段可以混用，但不能為了時態把已完成的事改寫成持續在做（Rebuilt → Maintains 會把意思改弱，也不符合事實）。
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
3. 例外：這次 "org" 欄位不用跟 org_name 一字不改，要轉成公司的英文名稱（有官方英文名就用官方的）；外國人不認識的公司，在英文名稱後加一句簡短的簡介（產業、規模或產品，8 個英文字以內），例如：XX Bank (Taiwanese commercial bank, 100+ branches)。
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
4. 如果只是職務相近、可以類推、但沒有具體事實佐證，一律標 false，並在缺口裡具體寫出缺的是什麼，不要寫模稜兩可的描述。
5. 部分符合（partial，算一半分數）只用在下面兩種情況，其他項目 partial 一律 false：
   (a) 學歷科系：JD 要求某類科系（例如「商業及管理學科類」），主修或雙主修符合就是 covered true；主修不符合、但輔修、副修、minor、學分學程符合，covered 標 false、partial 標 true，gap 寫「主修不同，但有輔修 ○○，算部分符合；可以在學歷或摘要凸顯輔修內容」。
   (b) 好幾個條件綁成一項：JD 這一項用「、」「及」「和」「與」「並」「and」列了兩件以上的事（例如「中英文流利，並能以英文獨立進行商務會議、簡報及合約溝通」是流利、會議、簡報、合約四件）。先逐件用判定標準 1–4 檢查，全部都有具體事實撐著才是 covered true；至少一半有、但沒有全部有，covered 標 false、partial 標 true；不到一半就是 covered false、partial false。partial 的 gap 一定要寫「缺：○○」列出沒做到的那幾件，再說可以怎麼補（真的沒有相關經驗就不要硬補）。
   拆開檢查時照 JD 原本的用字判斷，不能自己加碼：JD 寫「進行會議」就不能改成要求「主持會議」，寫「參與」就不能改成要求「主導」。
   單一條件的項目（只講一件事）維持全有或全無，不能因為「沾到一點邊」就給 partial。
   例外：同一個語言能力的「聽、說、讀、寫」是一件事的四個面向，不算綁好幾件事，照判定標準 7 整項判斷。
6. kind 是 "condition" 的項目（出差、外派、輪班這類工作條件）：履歷裡明確寫到可以配合這件事（通常在摘要）才算 covered；有海外經驗、會外語本身不等於可以配合出差，不算 covered。沒寫到時 gap 寫「履歷沒提到可以配合 ○○，確認可以配合的話，摘要會補一句」。
7. 語言能力：照這張對照表判斷程度有沒有達到，用字不同不算不符合（例如 JD 寫「精通」、履歷寫「流利」就是達到）。
   - 精通／Proficient／Fluent／Business fluent ＝ 流利、母語、近母語、C1–C2、TOEIC 860 以上、TOEFL iBT 95 以上、IELTS 7 以上、在該語言環境工作或求學一年以上。
   - 中等／Intermediate ＝ B1–B2、TOEIC 550–855、TOEFL iBT 60–94、IELTS 5–6.5。
   - 略懂／Basic ＝ A1–A2。
   高程度一定涵蓋低程度（流利的人一定達到「中等」）。履歷的語言欄有寫程度或分數就以它為準。
   JD 要求「用某語言進行會議、溝通、協調」：經歷寫到跟使用那個語言的國家的客戶、團隊溝通協調（例如跟美國客戶溝通、協調多國團隊），就是用該語言進行商務溝通／會議的直接事實，不算類推。「簡報」「合約」「談判」這類比較具體的動作，要經歷裡真的寫到對那些對象做過才算。
8. 沒寫到（covered false）的項目，gap 一定要寫出具體缺什麼；說不出缺什麼，代表其實有寫到，要重新檢查一次再決定。
   gap 直接顯示在 JD 條件底下，所以不要重講條件本身（例如條件是「深諳訂閱制商業模式」，不要寫「缺訂閱制商業模式的經驗」）。
   gap 最多 3 句，每句用句號結尾，依序寫：現有經驗跟這項差在哪（例如產品類型不同、年資不夠、只有協助沒有主導；沒有相關經驗就省略這句）、怎麼補。
   部分符合（partial）的項目例外，第一句寫「缺：○○」，只列沒做到的那幾件，不重講整條。每句寫短，不要用分號串成長句，畫面上會一句一行顯示。
9. gap 裡「可以怎麼補」的建議（包括建議求職信怎麼寫）只能用履歷裡已經有的事實，不能替使用者宣稱履歷沒寫到的能力或經驗。例如履歷沒有英文簡報的事實，就不能建議求職信寫「有英文簡報基礎」；只能建議「有的話挖出來補一條」，或在求職信用現有的相關事實（例如跨國客戶溝通）說明可以勝任。`;

const SYSTEM_PROMPT = `你是履歷客製化助手。使用者會給你：這個職缺的 JD、使用者的經歷資料庫、使用者過去寫過的 Summary 跟學歷、技能、語言能力。

經歷資料庫的結構說明：每筆經歷（同一家公司同一個職位）底下的 achievements 是「同一件事的不同寫法」分組——同一個 achievement 底下的每個 variant 講的是同一件真實的事，只是措辭角度不同，variant.angleLabel 標註這個寫法強調的重點（例如「強調數據分析」「強調從 0 到 1 實作」）。同一個 achievement 底下的多個 variant 不是好幾件不同的事，不要當成好幾條 bullet 分別寫進履歷。

你的任務：分析 JD 要求哪些條件，針對每個要放進履歷的 achievement，從它底下的 variant 裡挑一個角度最貼近 JD 的當作事實依據，再照下面的寫作規則寫成這份履歷的 bullet，合併成一份完整履歷（Professional Summary、工作經歷、領導經驗/專案、學歷、技能、語言能力）。

學歷、技能、語言能力：
1. education、languages 照使用者資料一字不改照抄全部項目，校名、科系、輔修都不能改寫或翻譯（系統也會直接用使用者資料覆蓋）。
2. skills 從使用者的技能裡挑跟這份 JD 相關的放前面，跟 JD 完全無關、又佔版面的可以拿掉；每一項都要跟使用者資料裡的寫法一字不差，不能加使用者資料裡沒有的技能。語言能力不要放進 skills。
3. 使用者資料裡沒有 languages 就給空陣列。

經歷資料庫裡的寫法不一定優化過（使用者可能還沒用過資料庫的檢查、潤飾功能），常見問題是流水帳、步驟描述、弱動詞開頭、沒有成果、一句塞太多事。不要原封不動照抄：每一條都要對照寫作規則檢查，不符合就重寫；已經符合規則的寫法可以保留。重寫只改寫法、不改事實：數字、專案歸屬、做法都只能用資料庫裡有的，不能新增資料庫沒有的數字、成果或方法。

重要：輸出的每一段工作經歷/領導經驗的 "org" 欄位，公司名稱本身一定要跟輸入的經歷資料庫裡對應那筆的 org_name 一字不改，不要精簡、不要換成簡稱。唯一的例外是公司名後面括號裡的說明（介紹公司在做什麼）：太長會讓這一行換行，中文超過 15 個字、英文超過 8 個字就精簡成一小段（只保留產業或產品，例如「（金融科技公司）」），不到這個長度就照抄。

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
  /** 硬實力、軟實力、還是出差這類工作條件（見 jdChecklist.ts）。舊資料沒有，當成硬實力。 */
  kind?: JdItemKind | null;
  /** 已經用三類分類過（見 jdChecklist.ts 的 classifyJdItems）。 */
  kindChecked?: boolean | null;
  /** AI 判斷有問題（判定沒寫到卻說不出缺什麼），不算進分數，畫面上請使用者重新評分。 */
  invalid?: boolean | null;
  /** 沒完全符合、但有相關條件撐著（科系要求、使用者有輔修；或一項綁好幾個條件、做到一半以上），算一半分數。 */
  partial?: boolean | null;
  /** 工作條件：使用者回答能不能配合。null＝還沒回答；skip＝這份應徵先略過（不寫進履歷、不存進帳號紀錄，2026-10-29 Z 要求）。 */
  answer?: "yes" | "no" | "skip" | null;
  /** 求職信對照（cover_letter_checklist）裡靠信補上的項目：信裡對應的那一句原文，句子沒變就不重新判斷（見 judgeLetterChecklist）。
   *  履歷對照裡是舊版格式留下來的欄位，現在不產生也不顯示。不顯示在畫面上。 */
  evidence?: string | null;
  /** 沒涵蓋時：具體缺什麼、跟現有經驗差在哪、可以怎麼補。舊資料沒有這個欄位。 */
  gap?: string | null;
}

/** 中文版的摘要跟 bullet：簡體字轉繁體、半形標點轉全形（AI 偶爾會混進來）。公司名要跟資料庫比對，不動。 */
function polishChinese(resume: GeneratedResume["resume"]) {
  const fix = (t: string) => addCjkSpacing(toFullWidthPunctuation(toTraditional(t)));
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
    .select("job_description, resume_language, jd_match_checklist, score_basis, jd_keywords")
    .eq("id", applicationId)
    .eq("user_id", userId)
    .single();

  if (appError || !application) {
    throw new Error(`找不到這筆應徵紀錄：${appError?.message ?? "unknown"}`);
  }

  // 同一份 JD 重新生成履歷時，沿用原本的 JD 條件清單（條件文字、必要/加分都不變），分數才比得起來。
  // 2026-10-24 以前的清單沒有分出軟實力，先補分類一次（見 jdChecklist.ts 的 classifyJdItems）。
  const { checklists: existingChecklists } = await classifyJdItems<JdChecklistItem>({
    supabase,
    userId,
    checklists: application.jd_match_checklist ?? {},
  });
  const basis = readScoreBasis(application.score_basis);

  const languages: string[] = application.resume_language ?? [];
  if (languages.length === 0) {
    throw new Error("這筆應徵沒有指定語言版本");
  }

  // 要生成的語言如果缺了另一個語言有的經歷（例如只上傳過英文履歷的那段），先翻過來補上；兩邊一致就直接跳過。
  await ensureLanguageParity({
    supabase,
    userId,
    targets: languages.filter((l): l is "zh" | "en" => l === "zh" || l === "en"),
  });

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
  // 關鍵字命中用的 JD 關鍵字，一樣一份 JD 只挑一次（見 jdKeywords.ts）；生成時也給 AI，有對應事實就用 JD 原字。
  const jdKeywords = await resolveJdKeywords({
    supabase,
    userId,
    applicationId,
    jd: application.job_description,
    stored: application.jd_keywords,
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
    // 生成出來的學歷、語言能力一律照這份一字不改（pinBackground）；經歷的地點、日期照經歷資料庫（pinEntryFacts）。
    const background = await ensureBackgroundLanguage({ supabase, userId, language: lang === "zh" ? "zh" : "en" });
    const pin = (r: Resume) => {
      pinBackground(r, background);
      return sourceLanguage === lang ? pinEntryFacts(r, langEntries) : r;
    };

    const userPrompt = buildUserPrompt({
      jd: application.job_description,
      language: lang,
      sourceLanguage,
      entries: langEntries,
      profile: profile?.data ?? {},
      background: withReferenceSummaries(background, profile?.data),
      confirmedConditions: confirmedConditions(existingChecklists),
      keywords: jdKeywords,
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
      labels: readCustomSectionLabels(profile?.data)[lang === "zh" ? "zh" : "en"],
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
2. 每一項判斷 covered（有沒有寫到），source 有寫到填 "resume"，沒寫到填 null。kind 照抄。沒寫到的項目再判斷 partial（見判定標準 5），有寫到的 partial 是 false。
   kind 是 "trait" 的項目（軟實力、人格特質）履歷不評分、交給求職信：一律 covered false、partial false、gap null，不用判斷。
3. 沒寫到的項目，gap 要寫得具體、可以照著做：使用者現有經驗跟這項要求差在哪（例如產品類型不同、年資不夠、只有協助沒有主導）、可以怎麼補（挖掘哪一類經驗寫進履歷，或留到求職信說明）。gap 顯示在條件底下，不要重講條件本身（見判定標準 8）。有寫到的 gap 是 null。gap 一律用繁體中文。
   範例：item「2 年以上主導數位產品規劃經驗（AI、大數據相關尤佳）」→ gap「現有經驗是電商網站改版與實體活動企劃，產品類型不同，現職年資也不到 2 年。有做過資料分析、推薦或自動化相關功能的話，挖出來寫成一條；沒有的話在求職信說明轉換動機。」
4. **判斷要穩定**：如果有給「上次的判斷」跟「這次履歷改了哪些地方」，只有跟改動內容直接相關的項目可以改變 covered；跟改動無關的項目，covered、partial、source、gap、answer 一律照抄上次的判斷，不要重新詮釋。
5. answer 一律照抄上次的判斷（使用者自己按的），沒有上次就填 null，不要自己判斷。

${COVERAGE_RULES}

只輸出 JSON，不要有其他文字、不要用 markdown code fence 包起來。輸出格式（嚴格遵守）：
{
  "jd_match_checklist": [{ "item": string, "importance": "required"|"preferred", "kind": "requirement"|"trait"|"condition", "covered": boolean, "partial": boolean, "source": "resume"|null, "gap": string|null, "answer": "yes"|"no"|"skip"|null }]
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
            params.items.map(({ item, importance, kind }) => {
              const p = previousByItem.get(item.trim());
              return {
                item,
                importance,
                kind: kind ?? "requirement",
                covered: p?.covered ?? false,
                partial: p?.partial ?? false,
                source: p?.source ?? null,
                gap: p?.gap ?? null,
                answer: p?.answer ?? null,
              };
            }),
            null,
            2,
          )}`
        : `===== JD 條件清單（item、importance、kind 照抄）=====\n${JSON.stringify(
            params.items.map(({ item, importance, kind }) => ({ item, importance, kind: kind ?? "requirement" })),
            null,
            2,
          )}`,
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

    const parsed = parseAiJson(response.text, "generateResume") as Pick<GeneratedResume, "jd_match_checklist">;
    items = lockItems(params.items, previousByItem, parsed.jd_match_checklist);
  }

  return {
    jd_match_checklist: items,
    ats_score: computeAtsScore(items) ?? 0,
    ats_gaps: items.filter((i) => countsForResume(i) && !i.covered && i.gap).map((i) => i.gap as string),
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
  const normalize = (item: JdChecklistItem): JdChecklistItem => {
    const kind: JdItemKind = item.kind === "condition" || item.kind === "trait" ? item.kind : "requirement";
    // 軟實力履歷不評分（交給求職信），一律當沒寫到、沒有缺口說明。
    const covered = kind !== "trait" && !!item.covered;
    const partial = !covered && kind === "requirement" && !!item.partial;
    const gap = covered || kind === "trait" ? null : (item.gap?.trim() || null);
    return {
      item: item.item,
      importance: item.importance === "preferred" ? "preferred" : "required",
      kind,
      kindChecked: !!item.kindChecked,
      covered,
      partial,
      source: covered ? "resume" : null,
      gap,
      // 硬實力判定沒寫到卻說不出缺什麼：判斷有問題，不算進分數，請使用者重新評分。
      invalid: kind === "requirement" && !covered && !gap,
      answer:
        kind === "condition" && (item.answer === "yes" || item.answer === "no" || item.answer === "skip")
          ? item.answer
          : null,
    };
  };
  const byItem = new Map(fresh.map((i) => [i.item.trim(), i]));
  return base.map((b) => {
    const key = b.item.trim();
    // AI 這次漏判或把條件文字改掉了，就沿用上次的判斷。
    const previous = previousByItem.get(key);
    const judged = byItem.get(key) ?? previous ?? { item: b.item, covered: false, source: null, gap: null };
    return normalize({
      ...judged,
      item: b.item,
      // 清單已經有 importance 就固定用清單的；舊資料沒有才用這次 AI 補的。
      importance: b.importance ?? judged.importance,
      kind: b.kind ?? "requirement",
      kindChecked: b.kindChecked ?? false,
      // 使用者親自回答過的不能被 AI 洗掉。
      answer: judged.answer ?? previous?.answer ?? null,
    });
  });
}

/** 這個語言已經有清單就沿用它（舊應徵的中英文清單可能不同，不去動）；沒有就用共用清單。 */
function itemsForLanguage(
  stored: GeneratedResume["jd_match_checklist"] | undefined,
  shared: JdBaseItem[],
): JdBaseItem[] {
  if (stored && stored.length > 0) {
    return stored.map((i) => ({
      item: i.item,
      importance: i.importance ?? null,
      kind: i.kind ?? "requirement",
      kindChecked: !!i.kindChecked,
    }));
  }
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
    .select("job_description, resume_language, jd_match_checklist, score_basis, jd_keywords")
    .eq("id", applicationId)
    .eq("user_id", userId)
    .single();

  if (appError || !application) {
    throw new Error(`找不到這筆應徵紀錄：${appError?.message ?? "unknown"}`);
  }

  const languages: string[] = application.resume_language ?? [];
  // 舊清單還沒分出軟實力就補分類一次；有補分類代表判斷規則變了，這次每一項都重新判斷，不沿用上次的結果。
  const { checklists: existingChecklists, classified } = await classifyJdItems<JdChecklistItem>({
    supabase,
    userId,
    checklists: application.jd_match_checklist ?? {},
  });
  const basis = readScoreBasis(application.score_basis);
  const checklists: Record<string, GeneratedResume["jd_match_checklist"]> = { ...existingChecklists };
  const atsScores: Record<string, number> = {};
  const atsGaps: Record<string, string[]> = {};
  let sharedItems: JdBaseItem[] | null = null;
  // 舊的應徵還沒挑過 JD 關鍵字，重新評分時補挑一次。
  await resolveJdKeywords({
    supabase,
    userId,
    applicationId,
    jd: application.job_description,
    stored: application.jd_keywords,
  });

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
      previousJudgments: classified ? [] : (existingChecklists[lang] ?? []),
      previousResume: classified ? null : (basis.resume[lang] ?? null),
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

const CONDITION_SUMMARY_PROMPT = `你是履歷摘要的修改助手。使用者剛確認可以配合 JD 裡的一個工作條件（例如出差），請把這件事補進目前的 Professional Summary。

${SUMMARY_RULES}

這次要做的事：
1. 只改摘要，原本的內容盡量保留；把可以配合的條件寫進最後一句（原本最後一句講契合度的話，合併成一句；句數還是控制在 3-4 句）。
2. 照規則 8 只用半句簡短帶過（例如「英文流利，可配合出差」），接在語言能力或跨國經驗後面，細節留給求職信；不能編造資料裡沒有的經驗。
3. 用跟目前摘要一樣的語言寫。
4. 只輸出 JSON，不要其他文字、不要 markdown code fence：{ "summary": string }`;

/**
 * 使用者在 JD 條件清單回答某個工作條件能不能配合。答案先記進 profile_data（之後別的職缺沿用），然後：
 * - 可以配合：每個語言的摘要補一句，存成新草稿再重新評分（只有摘要改了，其他項目沿用上次的判斷）。
 * - 無法配合：這一項標成已回答，不動履歷、不重新評分。
 */
/** 工作條件按「略過」，或略過之後按「重新回答」：只改這份應徵的清單，不存進帳號紀錄、不動履歷，也不用重新評分（工作條件在履歷頁不算分）。 */
export async function setWorkConditionSkipped(params: {
  supabase: SupabaseClient;
  userId: string;
  applicationId: string;
  item: string;
  skipped: boolean;
}): Promise<void> {
  const { supabase, userId, applicationId, item, skipped } = params;
  const { data: application } = await supabase
    .from("applications")
    .select("jd_match_checklist")
    .eq("id", applicationId)
    .eq("user_id", userId)
    .single();
  if (!application) throw new Error("找不到這筆應徵紀錄");

  const key = item.trim();
  const checklists: Record<string, JdChecklistItem[]> = application.jd_match_checklist ?? {};
  const next = Object.fromEntries(
    Object.entries(checklists).map(([lang, items]) => [
      lang,
      items.map((i) => (i.item.trim() === key ? { ...i, answer: skipped ? ("skip" as const) : null } : i)),
    ]),
  );
  const { error } = await supabase
    .from("applications")
    .update({ jd_match_checklist: next })
    .eq("id", applicationId)
    .eq("user_id", userId);
  if (error) throw new Error(`儲存失敗：${error.message}`);
}

export async function answerWorkCondition(params: {
  supabase: SupabaseClient;
  userId: string;
  applicationId: string;
  item: string;
  willing: boolean;
  editedResumeDraft: Record<string, Resume>;
}): Promise<void> {
  const { supabase, userId, applicationId, item, willing, editedResumeDraft } = params;
  const { saveWorkConditionAnswer } = await import("./workConditions");
  await saveWorkConditionAnswer({ supabase, userId, condition: item, willing });

  const { data: application } = await supabase
    .from("applications")
    .select("job_description, resume_language, jd_match_checklist")
    .eq("id", applicationId)
    .eq("user_id", userId)
    .single();
  if (!application) throw new Error("找不到這筆應徵紀錄");

  const key = item.trim();
  const checklists: Record<string, JdChecklistItem[]> = application.jd_match_checklist ?? {};
  const answered = Object.fromEntries(
    Object.entries(checklists).map(([lang, items]) => [
      lang,
      items.map((i) =>
        i.item.trim() === key
          ? {
              ...i,
              answer: willing ? ("yes" as const) : ("no" as const),
              gap: willing ? i.gap : `你表示無法配合「${i.item}」，這項不寫進履歷；面試時可能會被問到，先想好怎麼說明。`,
            }
          : i,
      ),
    ]),
  );
  const { error } = await supabase
    .from("applications")
    .update({ jd_match_checklist: answered })
    .eq("id", applicationId)
    .eq("user_id", userId);
  if (error) throw new Error(`儲存失敗：${error.message}`);
  if (!willing) return;

  const { data: profile } = await supabase.from("profile_data").select("data").eq("user_id", userId).maybeSingle();
  const languages: string[] = application.resume_language ?? [];
  const nextDraft = { ...editedResumeDraft };
  for (const lang of languages) {
    const resume = nextDraft[lang];
    if (!resume) continue;
    const background = readBackground(profile?.data)[lang === "zh" ? "zh" : "en"];
    const response = await askClaude({
      userId,
      feature: "resume_condition_summary",
      systemPrompt: CONDITION_SUMMARY_PROMPT,
      userPrompt: [
        `===== JD =====`,
        application.job_description,
        `===== 這份職缺使用者確認可以配合的工作條件（摘要寫作規則 8）=====`,
        `- ${item}`,
        `===== 使用者的學歷、技能、語言能力（可以拿來當佐證）=====`,
        JSON.stringify({ ...background, summaries: undefined }, null, 2),
        `===== 目前的履歷（${lang}）=====`,
        JSON.stringify({ ...resume, layout: undefined }, null, 2),
      ].join("\n\n"),
      maxTokens: 1500,
      supabase,
    });
    const { summary } = parseJsonResponse<{ summary?: string }>(response.text);
    if (!summary?.trim()) continue;
    const next = { ...resume, summary: summary.trim() };
    if (lang === "zh") polishChinese(next);
    nextDraft[lang] = next;
  }

  await rescoreResumeForApplication(supabase, userId, applicationId, nextDraft);
}

/** 一頁要填到這個比例才算滿；不到就補內容，經歷資料庫用完了就放大排版。 */
const TARGET_FILL_RATIO = 0.92;
/** 補內容最多幾輪。 */
const FILL_ROUNDS = 3;

/**
 * 生成完用下載時同一套程式排 PDF 量版面，調到剛好一頁：
 * - 每段條數先套上限（enforceBulletCaps），超過的從最後一條開始刪。
 * - 第一頁用不到 92%：請 AI 從經歷資料庫補內容（先正式工作、再社團和專案），告訴它大約還剩幾行，
 *   最多補三輪；補完超出一頁就丟掉那一版、下一輪只補一半。
 * - 經歷資料庫的內容都用完了還不滿：放寬間距、放大內文字級，直到剛好一頁。
 * - 超出一頁：程式照固定順序一次刪一條（trimOneBullet），刪到剛好一頁；刪到下限還是超出，
 *   畫布上會照常顯示超出一頁的提示，由使用者決定。
 */
async function fitOnePage(params: {
  supabase: SupabaseClient;
  userId: string;
  lang: string;
  resume: Resume;
  contact: ResumeContact;
  /** 使用者改過的區塊標題，量版面時要用一樣的標題。 */
  labels: CustomSectionLabels;
  /** 生成時的完整 prompt（JD、經歷資料庫、個人資料），調整時沿用。 */
  basePrompt: string;
  /** 這次生成用的經歷資料庫，用來判斷還有沒有內容可以補。 */
  entries: ExperienceEntryRow[];
  /** AI 改完的版本一樣要把學歷、技能、語言換回經歷資料庫的寫法。 */
  pin: (r: Resume) => Resume;
}): Promise<Resume> {
  const { measureResumePdf } = await import("@/lib/documents/measureResumePdf");
  const { BODY_WIDTH_PT } = await import("@/lib/documents/ResumePdfDocument");
  const measure = (r: Resume) =>
    measureResumePdf({ contact: params.contact, resume: r, language: params.lang, labels: params.labels });
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
        ...task.filter(Boolean),
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

  // 補內容時點名最近一份正式工作，資料庫裡有的話至少要 3 條。
  const latest = latestWorkFloor(params.entries);
  const floorRule = latest
    ? `- 最近一份正式工作是「${latest.org}」（${latest.period}），這段至少要有 ${latest.floor} 條 bullet。`
    : "";
  const logShape = (stage: string, r: Resume, f?: { pages: number; fillRatio: number } | null) => {
    if (process.env.NODE_ENV === "production") return;
    const counts = (list?: { bullets?: string[] }[]) => (list ?? []).map((e) => e.bullets?.length ?? 0).join(",") || "-";
    const page = f ? ` pages=${f.pages} fill=${Math.round(f.fillRatio * 100)}%` : "";
    console.info(`[fitOnePage] ${params.lang} ${stage} work=${counts(r.work_experience)} leadership=${counts(r.leadership)}${page}`);
  };

  // 每段條數上限由程式把關，不靠 AI 自己遵守。
  let current = enforceBulletCaps(params.resume);
  let fit;
  try {
    fit = await measure(current);
  } catch {
    return current; // 量不到版面就不調，不影響生成。
  }
  logShape("draft", current, fit);

  // 超出一頁：程式照固定順序一次刪一條、刪一次量一次，剛好一頁就停（不交給 AI，AI 不一定照順序刪，
  // 每刪一輪又要重寫整份、花一兩分鐘）。全部刪到下限還是超出，就留給使用者自己決定。
  if (fit.pages > 1) {
    let cuts = 0;
    while (fit.pages > 1) {
      const next = trimOneBullet(current);
      if (!next) break;
      const nextFit = await measure(next).catch(() => null);
      if (!nextFit) break;
      current = next;
      fit = nextFit;
      cuts++;
    }
    logShape(`trimmed ${cuts} bullet(s)`, current, fit);
    // 刪過就不再請 AI 補內容（它會把剛刪掉的補回來），沒填滿的部分交給排版放大。
    if (fit.pages > 1) return current;
    return enlargeToFill(current, params.lang, fit.fillRatio, measure);
  }

  // 一頁沒填滿：分幾輪從經歷資料庫補內容，先補正式工作、再補社團和專案（留 2 行緩衝，避免剛好擠到第二頁）。
  // 補完超出一頁就丟掉那一版，下一輪只要求補一半的行數。
  let askLines = spareLinesOf(fit.fillRatio);
  for (let round = 0; fit.fillRatio < TARGET_FILL_RATIO && round < FILL_ROUNDS && askLines > 0; round++) {
    if (dbExhausted(current, params.entries)) break;
    const raw = await ask(current, [
      `這份履歷只用了一頁 A4 的 ${Math.round(fit.fillRatio * 100)}%，下面還空著大約 ${askLines} 行（每行${charsPerLine}）。履歷一定要填滿一頁，少於一頁會讓人覺得經歷太少。請從經歷資料庫補上大約 ${askLines} 行的內容，不能超過：`,
      `- 每段條數上限：最近一份正式工作最多 ${LATEST_WORK_MAX} 條，其他正式工作最多 ${OTHER_WORK_MAX} 條而且越舊越少，社團、專案每段最多 ${LEADERSHIP_MAX} 條；超過的會被直接刪掉。`,
      `- 先補還沒到上限的正式工作（最近的先補）；正式工作都到上限了，再補跟 JD 相關的社團、專案（整段沒放進來的也要加進來；leadership 依跟 JD 的相關度排，最相關的放最前面，相關度差不多時比較新的排前面）。`,
      floorRule,
      `- 已經寫好的內容原則上不要改，只新增。`,
    ]);
    if (!raw) break;
    const expanded = enforceBulletCaps(raw);
    const after = await measure(expanded).catch(() => null);
    if (!after) break;
    logShape(`fill${round + 1}`, expanded, after);
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

/** 每段條數上限（2026-10-21 跟 Z 定案）：最近一份正式工作 4、其他正式工作 3 而且越舊越少、社團專案 3。 */
const LATEST_WORK_MAX = 4;
const OTHER_WORK_MAX = 3;
const LEADERSHIP_MAX = 3;
/** 刪減時最近一份正式工作至少留幾條。 */
const LATEST_WORK_MIN = 3;

/** 履歷裡正式工作的 index，依期間從新到舊排。 */
function workByRecency(resume: Resume): number[] {
  return (resume.work_experience ?? [])
    .map((e, i) => ({ i, end: periodEnd(e.period ?? "") }))
    .sort((a, b) => b.end - a.end || a.i - b.i)
    .map((x) => x.i);
}

/**
 * 正式工作一律由新到舊排（2026-10-28 Z 要求）：以前靠 AI 照資料庫順序輸出，沒有把關。
 * 有一段認不出結束時間就整個不動，免得排錯位置。社團、專案照 AI 依 JD 相關度排的順序，不在這裡排。
 */
export function sortWorkByRecency(resume: Resume): Resume {
  const work = resume.work_experience ?? [];
  const ends = work.map((e) => periodEnd(e.period ?? ""));
  if (ends.some((end) => end < 0)) return resume;
  const order = work.map((_, i) => i).sort((a, b) => ends[b] - ends[a] || a - b);
  return { ...resume, work_experience: order.map((i) => work[i]) };
}

/**
 * 套用每段條數上限：最近一份最多 4 條；其他正式工作最多 3 條，而且不能比比它新的那段多（越舊越少）；
 * 社團、專案每段最多 3 條。bullet 依跟 JD 的相關度排過，超過的從最後一條開始刪。
 */
function enforceBulletCaps(input: Resume): Resume {
  const resume = sortWorkByRecency(input);
  const work = (resume.work_experience ?? []).map((e) => ({ ...e, bullets: [...(e.bullets ?? [])] }));
  let newer = Number.POSITIVE_INFINITY;
  workByRecency(resume).forEach((i, rank) => {
    const cap = rank === 0 ? LATEST_WORK_MAX : Math.min(OTHER_WORK_MAX, Math.max(1, newer));
    work[i].bullets = work[i].bullets.slice(0, cap);
    newer = work[i].bullets.length;
  });
  const leadership = (resume.leadership ?? []).map((e) => ({ ...e, bullets: (e.bullets ?? []).slice(0, LEADERSHIP_MAX) }));
  return { ...resume, work_experience: work, leadership };
}

/**
 * 超出一頁時刪一條，順序（2026-10-21 跟 Z 定案）：
 * 1. 社團、專案：從排最後（跟 JD 最無關）的那段刪最後一條，刪光就整段拿掉。
 * 2. 其他正式工作：從最舊的那段刪最後一條，每段至少留 1 條，再換比較新的那段。
 * 3. 最近一份正式工作：刪到剩 3 條為止。
 * 都到下限了回 null。
 */
function trimOneBullet(resume: Resume): Resume | null {
  const leadership = resume.leadership ?? [];
  if (leadership.length > 0) {
    const last = leadership.length - 1;
    const bullets = leadership[last].bullets ?? [];
    const next =
      bullets.length > 1
        ? leadership.map((e, i) => (i === last ? { ...e, bullets: bullets.slice(0, -1) } : e))
        : leadership.slice(0, -1);
    return { ...resume, leadership: next };
  }
  const order = workByRecency(resume);
  for (const i of [...order].reverse()) {
    const bullets = resume.work_experience[i].bullets ?? [];
    const min = i === order[0] ? LATEST_WORK_MIN : 1;
    if (bullets.length > min) {
      return {
        ...resume,
        work_experience: resume.work_experience.map((e, j) => (j === i ? { ...e, bullets: bullets.slice(0, -1) } : e)),
      };
    }
  }
  return null;
}

interface LatestWork {
  org: string;
  period: string;
  /** 至少要留幾條：3 條，資料庫不到 3 件就全部。 */
  floor: number;
}

/** 經歷資料庫裡最近一份正式工作（work），依期間的結束時間判斷；「至今／Present」最新。 */
function latestWorkFloor(entries: ExperienceEntryRow[]): LatestWork | null {
  let best: { entry: ExperienceEntryRow; periods: string[]; end: number } | null = null;
  for (const entry of entries) {
    if (entry.entry_type !== "work") continue;
    const periods = readPeriods(entry.period_variants);
    const end = Math.max(-1, ...periods.map(periodEnd));
    if (end < 0) continue;
    if (!best || end > best.end) best = { entry, periods, end };
  }
  if (!best) return null;
  const achievements = Array.isArray(best.entry.achievements) ? best.entry.achievements.length : 0;
  const floor = Math.min(3, achievements);
  if (floor === 0) return null;
  return { org: best.entry.org_name, period: best.periods[0], floor };
}

function readPeriods(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((v) => (typeof v === "string" ? v : (v as { period?: unknown })?.period))
    .filter((p): p is string => typeof p === "string" && p.trim() !== "");
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** 期間結束時間轉成可以比大小的數字（年 × 12 + 月）；「至今」最大，認不出年份回 -1。 */
function periodEnd(period: string): number {
  const end = period.split(/\s+[-–—~～]\s+|[–—~～]/).pop() ?? "";
  if (/present|now|current|至今|迄今|現在|目前/i.test(end)) return Number.MAX_SAFE_INTEGER;
  const year = end.match(/(19|20)\d{2}/);
  if (!year) return -1;
  const lower = end.toLowerCase();
  const named = MONTHS.findIndex((m) => lower.includes(m));
  const numbered = end.match(/(?:(?:19|20)\d{2}\s*[年./-]\s*)(\d{1,2})/);
  const month = named >= 0 ? named + 1 : numbered ? Number(numbered[1]) : 12;
  return Number(year[0]) * 12 + month;
}

/** 經歷資料庫裡的經歷都放進履歷了，每段也都放到上限（或資料庫裡的件數），沒東西可以補。 */
function dbExhausted(resume: Resume, entries: ExperienceEntryRow[]): boolean {
  const sections = [...(resume.work_experience ?? []), ...(resume.leadership ?? [])];
  const bullets = sections.reduce((n, e) => n + (e.bullets?.length ?? 0), 0);
  const count = (e: ExperienceEntryRow) => (Array.isArray(e.achievements) ? e.achievements.length : 0);
  const work = entries
    .filter((e) => e.entry_type === "work")
    .sort((a, b) => Math.max(-1, ...readPeriods(b.period_variants).map(periodEnd)) - Math.max(-1, ...readPeriods(a.period_variants).map(periodEnd)));
  const available =
    work.reduce((n, e, rank) => n + Math.min(count(e), rank === 0 ? LATEST_WORK_MAX : OTHER_WORK_MAX), 0) +
    entries.filter((e) => e.entry_type !== "work").reduce((n, e) => n + Math.min(count(e), LEADERSHIP_MAX), 0);
  return sections.length >= entries.length && bullets >= available;
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
  /** 這份應徵的清單裡、使用者按過「可以配合」的工作條件。只有這些能寫進摘要（摘要寫作規則 8）。 */
  confirmedConditions: string[];
  /** JD 關鍵字（招募官會逐字搜尋的字），有對應事實時用原字寫（排履歷規則 4）。 */
  keywords: string[];
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
    `===== JD 關鍵字（排履歷規則 4：有對應事實時用這些原字寫）=====`,
    params.keywords.length > 0 ? params.keywords.join("、") : "（無）",
    `===== 這份職缺使用者確認可以配合的工作條件（摘要寫作規則 8）=====`,
    params.confirmedConditions.length > 0 ? params.confirmedConditions.map((c) => `- ${c}`).join("\n") : "（無）",
    `===== 使用者其他個人資料 =====`,
    // 排版設定跟寫履歷無關，不給 AI 看；background、工作條件上面已經給過了。
    // 這裡可能還留著舊版上傳時存的學歷、技能（格式不固定），上面沒有的話可以參考這裡。
    JSON.stringify({ ...profile, resume_layout: undefined, background: undefined, work_conditions: undefined }, null, 2),
  ].join("\n\n");
}

/**
 * 這份應徵的清單裡、使用者自己按過「可以配合」的工作條件。
 * 只給這份 JD 自己的條件：以前把使用者所有回答過的條件都給 AI、讓 AI 判斷 JD 有沒有提到，
 * 結果 JD 只寫「與海外團隊合作」，摘要就被寫上別份職缺的「可配合出差至日本、新加坡」（2026-10-23）。
 */
function confirmedConditions(checklists: Record<string, JdChecklistItem[]>): string[] {
  const items = Object.values(checklists ?? {}).flat();
  return [...new Set(items.filter((i) => i.kind === "condition" && i.answer === "yes").map((i) => i.item.trim()))];
}

/**
 * 履歷頁「跟 AI 聊」：把右欄 JD 符合度清單裡還沒符合、部分符合的項目給 AI（2026-10-29 Z 要求）。
 * 以前 AI 只看得到 JD 全文，使用者說「補強 JD 缺的部分」時要自己重新判斷缺什麼，可能跟右欄對不上。
 * 判斷方式跟右欄一樣（JdChecklist 的 stateOf）：只看硬實力（軟實力在履歷頁不算分、工作條件另外由 confirmedConditions 處理），
 * 只算履歷本身寫到的（coveredByResume），判斷有問題的項目（invalid）不給。
 */
function jdGapsSection(items: JdChecklistItem[] | undefined): string {
  const gaps = (items ?? []).filter(
    (i) => (i.kind ?? "requirement") === "requirement" && !i.invalid && !coveredByResume(i),
  );
  if (gaps.length === 0) return "";
  const lines = gaps.map((i) => {
    const status = i.partial ? "部分符合" : "還沒寫到";
    const importance = i.importance === "required" ? "必要" : i.importance === "preferred" ? "加分" : null;
    const head = [status, importance].filter(Boolean).join("、");
    return `- 【${head}】${i.item}${i.gap ? `\n  缺口分析：${i.gap}` : ""}`;
  });
  return [
    `===== JD 符合度清單裡還缺的項目（使用者畫面右欄看到的，以最近一次評分為準）=====`,
    `使用者提到「JD 缺的」「還沒符合的」這類說法時，指的就是這幾項；要補強時照缺口分析的方向，只能用經歷資料庫裡有的、或使用者在對話裡親口講的事實，都沒有的就在 reply 說明缺什麼、請使用者直接在對話裡告訴你。`,
    ...lines,
  ].join("\n");
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

export function parseJsonResponse<T>(text: string): T {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "");

  try {
    return parseAiJson(cleaned, "generateResume") as T;
  } catch {
    throw new Error("AI 回傳的內容不是有效的 JSON，解析失敗");
  }
}

export interface ResumeChatTurn {
  role: "user" | "assistant";
  text: string;
}

/**
 * 履歷頁的「跟 AI 聊」：使用者用一句話說要怎麼改（例如「Northwind 那段多加兩條」「摘要改短一點」），
 * AI 照經歷資料庫跟使用者在對話裡講的事實改這一個語言版本，回傳改好的整份履歷跟一句說明。履歷不存檔、不重新評分，
 * 對話裡講的新事實會存回經歷資料庫（learnedBullets）；
 * 改完放進畫布草稿（可以復原），使用者按「儲存」才存。
 */
export async function reviseResumeWithChat(params: {
  supabase: SupabaseClient;
  userId: string;
  applicationId: string;
  language: string;
  resume: Resume;
  history: ResumeChatTurn[];
  instruction: string;
}): Promise<{ reply: string; resume: Resume; needsCheck: boolean; learned: unknown[] }> {
  const { supabase, userId, applicationId, language, resume, history, instruction } = params;

  const { data: application } = await supabase
    .from("applications")
    .select("job_description, jd_match_checklist, jd_keywords")
    .eq("id", applicationId)
    .eq("user_id", userId)
    .single();
  if (!application) throw new Error("找不到這筆應徵紀錄");

  const { langEntries, sourceLanguage } = await loadChatEntries(supabase, userId, language);

  const { data: profile } = await supabase.from("profile_data").select("data").eq("user_id", userId).maybeSingle();
  const background = readBackground(profile?.data)[language === "zh" ? "zh" : "en"];

  const basePrompt = buildUserPrompt({
    jd: application.job_description,
    language,
    sourceLanguage,
    entries: langEntries.map(({ id: _id, ...e }) => e), // eslint-disable-line @typescript-eslint/no-unused-vars
    profile: profile?.data ?? {},
    background: withReferenceSummaries(background, profile?.data),
    confirmedConditions: confirmedConditions(application.jd_match_checklist ?? {}),
    keywords: application.jd_keywords ?? [],
  });

  type ChatResponse = {
    reply?: string;
    mode?: string;
    ops?: unknown;
    resume?: Resume | null;
    remember?: string[];
    learned?: unknown;
  };
  const ask = async (forceFull: boolean, retryNote?: string) => {
    // 格式壞掉修不好就自動再問一次，不用使用者重送。
    const { data: parsed } = await askClaudeForJson<ChatResponse>({
      userId,
      feature: forceFull ? "resume_chat_full" : "resume_chat",
      systemPrompt: SYSTEM_PROMPT,
      userPrompt: [
        basePrompt,
        jdGapsSection(application.jd_match_checklist?.[language]),
        `===== 目前的履歷（id 只是給你指名用的）=====`,
        JSON.stringify(resumeForPatch(resume), null, 2),
        history.length > 0
          ? `===== 之前的對話 =====\n${history.map((t) => `${t.role === "user" ? "使用者" : "AI"}：${t.text}`).join("\n")}`
          : "",
        `===== 使用者這次的要求 =====`,
        instruction,
        `===== 這次要做的事 =====`,
        `- 照使用者的要求修改目前的履歷，沒被要求的地方原則上不要動。`,
        // 2026-10-31：經歷資料庫有長短兩版時，AI 把長版當原文「縮短」，回傳的就是履歷上原本那條（見 resumePatch.ts 的 isNoopRevision）。
        `- 要改的是上面「目前的履歷」裡的文字。經歷資料庫只拿來查事實，同一件事在資料庫裡可能有好幾種寫法，不要把資料庫的寫法當成要改的原文。replace、summary、skills 的內容不能跟目前的一模一樣；看過之後真的不需要改，ops 給空陣列，reply 照實說明原因，不能說已經改好。`,
        // 2026-10-30 Z：缺數字時不要叫使用者跑去經歷資料庫，在這裡講的數字就能用（使用者親口講＝他掛保證）。
        `- 事實來源：經歷資料庫，加上使用者在這次或之前的對話裡親口告訴你的事（例如補了一個數字、講了一件資料庫沒有的成果）。使用者親口講的可以直接寫進 bullet（可以照寫作規則改寫）；兩邊都沒有的就不要編，在 reply 說明缺什麼，請使用者直接在對話裡告訴你。`,
        `- learned：這次寫進履歷的 bullet 用到了使用者在對話裡親口講、經歷資料庫裡沒有的事實時，每條列一筆 { "achievementId": 經歷資料庫裡講同一件事的 achievement id（資料庫沒有這件事就給 null）, "org": 這條所在經歷的公司名稱（照目前履歷上的寫）, "text": 這條 bullet 改好的全文 }，系統會存回經歷資料庫。沒用到新事實就給空陣列。`,
        `- ${REMEMBER_RULE}`,
        `- reply 不要提「規則 N」這類編號。`,
        RESUME_PATCH_FORMAT,
        forceFull ? `- 這次一定要用 full，resume 給整份履歷。` : "",
        retryNote ?? "",
        CHAT_REPLY_FORMAT,
        `- 只輸出 JSON，不要有其他文字。`,
      ]
        .filter(Boolean)
        .join("\n\n"),
      maxTokens: 8000,
      supabase,
    });
    const full = parsed.mode === "full" || forceFull;
    const revised = full ? (isResumeShape(parsed.resume) ? parsed.resume : null) : applyResumePatch(resume, parsed.ops);
    const noop = !!revised && isNoopRevision(resume, revised, full ? "full" : "patch", parsed.ops);
    return { parsed, revised, noop };
  };
  // 先要 AI 只回傳改到的地方；ops 看不懂或 id 對不上，就再問一次、這次要整份（慢，但不會改錯條）。
  const askRevised = async (retryNote?: string) => {
    const first = await ask(false, retryNote);
    return first.revised ? first : ask(true, retryNote);
  };

  let { parsed, revised, noop } = await askRevised();
  // AI 送出了修改，改完卻跟原本一樣：附上它沒改到的原文再問一次。
  if (noop) {
    const targets = noopTargets(resume, parsed.ops);
    ({ parsed, revised, noop } = await askRevised(
      `- 注意：你上一次回傳的修改跟目前的履歷一模一樣，等於沒改${targets.length > 0 ? `（${targets.join("；")}）` : ""}。請以目前履歷上的文字為基礎，照使用者的要求修改；如果它已經符合要求、真的沒有可以改的地方，ops 給空陣列，reply 照實說明原因並問使用者想怎麼改。`,
    ));
  }
  if (!revised) throw new Error("AI 沒有回傳改好的履歷，請換個說法再試一次");
  await rememberNotes(supabase, userId, (parsed.remember ?? []).map((t) => toTraditional(t)));
  const next = sortWorkByRecency(pinBackground(revised, background));
  // 學歷 AI 本來就不能改；使用者在畫布上手動改過的話，沿用這份履歷目前的，不要被經歷資料庫的版本蓋回去。
  next.education = resume.education;
  if (language === "zh") polishChinese(next);
  next.layout = resume.layout;

  // 用到使用者在對話裡講的新事實：存回經歷資料庫，下次重新產生才帶得進來（背景檢查完才存，存的是檢查後的版本）。
  // 經歷資料庫沒有這個語言（履歷是從另一個語言翻的）就不存，免得把這個語言的句子存進另一個語言的資料。
  const willSave =
    sourceLanguage === language && learnedBullets(parsed.learned, langEntries, next, new Map(), language).length > 0;

  // 問了兩次還是沒改到：不能照 AI 的回覆說「改好了」。
  const reply = noop
    ? "我改出來的跟目前寫的一樣，所以這次沒有改到任何內容。可以說得具體一點嗎？例如想拿掉哪個部分、要縮到多短。"
    : stripRuleRefs(toTraditional(parsed.reply ?? "改好了。"));
  const notes = [reply, willSave ? `這次補的內容會存回經歷資料庫，之後重新產生也會帶進來。` : ""].filter(Boolean);
  // 寫法檢查不在這裡等（2026-10-31 Z：聊天還是很慢，檢查常常比修改本身還久）：
  // 履歷先回給使用者，畫面再呼叫 checkResumeChatRevision 在背景檢查，結果回來再套用。
  return {
    reply: notes.join("\n\n"),
    resume: next,
    needsCheck: changedBullets(resume, next).length > 0 || willSave,
    learned: willSave && Array.isArray(parsed.learned) ? parsed.learned : [],
  };
}

type ChatEntry = ExperienceEntryRow & { id: string };

/** 聊天用的經歷資料庫：這個語言沒有就用另一個語言的（履歷是從另一個語言翻的）。 */
async function loadChatEntries(
  supabase: SupabaseClient,
  userId: string,
  language: string,
): Promise<{ langEntries: ChatEntry[]; sourceLanguage: string }> {
  const { data: entries } = await supabase
    .from("experience_entries")
    .select("id, language, entry_type, org_name, location, role_variants, period_variants, achievements")
    .eq("user_id", userId);
  const all = (entries ?? []) as ChatEntry[];
  const own = all.filter((e) => e.language === language);
  if (own.length > 0) return { langEntries: own, sourceLanguage: language };
  const sourceLanguage = language === "en" ? "zh" : "en";
  return { langEntries: all.filter((e) => e.language === sourceLanguage), sourceLanguage };
}

export interface ChatRewrite {
  /** 檢查前的文字（畫面上這條還是這個字才換，使用者改過或下一則訊息改掉了就不換）。 */
  from: string;
  to: string;
}

/**
 * 履歷頁「跟 AI 聊」改完之後的寫法檢查，在背景跑：畫面先顯示改好的履歷，這裡回傳要換掉的條目跟缺數字的提醒。
 * 使用者在對話裡講的新事實也在這裡存回經歷資料庫（要用檢查後的版本）。
 */
export async function checkResumeChatRevision(params: {
  supabase: SupabaseClient;
  userId: string;
  applicationId: string;
  language: string;
  before: Resume;
  after: Resume;
  instruction: string;
  learned: unknown[];
  /** 之前幾則訊息改到、檢查結果被作廢（使用者先送了下一則）的條目，這次一起檢查。 */
  alsoCheck?: string[];
}): Promise<{ rewrites: ChatRewrite[]; missingNote: string | null }> {
  const { supabase, userId, applicationId, language, before, instruction } = params;
  const { data: application } = await supabase
    .from("applications")
    .select("job_description")
    .eq("id", applicationId)
    .eq("user_id", userId)
    .single();
  if (!application) throw new Error("找不到這筆應徵紀錄");
  const { data: profile } = await supabase.from("profile_data").select("data").eq("user_id", userId).maybeSingle();

  const checked = structuredClone(params.after);
  const check = await checkChangedBullets({
    supabase,
    userId,
    before,
    after: checked,
    alsoCheck: params.alsoCheck,
    jd: application.job_description,
    instruction,
    mutedRules: new Set(readRuleTags((profile?.data as { muted_rules?: unknown } | undefined)?.muted_rules)),
  });
  if (language === "zh") polishChinese(checked);

  const rewrites: ChatRewrite[] = [];
  for (const section of ["work_experience", "leadership"] as const) {
    (params.after[section] ?? []).forEach((e, i) =>
      (e.bullets ?? []).forEach((from, j) => {
        const to = checked[section]?.[i]?.bullets?.[j];
        if (to && to !== from) rewrites.push({ from, to });
      }),
    );
  }

  if (params.learned.length > 0) {
    const { langEntries, sourceLanguage } = await loadChatEntries(supabase, userId, language);
    const toSave =
      sourceLanguage === language ? learnedBullets(params.learned, langEntries, checked, check.results, language) : [];
    if (toSave.length > 0) {
      // 補其他寫法、同步另一個語言要多花幾秒：結果先回給畫面，存檔在回應送出後才跑。
      after(async () => {
        for (const item of toSave) {
          const base = { supabase, userId, entryId: item.entryId, text: item.text, reviewed: item.reviewed };
          const source = "履歷頁跟 AI 聊";
          const result = item.achievementId
            ? await saveRefinedVariant({ ...base, achievementId: item.achievementId, angleLabel: "補上成果", source, mode: "append" })
            : await addAchievement({ ...base, angleLabel: "履歷頁補充", source });
          if (result.error) console.error("[resume_chat] 存回經歷資料庫失敗：", result.error, item.text);
        }
      });
    }
  }

  return { rewrites, missingNote: check.missingNote };
}

/**
 * AI 回報用到新事實的 bullet，對回經歷資料庫的位置。achievement id 對不上、公司找不到、
 * 或這條最後沒出現在履歷裡（AI 說的跟做的不一樣）就跳過，不猜。文字用檢查、潤飾完的最終版本。
 */
function learnedBullets(
  learned: unknown,
  entries: ChatEntry[],
  finalResume: Resume,
  checked: Map<string, { text: string; passed: boolean }>,
  language: string,
): Array<{ entryId: string; achievementId: string | null; text: string; reviewed: boolean }> {
  if (!Array.isArray(learned)) return [];
  const finalBullets = new Set(
    [...(finalResume.work_experience ?? []), ...(finalResume.leadership ?? [])].flatMap((e) => e.bullets ?? []),
  );
  const fix = (t: string) => (language === "zh" ? addCjkSpacing(toFullWidthPunctuation(toTraditional(t))) : t);
  const achievementsOf = (e: ExperienceEntryRow) =>
    (Array.isArray(e.achievements) ? e.achievements : []) as Array<{ id?: string }>;

  return learned.flatMap((raw: { achievementId?: unknown; org?: unknown; text?: unknown }) => {
    const aiText = typeof raw?.text === "string" ? raw.text.trim() : "";
    if (!aiText) return [];
    const result = checked.get(aiText);
    const text = fix(result?.text ?? aiText);
    if (!finalBullets.has(text)) return [];

    const achievementId = typeof raw.achievementId === "string" ? raw.achievementId : null;
    const byAchievement = achievementId ? entries.find((e) => achievementsOf(e).some((a) => a.id === achievementId)) : null;
    if (achievementId && !byAchievement) return [];
    const entry =
      byAchievement ?? entries.find((e) => typeof raw.org === "string" && normalize(e.org_name) === normalize(raw.org));
    if (!entry) return [];
    return [{ entryId: entry.id, achievementId, text, reviewed: result?.passed ?? false }];
  });
}

/** 這次新增或改到的 bullet（文字在修改前的履歷裡找不到的），加上 alsoCheck 指定、還在履歷上的條目。 */
function changedBullets(before: Resume, after: Resume, alsoCheck: string[] = []) {
  const old = new Set(
    [...(before.work_experience ?? []), ...(before.leadership ?? [])].flatMap((e) => e.bullets ?? []),
  );
  const extra = new Set(alsoCheck);
  return [...(after.work_experience ?? []), ...(after.leadership ?? [])].flatMap((e) =>
    (e.bullets ?? []).flatMap((text, i) =>
      text.trim() && (!old.has(text) || extra.has(text)) ? [{ entry: e, i, text }] : [],
    ),
  );
}

/** 「跟 AI 聊」改完，用跟經歷資料庫同一套檢查（checkBullets.ts）檢查這次新增或改到的 bullet（2026-10-29 Z 要求全系統標準一致）。
 * 寫法問題直接換成改寫（改 after）；缺數字改寫補不了（不能編），回傳一段提醒，請使用者直接在對話裡回數字。
 * results：檢查前的文字 → 檢查後的文字、有沒有通過，存回經歷資料庫時用。 */
async function checkChangedBullets(params: {
  supabase: SupabaseClient;
  userId: string;
  before: Resume;
  after: Resume;
  alsoCheck?: string[];
  jd: string;
  instruction: string;
  mutedRules: Set<string>;
}): Promise<{ missingNote: string | null; results: Map<string, { text: string; passed: boolean }> }> {
  const none = { missingNote: null, results: new Map<string, { text: string; passed: boolean }>() };
  const changed = changedBullets(params.before, params.after, params.alsoCheck);
  if (changed.length === 0) return none;

  const results = await checkBullets({
    supabase: params.supabase,
    userId: params.userId,
    feature: "resume_chat_check",
    items: changed.map((c) => ({ text: c.text })),
    mutedRules: params.mutedRules,
    jd: params.jd,
    instruction: params.instruction,
  });
  if (!results) return none;

  results.forEach((r, k) => {
    if (r.rewritten) changed[k].entry.bullets[changed[k].i] = r.text;
  });
  const checked = new Map(changed.map((c, k) => [c.text, { text: results[k].text, passed: !results[k].missingEvidence }]));
  const missing = results
    .filter((r) => r.missingEvidence)
    .map((r, k) => `${k + 1}. 「${r.text.slice(0, 14)}…」：${r.missingEvidence}`);
  // 2026-10-30 Z：不要叫使用者跑去經歷資料庫補，直接在這裡回數字就好，補的會存回經歷資料庫。
  const missingNote =
    missing.length > 0
      ? `這幾條還缺數字或成果，有的話直接回我（例如「第 1 條：報名人數從 200 變 500」），我幫你補上、也存回經歷資料庫；真的沒有也可以維持現在的寫法：\n${missing.join("\n")}`
      : null;
  return { missingNote, results: checked };
}
