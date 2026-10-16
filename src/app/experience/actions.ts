"use server";

import { activeStoredFlag, type StoredFlag } from "@/lib/experience/storedFlag";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { readLayoutSettings, type ResumeLayoutSettings } from "@/lib/resumes/typography";
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
  revalidatePath("/"); // 首次設定走「直接打字」時，首頁要知道使用者已經有經歷資料庫了
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
  /** 被潤飾的是哪一個寫法。replace 模式會直接蓋掉它。 */
  variantIndex: number;
  draftText: string;
  angleLabel: string;
  /** replace：取代原本那條（預設，潤飾就是要改掉原本的寫法）；append：另存成同一件事的新寫法。 */
  mode?: "replace" | "append";
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

  // 潤飾完的寫法照規則寫過，算已經通過檢查（reviewedText 等於目前文字），下次檢查不會再標它。
  const refined = { text: params.draftText, angleLabel: params.angleLabel, source: "AI 潤飾", reviewedText: params.draftText };
  let newVariantIndex: number;
  if (params.mode !== "append" && target.variants[params.variantIndex]) {
    // 取代原本那條：原本的流水帳不留在資料庫，不然下次檢查又會被標出同樣的問題。
    target.variants[params.variantIndex] = { ...target.variants[params.variantIndex], ...refined };
    newVariantIndex = params.variantIndex;
  } else {
    target.variants.push(refined);
    newVariantIndex = target.variants.length - 1;
  }

  // 同一個 achievement 底下的其他寫法，缺同一個新事實的話自動補上
  const siblings = target.variants
    .map((v: { text: string; angleLabel: string }, i: number) => ({ index: i, text: v.text, angleLabel: v.angleLabel }))
    .filter((_: unknown, i: number) => i !== newVariantIndex);
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
  /** 被檢查的那條原文。套用改寫前用來確認內容沒被改過。 */
  text: string;
  suggestion: string;
  /** AI 直接給的改寫版本（按 ✓ 就套用）。沒辦法只靠現有內容改好（例如缺數字）時可能是 null。 */
  rewrite: string | null;
}

export interface ReviewedVariant {
  entryId: string;
  achievementId: string;
  variantIndex: number;
  text: string;
}

type StoredVariant = { text: string; angleLabel?: string; source?: string; reviewedText?: string; flag?: StoredFlag };

/** 已經通過檢查、之後沒再改過的寫法：reviewedText 跟目前文字一樣。這種不用再檢查一次。 */
function isReviewed(v: StoredVariant) {
  return typeof v.reviewedText === "string" && v.reviewedText === v.text;
}

/** 「檢查整份經歷資料庫」：一次檢查一批（offset 起算 limit 條），前端一批一批呼叫，才能顯示真實的 0–100% 進度。
 * 只檢查「還沒通過、或通過後又改過」的寫法；total 是這次要檢查的條數，reviewedCount 是跳過的條數。
 * 通過的條目放在 passed 回傳，全部檢查完前端再一次標記（檢查途中不能改資料，不然分批的編號會跑掉）。
 * 不會自動打開對話，只負責標記，要不要改由使用者自己決定。 */
