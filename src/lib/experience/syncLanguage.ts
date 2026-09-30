import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { askClaude } from "@/lib/ai/askClaude";

// 使用者要求：中文版跟英文版的經歷資料庫內容意思要對得上，不能各自為政——
// 潤飾/新增某個語言的一段經歷後，自動把「另一個語言」對應的同一段經歷也更新，
// 不是逐字翻譯，是用那個語言自然的寫法表達同一件事。

const SYSTEM_PROMPT = `你是履歷雙語同步助手。使用者剛在「某一個語言」的經歷資料庫裡新增或修改了一條 bullet，你的工作是判斷「另一個語言」的資料庫裡有沒有對應的公司/職位，並且產生一條意思對得上、但用那個語言自然寫法表達的對應版本。

規則：
1. 不是逐字翻譯，是用目標語言的人資/履歷寫作習慣重新表達同一件事，維持動詞開頭＋具體任務＋量化成果的寫法。
2. 判斷「對應的公司/職位」看語意，不要只比對字串——同一家公司在中英文可能寫法不同（例如「台積電」對應「TSMC」）。
3. 如果目標語言裡已經有這家公司/職位的 entry，判斷這條內容屬於既有哪個 achievement（同一件事的不同語言版本），沒有對應的 achievement 就當成新的。如果目標語言裡完全沒有這家公司/職位的 entry，就當成全新的一個 entry。
4. 職稱、地點、期間也都要翻譯/轉換成目標語言常見的寫法。
5. 不要編造新內容，只轉換這一條 bullet 實際講的事情。
6. 只輸出 JSON，不要其他文字：
{
  "matchedEntryId": string | null,
  "matchedAchievementId": string | null,
  "isNewEntry": boolean,
  "orgName": string,
  "location": string | null,
  "role": string,
  "period": string,
  "entryType": "work" | "leadership",
  "text": string,
  "angleLabel": string
}
matchedEntryId 找到對應 entry 才填，isNewEntry 為 true 時 matchedEntryId/matchedAchievementId 都是 null。`;

export interface SyncResult {
  entryId: string;
  achievementId: string;
  isNewEntry: boolean;
}

export async function syncToOtherLanguage(params: {
  supabase: SupabaseClient;
  userId: string;
  sourceLanguage: "zh" | "en";
  orgName: string;
  role: string;
  location: string | null;
  period: string;
  entryType: "work" | "leadership";
  text: string;
  sourceLabel: string;
}): Promise<SyncResult | null> {
  const { supabase, userId, sourceLanguage, orgName, role, location, period, entryType, text, sourceLabel } = params;
  const targetLanguage = sourceLanguage === "zh" ? "en" : "zh";

  const { data: targetEntries } = await supabase
    .from("experience_entries")
    .select("id, org_name, location, role_variants, period_variants, achievements")
    .eq("user_id", userId)
    .eq("language", targetLanguage);

  const targetSummary = (targetEntries ?? []).map((e) => ({
    entryId: e.id,
    orgName: e.org_name,
    role: e.role_variants?.[0]?.role ?? "",
    achievements: (e.achievements ?? []).map((a: { id: string; variants: { text: string }[] }) => ({
      achievementId: a.id,
      sampleText: a.variants[0]?.text ?? "",
    })),
  }));

  const userPrompt = `===== 來源語言：${sourceLanguage}，公司/職位：${orgName} / ${role}，地點：${location ?? "不明"}，期間：${period || "不明"} =====
這條內容：
${text}

===== 目標語言（${targetLanguage}）現有的經歷資料庫摘要 =====
${JSON.stringify(targetSummary, null, 2)}

如果是全新的 entry（isNewEntry: true），period 請直接沿用來源的期間「${period || ""}」，只需要視情況把地點名稱轉成目標語言常見寫法，不用自己編造或留白。`;

  const response = await askClaude({
    userId,
    feature: "experience_language_sync",
    systemPrompt: SYSTEM_PROMPT,
    userPrompt,
    maxTokens: 2000,
    supabase,
  });

  const cleaned = response.text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "");

  let parsed: {
    matchedEntryId: string | null;
    matchedAchievementId: string | null;
    isNewEntry: boolean;
    orgName: string;
    location: string | null;
    role: string;
    period: string;
    entryType: "work" | "leadership";
    text: string;
    angleLabel: string;
  };
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return null; // 同步失敗不應該讓主要的動作跟著失敗，安靜跳過即可
  }

  const newAchievement = {
    id: `ach_${Math.random().toString(36).slice(2, 10)}`,
    variants: [{ text: parsed.text, angleLabel: parsed.angleLabel, source: sourceLabel }],
  };

  if (!parsed.isNewEntry && parsed.matchedEntryId) {
    const { data: row } = await supabase
      .from("experience_entries")
      .select("achievements")
      .eq("id", parsed.matchedEntryId)
      .eq("user_id", userId)
      .maybeSingle();
    if (!row) return null;

    const achievements = Array.isArray(row.achievements) ? row.achievements : [];

    if (parsed.matchedAchievementId) {
      const target = achievements.find((a: { id: string }) => a.id === parsed.matchedAchievementId);
      if (target) {
        target.variants.push({ text: parsed.text, angleLabel: parsed.angleLabel, source: sourceLabel });
        await supabase
          .from("experience_entries")
          .update({ achievements, updated_at: new Date().toISOString() })
          .eq("id", parsed.matchedEntryId)
          .eq("user_id", userId);
        return { entryId: parsed.matchedEntryId, achievementId: parsed.matchedAchievementId, isNewEntry: false };
      }
    }

    achievements.push(newAchievement);
    await supabase
      .from("experience_entries")
      .update({ achievements, updated_at: new Date().toISOString() })
      .eq("id", parsed.matchedEntryId)
      .eq("user_id", userId);
    return { entryId: parsed.matchedEntryId, achievementId: newAchievement.id, isNewEntry: false };
  }

  const { data: created, error } = await supabase
    .from("experience_entries")
    .insert({
      user_id: userId,
      language: targetLanguage,
      entry_type: parsed.entryType || entryType,
      org_name: parsed.orgName || orgName,
      location: parsed.location ?? location,
      role_variants: [{ role: parsed.role || role, source: [sourceLabel] }],
      period_variants: [{ period: parsed.period || period, source: [sourceLabel] }],
      achievements: [newAchievement],
    })
    .select("id")
    .single();
  if (error || !created) return null;

  return { entryId: created.id, achievementId: newAchievement.id, isNewEntry: true };
}

