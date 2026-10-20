// 履歷 bullet 寫作規則（中英共用）。2026-09-29 跟 Z 討論定案，2026-09-30 依寫作準則補上誠實、關鍵字等規則。
// 經歷資料庫的「檢查」「AI 潤飾」「快速檢查」、生成履歷都用這一份，
// 檢查的標準跟改寫的標準才會一致（以前分開寫，潤飾完又被檢查標出同樣的問題）。

export const BULLET_RULES = `履歷 bullet 寫作規則（中英共用）：
1. 結構：動詞開頭，接具體任務，最後放量化成果；有需要可以再加一小段簡短的做法，交代怎麼做到的。英文用強動詞，不用第一人稱，時態正確（過去的工作用過去式，現職用現在式）。不用聽起來很棒但空洞的抽象說法開頭（例如 Brought structure to…），一定要有具體的「做了什麼」跟「結果是什麼」。
2. 長度：1 到 2 行，以一句為主，非必要不加第二句。中文約 60 到 70 字內，英文約 30 words 內，實際以排版後不超過 2 行為準。
3. 一條一件事：一條只講一個主要成果。多個階段就拆開，或只留最強的那個。一句話不要塞三個以上的動作或子句。
4. 證據：要有數字（%、金額、人數、時間）或具體結果。問不到數字就寫規模或頻率。數字必須是使用者在面試中講得出來源的，問不到就不要編。
5. 誠實：每一句都要有使用者資料裡的事實支撐，不能為了對應 JD 關鍵字編造、誇大，也不能把某個方法或技巧寫到錯的專案上（方法歸屬錯了跟捏造一樣嚴重）。個人專案、還在小範圍測試的產品，不用「上線、發布」或 launched、released，改用「開發、實測」這類中性說法，除非資料裡明確寫了已經正式上線。改寫弱動詞時不能把參與程度往上拉：「參與、協助」或 Participated、Helped、Responsible for 不能變成「主導、規劃」或 Led、Spearheaded，只能換成實際做的具體動作；看不出自己做了哪一塊，就維持原本的參與程度。
6. 取捨：不寫步驟式的過程描述，空泛形容詞一律刪。時間軸、協作過程、後續維運這類內容，依目標 JD 決定留不留，JD 有要求就保留（例如上線後追蹤 bug 對上線支援類職缺、跨國協作對外商 PM），無關就刪；沒有目標 JD 時（經歷資料庫），預設精簡掉。不用「負責／參與／協助」或 Responsible for / Helped 開頭。
7. 關鍵字：JD 的用字要從具體案例的敘述裡自然出現，不要放在句首當標籤（例如 Skilled at hypothesis-driven problem solving），讀起來會像關鍵字堆疊。非技術職缺不用過度技術化的詞（例如 data architecture redesign），換成一般人看得懂的說法。
8. 動詞多樣性：整份履歷裡動詞不要重複，每條換一個。
9. 標點與句型：不用 em-dash，中文破折號也不用，改用逗號、分號或拆成兩句。不用三項並列湊字數。中文一律用全形標點。
10. 用詞：低 AI 感。中文避開「賦能、串聯、橋樑」這類詞，也避開翻譯腔；英文避開 spearheaded、leveraged、orchestrated、synergized 這類慣用 AI 腔動詞。目標是一般人會自然寫出來的說法，不是逐字避開某個詞。
11. 檢查：全部符合就算通過。`;

/** 同一件事改寫前後的示範，給改寫用的 prompt 參考。 */
export const BULLET_EXAMPLE = `反面範例（流水帳）：「負責電商網站結帳流程的改版規劃，歷時四個月完成，期間與工程師、行銷部門跨部門協作，改版後結帳轉換率由 2.8% 提升至 3.6%，之後也持續追蹤使用者回饋並修正問題。」
正面範例（同一件事，一句話、成果放最後）：「重新設計電商網站的結帳流程，將結帳轉換率由 2.8% 提升至 3.6%。」`;

