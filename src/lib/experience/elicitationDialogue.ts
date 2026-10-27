import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { askClaude } from "@/lib/ai/askClaude";
import { REMEMBER_RULE, rememberNotes } from "@/lib/ai/userMemory";
import { toTraditional } from "@/lib/text/toTraditional";
import { BULLET_EXAMPLE, BULLET_RULES, stripRuleRefs } from "./bulletRules";

// Phase 2.5：AI 問答挖掘的共用對話引擎。使用者可能只有一段很籠統的描述，這個引擎透過
// 多輪對話把內容問成符合 bulletRules.ts 的專業寫法，最多問 10 輪，
// 通常 2-4 輪就該收斂——這些規則都寫在 prompt 裡讓 AI 自己掌握節奏，不是寫死的題庫，
// 但 prompt 明確要求優先問「量化數字→規模/角色→結果影響」這三個面向，維持問法穩定、
// 不會每次都從頭亂猜要問什麼。
//
// 這裡只負責「對話」本身，不負責寫回資料庫——收斂完的 drafts 交給呼叫端
// （手動新增一段經歷、AI 潤飾既有 bullet、JD 缺口挖掘）自己決定要寫進哪個 entry/achievement。
// 全新的經歷，使用者一次講了好幾件事就拆成好幾點；潤飾既有 bullet、JD 缺口挖掘一律只給一點。

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
  /** 從「建議加強」卡片進來潤飾時，卡片上寫的問題（這條為什麼被標記）。改寫一定要先解決這個問題。 */
  issue?: string;
}

export interface DialogueDraft {
  text: string;
  angleLabel: string;
}

export interface DialogueStepResult {
  turns: DialogueTurn[];
  status: "asking" | "ready";
  /** 收斂後的寫法，一件事一點。只會有一點的呼叫端（潤飾、JD 缺口）用下面的 draftText 就好。 */
  drafts: DialogueDraft[];
  draftText: string | null;
  angleLabel: string | null;
}