export async function scanExperienceDbAction(
  offset = 0,
  limit = 20,
): Promise<{ error?: string; flags?: ScanFlag[]; passed?: ReviewedVariant[]; total?: number; reviewedCount?: number }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "請先登入" };

  const { data: entries, error } = await supabase
    .from("experience_entries")
    .select("id, achievements")
    .eq("user_id", user.id)
    // 分批檢查時每一批都要重新撈，順序必須固定，編號才對得上。
    .order("id");
  if (error) return { error: error.message };
  if (!entries || entries.length === 0) return { flags: [], passed: [], total: 0, reviewedCount: 0 };

  const all = entries.flatMap((entry) =>
    (entry.achievements ?? []).flatMap((ach: { id: string; variants: StoredVariant[] }) =>
      ach.variants.map((v, variantIndex: number) => ({
        entryId: entry.id,
        achievementId: ach.id,
        variantIndex,
        text: v.text,
        reviewed: isReviewed(v),
        stored: activeStoredFlag(v),
      })),
    ),
  );
  // 上次檢查過、文字沒改的建議直接沿用（只在第一批回傳一次），不再送給 AI。
  const storedFlags: ScanFlag[] =
    offset === 0
      ? all
          .filter((f) => !f.reviewed && f.stored)
          .map((f) => ({
            entryId: f.entryId,
            achievementId: f.achievementId,
            variantIndex: f.variantIndex,
            text: f.text,
            suggestion: f.stored!.suggestion,
            rewrite: f.stored!.rewrite,
          }))
      : [];
  const flat = all.filter((f) => !f.reviewed && !f.stored);

  const total = flat.length;
  const reviewedCount = all.length - flat.length;
  const batch = flat.slice(offset, offset + limit);
  if (batch.length === 0) return { flags: storedFlags, passed: [], total, reviewedCount };

  const { askClaude } = await import("@/lib/ai/askClaude");
  const { BULLET_RULES } = await import("@/lib/experience/bulletRules");
  const { toTraditional } = await import("@/lib/text/toTraditional");
  const systemPrompt = `你是履歷內容品質檢查助手。使用者會給你經歷資料庫裡一批 bullet 的清單（每條有編號），照下面的規則逐條檢查。這是經歷資料庫，還沒有目標 JD。

${BULLET_RULES}

另外也要抓錯字：不管中文英文，明顯的錯字、漏字、重複字都要標記，suggestion 直接指出錯在哪個字、應該是什麼。

每條都用同一套標準，不要因為前後文放寬或收緊。全部符合就是通過，不用列出來；有任何一條不符合就要列出：
- suggestion：用繁體中文一兩句話講清楚問題在哪（同一條有好幾個問題都要提到）。
- rewrite：直接給一個照規則改好的版本，語言跟原文相同，中文一律繁體。只能用原文裡已經有的事實跟數字，不要編造；如果問題是缺數字、光靠原文改不好，rewrite 還是先把結構改對，並在 suggestion 提醒「補上數字會更好，可以點『跟 AI 聊』補」。只有錯字的話，rewrite 就是改好錯字的原文。

只輸出 JSON，不要其他文字：
{ "flags": [{ "index": number, "suggestion": string, "rewrite": string | null }] }`;

  const userPrompt = batch.map((f, i) => `[${i}] ${f.text}`).join("\n");

  const response = await askClaude({
    userId: user.id,
    feature: "experience_bulk_scan",
    systemPrompt,
    userPrompt,
    maxTokens: 12000,
    temperature: 0,
    supabase,
  });

  const cleaned = response.text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "");

  let parsed: { flags: { index: number; suggestion: string; rewrite?: string | null }[] };
  try {
    parsed = JSON.parse(cleaned) as typeof parsed;
  } catch {
    return { error: "AI 回傳的檢查結果不完整（可能是內容太多被截斷），請再檢查一次看看" };
  }

  const flaggedIndexes = new Set<number>();
  const flags: ScanFlag[] = [];
  for (const f of parsed.flags ?? []) {
    const item = batch[f.index];
    if (!item) continue;
    flaggedIndexes.add(f.index);
    const rewrite = f.rewrite?.trim() ? toTraditional(f.rewrite.trim()) : null;
    flags.push({
      entryId: item.entryId,
      achievementId: item.achievementId,
      variantIndex: item.variantIndex,
      text: item.text,
      suggestion: toTraditional(f.suggestion),
      rewrite: rewrite && rewrite !== item.text ? rewrite : null,
    });
  }
  const passed: ReviewedVariant[] = batch
    .filter((_, i) => !flaggedIndexes.has(i))
    .map(({ entryId, achievementId, variantIndex, text }) => ({ entryId, achievementId, variantIndex, text }));

  // 建議存回那一條（只加欄位，不動文字跟順序，後面幾批的編號不受影響）。
  await saveFlags(supabase, user.id, flags);

  return { flags: [...storedFlags, ...flags], passed, total, reviewedCount };
}

async function saveFlags(supabase: Awaited<ReturnType<typeof createClient>>, userId: string, flags: ScanFlag[]) {
  const byEntry = new Map<string, ScanFlag[]>();
  for (const f of flags) byEntry.set(f.entryId, [...(byEntry.get(f.entryId) ?? []), f]);
  for (const [entryId, list] of byEntry) {
    const { data: row } = await supabase
      .from("experience_entries")
      .select("achievements")
      .eq("id", entryId)
      .eq("user_id", userId)
      .maybeSingle();
    if (!row) continue;
    const achievements = Array.isArray(row.achievements) ? row.achievements : [];
    let changed = false;
    for (const f of list) {
      const ach = achievements.find((a: { id: string }) => a.id === f.achievementId);
      const v: StoredVariant | undefined = ach?.variants?.[f.variantIndex];
      if (v && v.text === f.text) {
        v.flag = { text: f.text, suggestion: f.suggestion, rewrite: f.rewrite };
        changed = true;
      }
    }
    if (changed) {
      await supabase.from("experience_entries").update({ achievements }).eq("id", entryId).eq("user_id", userId);
    }
  }
}

