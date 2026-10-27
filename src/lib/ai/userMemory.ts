import type { SupabaseClient } from "@supabase/supabase-js";

// 「AI 記住的事」：使用者在任何「跟 AI 聊」裡說「記住…」「以後都…」，或在帳號設定直接新增的事。
// 每個帳號一份，存在 profile_data.data.ai_memory；所有會寫內容的 AI 功能都會先讀（askClaude 自動帶進指令），
// 跟經歷資料庫衝突時以這裡為準（2026-10-27 Z 要求：說過已經從某間公司離職，求職信卻一直寫「目前在○○擔任」）。

export interface MemoryNote {
  id: string;
  text: string;
  createdAt: string;
}

/** profile_data.data 裡讀出記住的事，格式不對的略過。 */
export function readMemory(data: unknown): MemoryNote[] {
  const raw = (data as { ai_memory?: unknown } | null)?.ai_memory;
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (n): n is MemoryNote => !!n && typeof n.id === "string" && typeof n.text === "string" && !!n.text.trim(),
  );
}

export async function loadMemory(supabase: SupabaseClient, userId: string): Promise<MemoryNote[]> {
  const { data } = await supabase.from("profile_data").select("data").eq("user_id", userId).maybeSingle();
  return readMemory(data?.data);
}

const normalize = (text: string) => text.replace(/\s+/g, "").replace(/[。.！!]$/, "");

/** 加進記住的事（跟已經記住的重複就略過），回傳這次真的新加的句子。 */
export async function rememberNotes(supabase: SupabaseClient, userId: string, texts: string[]): Promise<string[]> {
  const cleaned = [...new Set(texts.map((t) => t.trim()).filter(Boolean))];
  if (cleaned.length === 0) return [];

  const { data: existing } = await supabase.from("profile_data").select("data").eq("user_id", userId).maybeSingle();
  const notes = readMemory(existing?.data);
  const known = new Set(notes.map((n) => normalize(n.text)));
  const added = cleaned.filter((t) => !known.has(normalize(t)));
  if (added.length === 0) return [];

  const now = new Date().toISOString();
  const next = [...notes, ...added.map((text) => ({ id: crypto.randomUUID(), text, createdAt: now }))];
  const { error } = await supabase
    .from("profile_data")
    .upsert({ user_id: userId, data: { ...(existing?.data ?? {}), ai_memory: next } });
  if (error) throw new Error(`記住失敗：${error.message}`);
  return added;
}

export async function forgetNote(supabase: SupabaseClient, userId: string, id: string): Promise<void> {
  const { data: existing } = await supabase.from("profile_data").select("data").eq("user_id", userId).maybeSingle();
  const next = readMemory(existing?.data).filter((n) => n.id !== id);
  const { error } = await supabase
    .from("profile_data")
    .upsert({ user_id: userId, data: { ...(existing?.data ?? {}), ai_memory: next } });
  if (error) throw new Error(error.message);
}

/** 放進 AI 指令的那一段。沒有記住任何事就回空字串。 */
export function memoryBlock(notes: MemoryNote[]): string {
  if (notes.length === 0) return "";
  return [
    "===== 使用者要求 AI 記住的事（這個帳號專屬，一律遵守；跟履歷、經歷資料庫或其他資料衝突時，以這裡為準）=====",
    ...notes.map((n) => `- ${n.text}`),
  ].join("\n");
}

/** 「跟 AI 聊」的指令裡加這段，AI 會把使用者交代要記住的事放進輸出的 remember 陣列。 */
export const REMEMBER_RULE = `記住使用者交代的事：使用者這次說的話裡，如果有要你「記住」的事，或之後每次都適用的事實、偏好（例如「我已經從 A 公司離職了」「不要再用『賦能』這個詞」），整理成一句獨立看得懂的句子放進 remember 陣列，用使用者的第一人稱寫，把要遵守的做法也寫進去（例如「我已經從 A 公司離職，履歷跟求職信都不能寫成目前在 A 公司任職」）。已經在「使用者要求 AI 記住的事」裡的不要重複放；只跟這次修改有關的要求（例如「這段改短一點」）不要放；沒有就給空陣列。有放東西進 remember 時，回覆裡要說一句「已記住：…」。`;
