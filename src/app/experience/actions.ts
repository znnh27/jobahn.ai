"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { extractResumeText } from "@/lib/resumes/extractText";
import { mergeContentIntoExperienceDb } from "@/lib/experience/mergeIntoExperienceDb";
import {
  stepElicitation,
  quickQualityCheck,
  type DialogueContext,
  type DialogueTurn,
} from "@/lib/experience/elicitationDialogue";

const ALLOWED_TYPES = new Set([
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document", // .docx
  "application/msword", // .doc
  "application/pdf",
]);

const MAX_FILE_SIZE_BYTES = 3 * 1024 * 1024; // 3MB

type UploadResult = {
  error?: string;
  success?: boolean;
  newEntriesCreated?: number;
  newAchievementsCreated?: number;
  variantsAppended?: number;
  conflicts?: string[];
};

// 這裡上傳的檔案不會存進 Supabase Storage：解析完就丟棄，只留合併後的經歷資料庫內容。
export async function uploadAndMergeResumeAction(formData: FormData): Promise<UploadResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "請先登入" };

  const file = formData.get("file");
  if (!(file instanceof File)) return { error: "沒有收到檔案" };

  if (!ALLOWED_TYPES.has(file.type)) {
    return { error: `「${file.name}」不是支援的檔案類型，只接受 docx/doc/pdf` };
  }
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return { error: `「${file.name}」超過 3MB 上限` };
  }

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const text = await extractResumeText(buffer, file.name);

    const result = await mergeContentIntoExperienceDb({
      supabase,
      userId: user.id,
      sourceLabel: file.name,
      rawContent: text,
    });

    revalidatePath("/experience");
    revalidatePath("/"); // 首頁要知道使用者是不是已經有經歷資料庫了
    return { success: true, ...result };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "解析失敗" };
  }
}

export async function updateEntryFieldAction(
  entryId: string,
  field: "org_name" | "location",
  value: string,
): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  await supabase
    .from("experience_entries")
    .update({ [field]: value || null, updated_at: new Date().toISOString() })
    .eq("id", entryId)
    .eq("user_id", user.id);

  revalidatePath("/experience");
}

export async function updatePeriodAction(entryId: string, value: string): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  const { data: row } = await supabase
    .from("experience_entries")
    .select("period_variants")
    .eq("id", entryId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!row) return;

  const periodVariants = Array.isArray(row.period_variants) ? row.period_variants : [];
  if (periodVariants.length === 0) periodVariants.push({ period: value, source: [] });
  else periodVariants[0].period = value;

  await supabase
    .from("experience_entries")
    .update({ period_variants: periodVariants, updated_at: new Date().toISOString() })
    .eq("id", entryId)
    .eq("user_id", user.id);

  revalidatePath("/experience");
}

export async function updateRoleVariantAction(
  entryId: string,
  roleIndex: number,
  value: string,
): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  const { data: row } = await supabase
    .from("experience_entries")
    .select("role_variants")
    .eq("id", entryId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!row) return;

  const roleVariants = Array.isArray(row.role_variants) ? row.role_variants : [];
  if (!roleVariants[roleIndex]) return;
  roleVariants[roleIndex].role = value;

  await supabase
    .from("experience_entries")
    .update({ role_variants: roleVariants, updated_at: new Date().toISOString() })
    .eq("id", entryId)
    .eq("user_id", user.id);

  revalidatePath("/experience");
}

export async function removeRoleVariantAction(entryId: string, roleIndex: number): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  const { data: row } = await supabase
    .from("experience_entries")
    .select("role_variants")
    .eq("id", entryId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!row) return;

  const roleVariants = Array.isArray(row.role_variants) ? row.role_variants : [];
  if (roleVariants.length <= 1) return; // 至少留一個職稱寫法

  roleVariants.splice(roleIndex, 1);

  await supabase
    .from("experience_entries")
    .update({ role_variants: roleVariants, updated_at: new Date().toISOString() })
    .eq("id", entryId)
    .eq("user_id", user.id);

  revalidatePath("/experience");
}

export async function updateAchievementVariantAction(
  entryId: string,
  achievementId: string,
  variantIndex: number,
  value: string,
): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  const { data: row } = await supabase
    .from("experience_entries")
    .select("achievements")
    .eq("id", entryId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!row) return;

  const achievements = Array.isArray(row.achievements) ? row.achievements : [];
  const target = achievements.find((a: { id: string }) => a.id === achievementId);
  if (!target || !target.variants[variantIndex]) return;
  target.variants[variantIndex].text = value;

  await supabase
    .from("experience_entries")
    .update({ achievements, updated_at: new Date().toISOString() })
    .eq("id", entryId)
    .eq("user_id", user.id);

  revalidatePath("/experience");
}