/** 把這幾條標成「已經檢查過」（通過、或使用者按 ✕ 決定不改）。只在文字還跟當時一樣時才標，
 * 之後內容一改，reviewedText 就對不上，下次檢查會重新檢查。 */
export async function markVariantsReviewedAction(items: ReviewedVariant[]): Promise<{ error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "請先登入" };
  if (items.length === 0) return {};

  const byEntry = new Map<string, ReviewedVariant[]>();
  for (const item of items) byEntry.set(item.entryId, [...(byEntry.get(item.entryId) ?? []), item]);

  for (const [entryId, list] of byEntry) {
    const { data: row } = await supabase
      .from("experience_entries")
      .select("achievements")
      .eq("id", entryId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (!row) continue;
    const achievements = Array.isArray(row.achievements) ? row.achievements : [];
    let changed = false;
    for (const item of list) {
      const ach = achievements.find((a: { id: string }) => a.id === item.achievementId);
      const v: StoredVariant | undefined = ach?.variants?.[item.variantIndex];
      if (v && v.text === item.text && v.reviewedText !== v.text) {
        v.reviewedText = v.text;
        changed = true;
      }
    }
    if (!changed) continue;
    await supabase
      .from("experience_entries")
      .update({ achievements })
      .eq("id", entryId)
      .eq("user_id", user.id);
  }
  // 只改了「檢查過」的記號，畫面上看不到差別，不用 revalidate。
  return {};
}

/** 註解卡片按 ✓：用 AI 檢查時給的改寫版本取代原本那條，並同步到另一個語言。 */
export async function applyFlagRewriteAction(params: {
  entryId: string;
  achievementId: string;
  variantIndex: number;
  originalText: string;
  newText: string;
}): Promise<{ error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "請先登入" };

  const { data: row } = await supabase
    .from("experience_entries")
    .select("org_name, location, language, entry_type, role_variants, period_variants, achievements")
    .eq("id", params.entryId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!row) return { error: "找不到這個經歷區塊" };

  const achievements = Array.isArray(row.achievements) ? row.achievements : [];
  const ach = achievements.find((a: { id: string }) => a.id === params.achievementId);
  const v: StoredVariant | undefined = ach?.variants?.[params.variantIndex];
  if (!v) return { error: "找不到這一條" };
  if (v.text !== params.originalText) return { error: "這條在檢查之後被改過了，請重新檢查一次" };

  v.text = params.newText;
  v.reviewedText = params.newText;

  const { error } = await supabase
    .from("experience_entries")
    .update({ achievements, updated_at: new Date().toISOString() })
    .eq("id", params.entryId)
    .eq("user_id", user.id);
  if (error) return { error: error.message };

  const { syncToOtherLanguage } = await import("@/lib/experience/syncLanguage");
  await syncToOtherLanguage({
    supabase,
    userId: user.id,
    sourceLanguage: row.language,
    orgName: row.org_name,
    role: row.role_variants?.[0]?.role ?? "",
    location: row.location ?? null,
    period: row.period_variants?.[0]?.period ?? "",
    entryType: row.entry_type,
    text: params.newText,
    sourceLabel: "檢查建議（雙語同步）",
  });

  revalidatePath("/experience");
  return {};
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

/**
 * 存經歷資料庫的字級／上下間距（每個語言各一份），也當之後新生成履歷的預設排版。
 * 只動 profile_data.data.resume_layout，其他資料原樣保留。
 */
export async function saveDefaultLayoutAction(
  language: string,
  layout: ResumeLayoutSettings,
): Promise<{ error?: string; success?: boolean }> {
  if (language !== "zh" && language !== "en") return { error: "不支援的語言" };
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "請先登入" };

  const { data: existing } = await supabase.from("profile_data").select("data").eq("user_id", user.id).maybeSingle();
  const data = existing?.data ?? {};
  const { error } = await supabase.from("profile_data").upsert({
    user_id: user.id,
    data: { ...data, resume_layout: { ...(data.resume_layout ?? {}), [language]: readLayoutSettings(layout, language) } },
  });
  if (error) return { error: error.message };
  return { success: true };
}
