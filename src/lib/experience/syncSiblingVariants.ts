import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { askClaude } from "@/lib/ai/askClaude";

// 使用者要求：同一個 achievement 底下有好幾種寫法（不同角度），如果它們共同缺的東西
// （例如都沒有量化數字）在潤飾其中一條時被問出來了，其他條也要跟著補上這個新事實，
// 各自保留原本的角度，不是全部變成同一句話。

interface SiblingVariant {
  index: number;
  text: string;
  angleLabel: string;
}

const SYSTEM_PROMPT = `你是履歷內容補強助手。使用者剛把同一個 achievement（同一件事）底下的其中一種寫法，透過問答補上了更具體的事實（例如量化數字）。你的工作是：如果同一個 achievement 底下還有其他寫法一樣缺少這個新補上的具體事實，就幫忙補進去，但要保留每一種寫法原本的角度/強調重點，不要把大家都改成一模一樣。

規則：
1. 只有「其他寫法真的也缺少這個新事實」才需要修改，如果某個寫法本來就已經有具體數字/事實，就不要動它。
2. 修改時只補進新學到的具體事實，不要整句重寫成跟主要那條一樣，保留原本的角度和用詞風格。
3. 不確定新事實是否適用於某條寫法（例如新事實明顯只屬於某個特定情境），就不要硬套進去。
4. 只輸出 JSON，不要其他文字：
{ "updates": [{ "index": number, "text": string }] }
沒有任何需要更新的就回傳 { "updates": [] }。`;

export async function syncSiblingVariants(params: {
  supabase: SupabaseClient;
  userId: string;
  refinedText: string;
  siblings: SiblingVariant[];
}): Promise<{ index: number; text: string }[]> {
  if (params.siblings.length === 0) return [];

  const userPrompt = `===== 剛補強完的寫法（已經有具體事實了）=====
${params.refinedText}

===== 同一個 achievement 底下的其他寫法 =====
${params.siblings.map((s) => `[${s.index}] (${s.angleLabel}) ${s.text}`).join("\n")}`;

  const response = await askClaude({
    userId: params.userId,
    feature: "experience_sibling_sync",
    systemPrompt: SYSTEM_PROMPT,
    userPrompt,
    maxTokens: 2000,
    supabase: params.supabase,
  });

  try {
    const cleaned = response.text
      .trim()
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/```\s*$/i, "");
    const parsed = JSON.parse(cleaned) as { updates: { index: number; text: string }[] };
    return parsed.updates ?? [];
  } catch {
    return []; // 補強失敗不影響主要動作，安靜跳過
  }
}