export async function removeAchievementVariantAction(
  entryId: string,
  achievementId: string,
  variantIndex: number,
): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  const { data: row } = await supabase
    .from("experience_entries")
    .select("org_name, language, role_variants, achievements")
    .eq("id", entryId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!row) return;

  const achievements = Array.isArray(row.achievements) ? row.achievements : [];
  const target = achievements.find((a: { id: string }) => a.id === achievementId);
  if (!target) return;

  const deletedText = target.variants[variantIndex]?.text ?? "";
  target.variants.splice(variantIndex, 1);
  const remaining =
    target.variants.length === 0
      ? achievements.filter((a: { id: string }) => a.id !== achievementId)
      : achievements;

  await supabase
    .from("experience_entries")
    .update({ achievements: remaining, updated_at: new Date().toISOString() })
    .eq("id", entryId)
    .eq("user_id", user.id);

  // 使用者要求：任何時刻兩個語言的內容都要同步，刪除也不例外。找不到明確對應的
  // 另一語言寫法就安靜跳過，不影響這次刪除本身有沒有成功。
  if (deletedText) {
    const { findMatchingVariantInOtherLanguage } = await import("@/lib/experience/syncLanguage");
    const match = await findMatchingVariantInOtherLanguage({
      supabase,
      userId: user.id,
      sourceLanguage: row.language,
      orgName: row.org_name,
      role: row.role_variants?.[0]?.role ?? "",
      deletedText,
    });
    if (match) {
      const { data: targetRow } = await supabase
        .from("experience_entries")
        .select("achievements")
        .eq("id", match.entryId)
        .eq("user_id", user.id)
        .maybeSingle();
      if (targetRow) {
        const targetAchievements = Array.isArray(targetRow.achievements) ? targetRow.achievements : [];
        const targetAch = targetAchievements.find((a: { id: string }) => a.id === match.achievementId);
        if (targetAch && targetAch.variants[match.variantIndex]) {
          targetAch.variants.splice(match.variantIndex, 1);
          const targetRemaining =
            targetAch.variants.length === 0
              ? targetAchievements.filter((a: { id: string }) => a.id !== match.achievementId)
              : targetAchievements;
          await supabase
            .from("experience_entries")
            .update({ achievements: targetRemaining, updated_at: new Date().toISOString() })
            .eq("id", match.entryId)
            .eq("user_id", user.id);
        }
      }
    }
  }

  revalidatePath("/experience");
}

export async function stepElicitationAction(
  context: DialogueContext,
  turns: DialogueTurn[],
  userReply: string | null,
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("請先登入");

  return stepElicitation({ supabase, userId: user.id, context, turns, userReply });
}

export async function quickQualityCheckAction(orgName: string, role: string, text: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("請先登入");

  return quickQualityCheck({ supabase, userId: user.id, orgName, role, text });
}

/** 手動新增一段經歷，確定要收進資料庫：可能新增到既有 entry，也可能連 entry 都是新的。
 * 使用者已經明確表示這是新內容，所以一律當成新的 achievement，不用再讓 AI 猜要不要合併。 */