const SYSTEM_PROMPT = `你是履歷經歷挖掘助手。使用者想把一段經歷寫成履歷會用的專業 bullet，可能只有一段籠統的描述，也可能是一條已經寫好、但被檢查出問題的 bullet。你的工作是用最少的來回，產出符合下面規則的 bullet：潤飾既有內容、或有「這次特別想補強的 JD 要求」時只產出一條；全新的經歷依使用者講了幾件事產出一條或好幾條。

${BULLET_RULES}

${BULLET_EXAMPLE}

對話規則：
1. 一次只問一個問題，不要一次列一堆問題，語氣自然、口語，不要生硬。
2. 潤飾既有內容時（有「已知的既有內容」）：
   - 有「這條被標記的問題」時，改寫一定要先解決那個問題（例如被標記流水帳，就要真的只留一個成果、刪掉過程）。
   - 既有內容的事實已經夠寫出合格的一條，就**第一輪直接給改寫版本**（status 設成 "ready"），message 用一兩句話說明改了什麼、為什麼，不用先問問題也不用先確認理解。
   - 只有缺了規則 4 要的數字或具體結果，才先問一個問題補資訊。
3. 全新的經歷（沒有既有內容）：依序優先問 (a) 量化數字 (b) 規模/角色 (c) 結果/影響，跳過使用者已經提供的部分。收斂前先用一句話重述你的理解，問「這樣理解對嗎」，使用者確認了才把 status 設成 "ready"。
   - 使用者講了好幾件不同的事（不同專案、不同成果），一件事寫成一條，條數不設上限；同一件事不要拆成好幾條湊數，也不要把好幾件事硬塞成一條。
   - 有好幾件事時，追問一樣一次一題，先問最缺數字或成果的那件；同一件問兩次還問不到，就用規模或頻率寫，換下一件。
   - 有好幾件事時，重述理解要條列出「我會寫成這幾點」，每點一句話，讓使用者一次確認。
4. 最多問 10 輪，通常 2-4 輪就該收斂，資訊夠了就儘早結束，不要為了湊題數硬問。
5. status 是 "ready" 時，drafts 裡每一條的 text 都必須逐條符合上面的寫作規則，寫完先自己檢查一遍；好幾條的話動詞不要重複。angleLabel 是一句話描述這條強調的重點（例如「強調數據分析成果」），給使用者自己參考挑選用，不會出現在正式履歷裡。
6. message 一律用繁體中文（台灣用語），絕對不要出現簡體字。drafts 的語言跟既有內容相同；全新經歷則依使用者回覆的語言，中文一律繁體。
7. 不要編造使用者沒提過的具體數字或事實；真的問不到數字，用範圍/頻率/規模代替。
8. 使用者看不到上面的寫作規則清單，message 裡不要提「規則 1」「規則 10」這類編號，直接用白話講。
9. ${REMEMBER_RULE}（「已記住：…」寫在 message 裡）
10. 只輸出 JSON，不要有其他文字、不要用 markdown code fence 包起來。

輸出格式：
{ "status": "asking" | "ready", "message": string, "drafts": [{ "text": string, "angleLabel": string }] | null, "remember": string[] }
status 是 "asking" 時 drafts 給 null。`;

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
    context.issue ? `===== 這條被標記的問題（改寫一定要解決）=====\n${context.issue}` : "",
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
  await rememberNotes(supabase, userId, (parsed.remember ?? []).map((t) => toTraditional(t)));
  const drafts = readDrafts(parsed);
  // 潤飾、JD 缺口只能放一條，AI 萬一給了好幾條就只取第一條。
  const singleOnly = Boolean(context.seedText || context.jdContext);
  const finalDrafts = singleOnly ? drafts.slice(0, 1) : drafts;

  return {
    turns: [...updatedTurns, { role: "assistant", text: stripRuleRefs(toTraditional(parsed.message)) }],
    // 說 ready 卻沒給任何一條，就當成還在問，不要讓畫面跳到空白的確認畫面。
    status: parsed.status === "ready" && finalDrafts.length > 0 ? "ready" : "asking",
    drafts: finalDrafts,
    draftText: finalDrafts[0]?.text ?? null,
    angleLabel: finalDrafts[0]?.angleLabel ?? null,
  };
}

interface RawResponse {
  status: "asking" | "ready";
  message: string;
  drafts?: unknown;
  remember?: string[];
  /** 舊格式（只有一條）。 */
  draftText?: string | null;
  angleLabel?: string | null;
}

function readDrafts(parsed: RawResponse): DialogueDraft[] {
  const raw = Array.isArray(parsed.drafts)
    ? parsed.drafts
    : parsed.draftText
      ? [{ text: parsed.draftText, angleLabel: parsed.angleLabel }]
      : [];
  return raw.flatMap((d) => {
    const text = typeof d?.text === "string" ? toTraditional(d.text).trim() : "";
    if (!text) return [];
    const angleLabel = typeof d?.angleLabel === "string" ? toTraditional(d.angleLabel) : "";
    return [{ text, angleLabel }];
  });
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
  const systemPrompt = `你是履歷內容品質檢查助手。使用者直接打了一條經歷描述，照下面的規則逐條檢查。

${BULLET_RULES}

全部符合就是合格；只要有一條不符合就算 isVague。只輸出 JSON，不要其他文字：
{ "isVague": boolean, "suggestion": string | null }
suggestion 只在 isVague 為 true 時給，用繁體中文一句話講清楚問題在哪；使用者看不到規則清單，不要提「規則 1」這類編號、可以怎麼改（例如「這條把好幾個階段串在一起了，先只留最值得講的那個成果就好」），不要落落長。`;

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

  const parsed = JSON.parse(cleaned) as { isVague: boolean; suggestion: string | null };
  const suggestion = toTraditional(parsed.suggestion);
  return { ...parsed, suggestion: suggestion === null ? null : stripRuleRefs(suggestion) };
}