const DELETE_SYNC_SYSTEM_PROMPT = `你是履歷雙語同步助手。使用者剛在「某一個語言」的經歷資料庫裡刪除了一條 bullet，你的工作是判斷「另一個語言」的資料庫裡，同一家公司/職位底下，有沒有講同一件事的對應寫法——如果有，回傳它的位置，好讓呼叫端把它也一併刪掉，維持兩個語言的內容同步。

規則：
1. 判斷「同一家公司/職位」看語意，不要只比對字串（例如「台積電」對應「TSMC」）。
2. 只有在「明顯講的是同一件事」時才回傳配對，語意不夠像就回傳 null，寧可漏刪也不要刪錯。
3. 只輸出 JSON，不要其他文字：
{ "matchedEntryId": string | null, "matchedAchievementId": string | null, "matchedVariantIndex": number | null }`;

/** 刪除的雙語同步：找出另一個語言裡「講同一件事」的寫法，回傳位置讓呼叫端刪掉。
 * 找不到明確對應就回傳 null，安全起見不亂猜。 */
export async function findMatchingVariantInOtherLanguage(params: {
  supabase: SupabaseClient;
  userId: string;
  sourceLanguage: "zh" | "en";
  orgName: string;
  role: string;
  deletedText: string;
}): Promise<{ entryId: string; achievementId: string; variantIndex: number } | null> {
  const { supabase, userId, sourceLanguage, orgName, role, deletedText } = params;
  const targetLanguage = sourceLanguage === "zh" ? "en" : "zh";

  const { data: targetEntries } = await supabase
    .from("experience_entries")
    .select("id, org_name, role_variants, achievements")
    .eq("user_id", userId)
    .eq("language", targetLanguage);
  if (!targetEntries || targetEntries.length === 0) return null;

  const targetSummary = targetEntries.map((e) => ({
    entryId: e.id,
    orgName: e.org_name,
    role: e.role_variants?.[0]?.role ?? "",
    achievements: (e.achievements ?? []).map((a: { id: string; variants: { text: string }[] }) => ({
      achievementId: a.id,
      variants: a.variants.map((v, i) => ({ index: i, text: v.text })),
    })),
  }));

  const userPrompt = `===== 剛被刪除的內容（來源語言：${sourceLanguage}，公司/職位：${orgName} / ${role}）=====
${deletedText}

===== 目標語言（${targetLanguage}）現有的經歷資料庫摘要 =====
${JSON.stringify(targetSummary, null, 2)}`;

  const response = await askClaude({
    userId,
    feature: "experience_language_delete_sync",
    systemPrompt: DELETE_SYNC_SYSTEM_PROMPT,
    userPrompt,
    maxTokens: 500,
    temperature: 0,
    supabase,
  });

  const cleaned = response.text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "");

  try {
    const parsed = JSON.parse(cleaned) as {
      matchedEntryId: string | null;
      matchedAchievementId: string | null;
      matchedVariantIndex: number | null;
    };
    if (parsed.matchedEntryId && parsed.matchedAchievementId && parsed.matchedVariantIndex !== null) {
      return {
        entryId: parsed.matchedEntryId,
        achievementId: parsed.matchedAchievementId,
        variantIndex: parsed.matchedVariantIndex,
      };
    }
    return null;
  } catch {
    return null; // 同步失敗不應該讓刪除動作本身失敗，安靜跳過即可
  }
}