// ---------- 給使用者看的規則標籤 ----------
// 上面的規則是給 AI 看的（有編號），使用者看不到。檢查建議改成回傳下面的標籤代號，
// 畫面上顯示白話名稱，滑過 ⓘ 看說明；使用者也可以把某一類關掉，之後檢查不再標記（只影響檢查，不影響生成履歷）。

export interface BulletRuleTag {
  id: string;
  /** 卡片上的標籤文字。 */
  name: string;
  /** ⓘ 裡的說明。 */
  description: string;
}

export const BULLET_RULE_TAGS: BulletRuleTag[] = [
  { id: "structure", name: "句子結構", description: "動詞開頭，接著寫做了什麼，最後放成果。不要用空泛的說法開頭。" },
  { id: "length", name: "太長", description: "一條控制在 1–2 行：中文約 60–70 字、英文約 30 個字以內。" },
  { id: "one-thing", name: "一條一件事", description: "一條只講一個主要成果。好幾個階段就拆開，或只留最強的那個。" },
  { id: "evidence", name: "缺數字或成果", description: "加上數字（%、金額、人數、時間）或具體結果；真的沒有數字就寫規模或頻率。" },
  { id: "honesty", name: "誇大或不精確", description: "每一句都要有事實根據；「參與、協助」不能寫成「主導」，還沒正式上線的不要寫「上線」。" },
  { id: "process", name: "流水帳", description: "不寫一步一步的過程，刪掉空泛的形容詞；不用「負責、參與、協助」開頭。" },
  { id: "keywords", name: "關鍵字太刻意", description: "關鍵字要自然出現在具體案例裡，不要放在句首當標籤，也不要用太技術的詞。" },
  { id: "verb-variety", name: "動詞重複", description: "整份履歷每條換一個動詞，不要一直用同一個。" },
  { id: "punctuation", name: "標點句型", description: "不用破折號、不用三項並列湊字數；中文用全形標點。" },
  { id: "ai-tone", name: "AI 腔", description: "避開「賦能、串聯、橋樑」、spearheaded、leveraged 這類 AI 常用詞，寫成一般人會說的話。" },
  { id: "typo", name: "錯字", description: "錯字、漏字、重複字。" },
];

const TAG_IDS = new Set(BULLET_RULE_TAGS.map((t) => t.id));

/** 只留認得的標籤代號。 */
export function readRuleTags(raw: unknown): string[] {
  return Array.isArray(raw) ? [...new Set(raw.filter((id): id is string => typeof id === "string" && TAG_IDS.has(id)))] : [];
}

/** 給 AI 看的標籤對照（規則編號 → 代號），要求它回傳代號、不要在建議裡提編號。 */
export const RULE_TAG_INSTRUCTIONS = `每條建議都要附上 rules：這條違反了哪幾類，用下面的代號（不是規則編號）：
structure＝規則 1 結構、length＝規則 2 長度、one-thing＝規則 3 一條一件事、evidence＝規則 4 證據、honesty＝規則 5 誠實、process＝規則 6 取捨（流水帳、弱動詞開頭）、keywords＝規則 7 關鍵字、verb-variety＝規則 8 動詞多樣性、punctuation＝規則 9 標點與句型、ai-tone＝規則 10 用詞、typo＝錯字。
使用者看不到上面的規則清單，所以建議文字裡絕對不要出現「規則 1」「規則 10」「rule 3」這類編號或代號，直接用白話講問題在哪。`;

/** 保險：AI 還是寫了「規則 1 與規則 10」「（規則 3、4）」這類編號時，從文字裡拿掉。 */
export function stripRuleRefs(text: string): string {
  return text
    .replace(/[（(]\s*(?:違反)?\s*(?:規則|rule)\s*\d+(?:\s*[、,，與和及&]\s*(?:規則|rule)?\s*\d+)*\s*[）)]/gi, "")
    .replace(/(?:依照|依|根據|按照)?\s*(?:違反|不符合|符合)?\s*(?:規則|rule)\s*\d+(?:\s*[、,，與和及&]\s*(?:規則|rule)?\s*\d+)*\s*(?:的要求|要求)?\s*[：:，,]?\s*/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}
