import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { askClaude } from "@/lib/ai/askClaude";

// Phase 2.5：AI 問答挖掘的共用對話引擎。使用者可能只有一段很籠統的描述，這個引擎透過
// 多輪對話把內容問成「動詞開頭＋具體任務＋量化成果」的專業寫法，最多問 10 輪，
// 通常 2-4 輪就該收斂——這些規則都寫在 prompt 裡讓 AI 自己掌握節奏，不是寫死的題庫，
// 但 prompt 明確要求優先問「量化數字→規模/角色→結果影響」這三個面向，維持問法穩定、
// 不會每次都從頭亂猜要問什麼。
//
// 這裡只負責「對話」本身，不負責寫回資料庫——收斂完的 draftText/angleLabel 交給呼叫端
// （手動新增一段經歷、AI 潤飾既有 bullet、JD 缺口挖掘）自己決定要寫進哪個 entry/achievement。

export interface DialogueTurn {
  role: "assistant" | "user";
  text: string;
}

export interface DialogueContext {
  orgName: string;
  role: string;
  /** 已知的既有內容（AI 潤飾既有 bullet、或 JD 缺口描述）當作對話起點，全新新增時留空 */
  seedText?: string;
  /** JD 缺口挖掘時，把這項 JD 要求也給 AI 參考，問題會更貼近這個缺口 */
  jdContext?: string;
}

export interface DialogueStepResult {
  turns: DialogueTurn[];
  status: "asking" | "ready";
  draftText: string | null;
  angleLabel: string | null;
}

const SYSTEM_PROMPT = `你是履歷經歷挖掘助手。使用者想把一段經歷寫成履歷會用的專業 bullet，但可能還沒想清楚怎麼寫，或只有一段籠統的描述。你的工作是透過對話問出具體細節，把內容問成「動詞開頭＋具體任務＋量化成果」的專業寫法。

規則：
1. 一次只問一個問題，不要一次列一堆問題，語氣自然、口語，不要生硬。
2. 依序優先問這三個常見缺的面向，跳過使用者已經提供的部分：(a) 量化數字（影響多少人、花多久、改善幾 %、金額等）(b) 規模/角色（自己主導還是協助、影響範圍多大）(c) 結果/影響（改變了什麼、對誰有幫助）。
3. 最多問 10 輪，通常 2-4 輪就該收斂，收集到足夠具體的資訊就儘早結束，不要為了湊題數硬問一些無關緊要的細節。
4. 準備收斂成最終寫法之前，先用一句話重述你理解到的內容，問使用者「這樣理解對嗎」，不要沒確認過就直接定案。使用者回覆確認沒問題（或已經到第 10 輪），才把 status 設成 "ready" 並附上 draftText 跟 angleLabel；使用者說不對或要調整，就繼續問或修正理解，status 維持 "asking"。
5. status 是 "ready" 時，draftText 要用 Google 履歷寫作團隊公開提倡的 XYZ 公式：「達成了 X（成果，不是被交辦的任務）／用什麼衡量 Y（數字、百分比、金額、規模）／透過什麼方法做到 Z」。具體規則：
   - **最多兩句話**，這是硬性上限，不是「盡量」——寫完先數一次句號有幾個。
   - **先講成果、再講數字、最後才是方法**，不要按時間順序把「做了什麼→花多久→怎麼協作→上線後→後續維護」全部串成一條流水帳。時間軸、協作方式、後續維運這些過程細節，除非本身就是重點成果，否則直接刪掉。
   - 一條 bullet 只講一件成果，不要把好幾個階段/好幾個成果硬塞進同一條——問出來的細節如果包含多個成果，draftText 只取「最值得放進履歷」的那一個，其餘留給使用者自己決定要不要另外新增一條。
   - 禁止 em-dash、禁止三個並列動詞的偷懶清單、禁止空泛形容詞堆疊（「持續」「積極」「良好」這類詞如果沒有接數字或具體事實，一律刪掉）。
   - 反面範例（禁止長成這樣，這是流水帳，不是履歷）：「主導銀行App首頁UI/UX優化設計與切版，歷時半年完成，並與工程師、PM跨部門協作推動專案於一年內上線。上線後App Store評分由2.1提升至4.6，同時持續追蹤並排除bug以維持功能穩定運作。」
   - 正面範例（同一件事，改成 XYZ、兩句話、成果優先）：「主導銀行 App 首頁改版，App Store 評分由 2.1 分回升至 4.6 分。跨部門協調工程師與 PM，半年內完成設計到上線。」
   - angleLabel 是一句話描述這個寫法強調的重點（例如「強調數據分析成果」），給使用者自己參考挑選用，不會出現在正式履歷裡。
6. 全程使用繁體中文。
7. 不要編造使用者沒提過的具體數字或事實；真的問不到數字，用範圍/頻率/規模代替，不要空著不寫也不要瞎編。
8. 只輸出 JSON，不要有其他文字、不要用 markdown code fence 包起來。

輸出格式：
{ "status": "asking" | "ready", "message": string, "draftText": string | null, "angleLabel": string | null }`;