export async function commitNewAchievementAction(params: {
  entryId: string | null;
  newEntry?: {
    orgName: string;
    location: string | null;
    role: string;
    period: string;
    entryType: "work" | "leadership";
    language: "zh" | "en";
  };
  draftText: string;
  angleLabel: string;
  sourceLabel?: string;
}): Promise<CommitResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "請先登入" };

  const achievement = {
    id: `ach_${Math.random().toString(36).slice(2, 10)}`,
    variants: [
      { text: params.draftText, angleLabel: params.angleLabel, source: params.sourceLabel ?? "手動新增" },
    ],
  };

  let resultEntryId: string;
  let sourceLanguage: "zh" | "en";
  let sourceOrgName: string;
  let sourceRole: string;
  let sourceLocation: string | null;
  let sourcePeriod: string;
  let sourceEntryType: "work" | "leadership";

  if (params.entryId) {
    const { data: row, error: readError } = await supabase
      .from("experience_entries")
      .select("org_name, location, language, entry_type, role_variants, period_variants, achievements")
      .eq("id", params.entryId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (readError || !row) return { error: "找不到這個經歷區塊" };

    const achievements = Array.isArray(row.achievements) ? row.achievements : [];
    achievements.push(achievement);

    const { error } = await supabase
      .from("experience_entries")
      .update({ achievements, updated_at: new Date().toISOString() })
      .eq("id", params.entryId)
      .eq("user_id", user.id);
    if (error) return { error: error.message };

    resultEntryId = params.entryId;
    sourceLanguage = row.language;
    sourceOrgName = row.org_name;
    sourceRole = row.role_variants?.[0]?.role ?? "";
    sourceLocation = row.location ?? null;
    sourcePeriod = row.period_variants?.[0]?.period ?? "";
    sourceEntryType = row.entry_type;
  } else if (params.newEntry) {
    const { data: created, error } = await supabase
      .from("experience_entries")
      .insert({
        user_id: user.id,
        language: params.newEntry.language,
        entry_type: params.newEntry.entryType,
        org_name: params.newEntry.orgName,
        location: params.newEntry.location,
        role_variants: [{ role: params.newEntry.role, source: ["手動新增"] }],
        period_variants: [{ period: params.newEntry.period, source: ["手動新增"] }],
        achievements: [achievement],
      })
      .select("id")
      .single();
    if (error || !created) return { error: error?.message ?? "新增失敗" };

    resultEntryId = created.id;
    sourceLanguage = params.newEntry.language;
    sourceOrgName = params.newEntry.orgName;
    sourceRole = params.newEntry.role;
    sourceLocation = params.newEntry.location;
    sourcePeriod = params.newEntry.period;
    sourceEntryType = params.newEntry.entryType;
  } else {
    return { error: "缺少要新增到哪個經歷區塊的資訊" };
  }

  const { syncToOtherLanguage } = await import("@/lib/experience/syncLanguage");
  const synced = await syncToOtherLanguage({
    supabase,
    userId: user.id,
    sourceLanguage,
    orgName: sourceOrgName,
    role: sourceRole,
    location: sourceLocation,
    period: sourcePeriod,
    entryType: sourceEntryType,
    text: params.draftText,
    sourceLabel: `${params.sourceLabel ?? "手動新增"}（雙語同步）`,
  });

  revalidatePath("/experience");
  return {
    success: true,
    entryId: resultEntryId,
    achievementId: achievement.id,
    variantIndex: 0,
    syncedToOtherLanguage: synced !== null,
  };
}

export interface CommitResult {
  error?: string;
  success?: boolean;
  entryId?: string;
  achievementId?: string;
  variantIndex?: number;
  syncedToOtherLanguage?: boolean;
}

/** AI 潤飾既有 bullet 完成後，把新寫法加進同一個 achievement，不覆蓋原本的寫法。
 * 同時做兩件連動的事：(1) 同一個 achievement 底下如果還有其他寫法一樣缺這次補上的
 * 具體事實，自動幫忙補上；(2) 把這個新事實同步到另一個語言對應的經歷裡。 */
export async function commitRefinedVariantAction(params: {
  entryId: string;
  achievementId: string;
  draftText: string;
  angleLabel: string;
}): Promise<CommitResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "請先登入" };

  const { data: row, error: readError } = await supabase
    .from("experience_entries")
    .select("org_name, location, language, entry_type, role_variants, period_variants, achievements")
    .eq("id", params.entryId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (readError || !row) return { error: "找不到這個經歷區塊" };

  const achievements = Array.isArray(row.achievements) ? row.achievements : [];
  const target = achievements.find((a: { id: string }) => a.id === params.achievementId);
  if (!target) return { error: "找不到這個成就" };

  target.variants.push({ text: params.draftText, angleLabel: params.angleLabel, source: "AI 潤飾" });
  const newVariantIndex = target.variants.length - 1;

  // 同一個 achievement 底下的其他寫法，缺同一個新事實的話自動補上
  const siblings = target.variants
    .map((v: { text: string; angleLabel: string }, i: number) => ({ index: i, text: v.text, angleLabel: v.angleLabel }))
    .filter((_: unknown, i: number) => i !== target.variants.length - 1);
  if (siblings.length > 0) {
    const { syncSiblingVariants } = await import("@/lib/experience/syncSiblingVariants");
    const updates = await syncSiblingVariants({
      supabase,
      userId: user.id,
      refinedText: params.draftText,
      siblings,
    });
    for (const u of updates) {
      if (target.variants[u.index]) target.variants[u.index].text = u.text;
    }
  }

  const { error } = await supabase
    .from("experience_entries")
    .update({ achievements, updated_at: new Date().toISOString() })
    .eq("id", params.entryId)
    .eq("user_id", user.id);
  if (error) return { error: error.message };

  const role = row.role_variants?.[0]?.role ?? "";
  const { syncToOtherLanguage } = await import("@/lib/experience/syncLanguage");
  const synced = await syncToOtherLanguage({
    supabase,
    userId: user.id,
    sourceLanguage: row.language,
    orgName: row.org_name,
    role,
    location: row.location ?? null,
    period: row.period_variants?.[0]?.period ?? "",
    entryType: row.entry_type,
    text: params.draftText,
    sourceLabel: "AI 潤飾（雙語同步）",
  });

  revalidatePath("/experience");
  return {
    success: true,
    entryId: params.entryId,
    achievementId: params.achievementId,
    variantIndex: newVariantIndex,
    syncedToOtherLanguage: synced !== null,
  };
}