export async function stepElicitation(params: {
  supabase: SupabaseClient;
  userId: string;
  context: DialogueContext;
  turns: DialogueTurn[];
  userReply: string | null;
}): Promise<DialogueStepResult> {
  const { supabase, userId, context, turns, userReply } = params;

  const updatedTurns: DialogueTurn[] = userReply
    ? [...turns, { role: "user", text: userReply }]
    : turns;

  const questionsAskedSoFar = updatedTurns.filter((t) => t.role === "assistant").length;
  const forceReady = questionsAskedSoFar >= 10;

  const userPrompt = [
    `===== 這段經歷屬於 =====`,
    `${context.orgName} / ${context.role}`,
    context.seedText ? `===== 已知的既有內容 =====\n${context.seedText}` : "",
    context.jdContext ? `===== 這次特別想補強的 JD 要求 =====\n${context.jdContext}` : "",
    `===== 目前為止的對話（AI 已經問了 ${questionsAskedSoFar} 輪）=====`,
    updatedTurns.length > 0
      ? updatedTurns.map((t) => `${t.role === "assistant" ? "AI" : "使用者"}：${t.text}`).join("\n")
      : "（還沒開始，這是第一句話，直接問第一個問題）",
    forceReady ? "已經問滿 10 輪，這次一定要收斂成 status: ready，不能再問問題。" : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  const response = await askClaude({
    userId,
    feature: "experience_elicitation",
    systemPrompt: SYSTEM_PROMPT,
    userPrompt,
    maxTokens: 2000,
    supabase,
  });

  const parsed = parseJsonResponse(response.text);

  return {
    turns: [...updatedTurns, { role: "assistant", text: parsed.message }],
    status: parsed.status,
    draftText: parsed.draftText,
    angleLabel: parsed.angleLabel,
  };
}

interface RawResponse {
  status: "asking" | "ready";
  message: string;
  draftText: string | null;
  angleLabel: string | null;
}

function parseJsonResponse(text: string): RawResponse {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "");

  try {
    return JSON.parse(cleaned) as RawResponse;
  } catch {
    throw new Error("AI 回傳的對話內容不是有效的 JSON，解析失敗");
  }
}

/** 「已經想好了，自己寫」這條路徑用的輕量檢查：只判斷寫得夠不夠具體，不開對話。 */
export async function quickQualityCheck(params: {
  supabase: SupabaseClient;
  userId: string;
  orgName: string;
  role: string;
  text: string;
}): Promise<{ isVague: boolean; suggestion: string | null }> {
  const systemPrompt = `你是履歷內容品質檢查助手。使用者直接打了一條經歷描述，用 Google 履歷寫作團隊提倡的 XYZ 公式（達成了什麼成果 X／用什麼數字衡量 Y／透過什麼方法 Z）檢查兩件事：
1. 夠不夠具體：有沒有動詞開頭、具體任務、量化成果或明確結果。
2. 是不是流水帳：超過兩句話、或按時間順序把好幾個階段/好幾件事塞進同一條（例如「做了什麼→花多久→怎麼協作→上線後→後續維護」全部寫進去），這樣就算已經有數字也算不合格，因為重點被稀釋掉了。

兩者只要有一個不合格就算 isVague。已經是精簡的 XYZ 寫法（成果優先、頂多兩句話、有數字）就不用挑剔。只輸出 JSON，不要其他文字：
{ "isVague": boolean, "suggestion": string | null }
suggestion 只在 isVague 為 true 時給，一句話講清楚問題在哪、可以怎麼改（例如「這條把好幾個階段串在一起了，先只留最值得講的那個成果就好」），不要落落長。`;

  const userPrompt = `${params.orgName} / ${params.role}\n\n使用者寫的內容：\n${params.text}`;

  const response = await askClaude({
    userId: params.userId,
    feature: "experience_quality_check",
    systemPrompt,
    userPrompt,
    maxTokens: 500,
    supabase: params.supabase,
  });

  const cleaned = response.text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "");

  return JSON.parse(cleaned) as { isVague: boolean; suggestion: string | null };
}