export interface ScanFlag {
  entryId: string;
  achievementId: string;
  variantIndex: number;
  suggestion: string;
}

/** 「檢查整份經歷資料庫」：一次 AI 呼叫掃過所有 bullet，標記寫得太籠統/沒量化的，
 * 不會自動打開對話，只負責標記，深挖與否由使用者自己決定。 */
export async function scanExperienceDbAction(): Promise<{ error?: string; flags?: ScanFlag[] }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "請先登入" };

  const { data: entries, error } = await supabase
    .from("experience_entries")
    .select("id, achievements")
    .eq("user_id", user.id);
  if (error) return { error: error.message };
  if (!entries || entries.length === 0) return { flags: [] };

  const flat = entries.flatMap((entry) =>
    (entry.achievements ?? []).flatMap(
      (ach: { id: string; variants: { text: string }[] }) =>
        ach.variants.map((v, variantIndex: number) => ({
          entryId: entry.id,
          achievementId: ach.id,
          variantIndex,
          text: v.text,
        })),
    ),
  );

  if (flat.length === 0) return { flags: [] };

  const { askClaude } = await import("@/lib/ai/askClaude");
  const systemPrompt = `你是履歷內容品質檢查助手，用 Google 履歷寫作團隊提倡的 XYZ 公式（達成了什麼成果 X／用什麼數字衡量 Y／透過什麼方法 Z）當標準。使用者會給你一份經歷資料庫裡所有 bullet 的清單（每條有編號），逐條檢查三件事：
1. 錯字/打字錯誤：不管是中文還是英文，只要有明顯的錯字、漏字、重複字，都要標記出來，suggestion 直接指出錯在哪個字、應該是什麼。
2. 內容太籠統、沒有量化、動詞太空泛：缺乏具體數字/規模/結果的才標記，寫得已經不錯的不用列出來。
3. 流水帳：超過兩句話、或按時間順序把好幾個階段/好幾件事塞進同一條（例如「做了什麼→花多久→怎麼協作→上線後→後續維護」全部寫進去）——就算有數字也算，因為重點被稀釋掉了，suggestion 要指出「先只留最值得講的那個成果」。

同一條如果不只一個問題，都要在 suggestion 裡提到。只回傳需要加強的那幾條的編號跟建議。逐條檢查時保持同一套標準，不要因為前後文而放寬或收緊。只輸出 JSON，不要其他文字：
{ "flags": [{ "index": number, "suggestion": string }] }`;

  const userPrompt = flat.map((f, i) => `[${i}] ${f.text}`).join("\n");

  const response = await askClaude({
    userId: user.id,
    feature: "experience_bulk_scan",
    systemPrompt,
    userPrompt,
    maxTokens: 8000,
    temperature: 0,
    supabase,
  });

  const cleaned = response.text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "");

  let parsed: { flags: { index: number; suggestion: string }[] };
  try {
    parsed = JSON.parse(cleaned) as { flags: { index: number; suggestion: string }[] };
  } catch {
    return { error: "AI 回傳的檢查結果不完整（可能是內容太多被截斷），請再檢查一次看看" };
  }

  const flags: ScanFlag[] = parsed.flags
    .filter((f) => flat[f.index])
    .map((f) => ({
      entryId: flat[f.index].entryId,
      achievementId: flat[f.index].achievementId,
      variantIndex: flat[f.index].variantIndex,
      suggestion: f.suggestion,
    }));

  return { flags };
}

/** JD 缺口挖掘用：從應徵履歷草稿裡的公司名稱，找出對應的經歷資料庫 entry id，
 * 好把新挖出來的內容寫回去。名稱容許些微改寫（生成履歷時 AI 有時會省略括號說明），
 * 所以先試完全一致，再退而求其次比對「核心名稱」是否互相包含。 */
export async function findEntryIdByOrgAction(
  orgName: string,
  language: string,
): Promise<string | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: candidates } = await supabase
    .from("experience_entries")
    .select("id, org_name")
    .eq("user_id", user.id)
    .eq("language", language);
  if (!candidates || candidates.length === 0) return null;

  const normalize = (s: string) => s.trim().toLowerCase();
  const coreName = (s: string) => normalize(s.split("(")[0].split("（")[0]).trim();

  const exact = candidates.find((c) => normalize(c.org_name) === normalize(orgName));
  if (exact) return exact.id;

  const targetCore = coreName(orgName);
  const fuzzy = candidates.find((c) => {
    const candidateCore = coreName(c.org_name);
    return (
      candidateCore.length > 0 &&
      (candidateCore.includes(targetCore) || targetCore.includes(candidateCore))
    );
  });
  return fuzzy?.id ?? null;
}
