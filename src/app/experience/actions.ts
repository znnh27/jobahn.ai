"use server";

import { activeStoredFlag, type StoredFlag } from "@/lib/experience/storedFlag";
import { readRuleTags, stripRuleRefs } from "@/lib/experience/bulletRules";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { readLayoutSettings, type ResumeLayoutSettings } from "@/lib/resumes/typography";
import { readBackground, splitList, type EducationItem } from "@/lib/resumes/background";
import { ensureBackgroundLanguage } from "@/lib/resumes/translateBackground";
import { saveBackgroundAnswers, type BackgroundAnswers } from "@/lib/resumes/backgroundInterview";
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
  backgroundItemsAdded?: number;
  /** 上傳後從另一個語言補上的經歷段數、成就件數（中英文資料庫要同步）。 */
  parityEntriesAdded?: number;
  parityAchievementsAdded?: number;
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
    // 上傳是兩個語言分開解析的，只出現在這份履歷語言裡的經歷，另一個語言要翻過去補上。
    const { ensureLanguageParity } = await import("@/lib/experience/languageParity");
    const parity = await ensureLanguageParity({
      supabase,
      userId: user.id,
      targets: ["zh", "en"],
      onlyIfBothLanguages: true,
    });

    revalidatePath("/experience");
    revalidatePath("/"); // 首頁要知道使用者是不是已經有經歷資料庫了
    return {
      success: true,
      ...result,
      parityEntriesAdded: parity.entriesAdded,
      parityAchievementsAdded: parity.achievementsAdded,
    };
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

/**
 * 經歷資料庫裡按 Enter：這一點（某個寫法）改成游標前的文字，游標後的文字變成新的一點，插在這一點正下方。
 * 改寫跟新增在同一次寫入完成，避免兩個動作同時讀寫同一筆資料、後寫的蓋掉先寫的。
 * before 是 null 代表這一點不用改（例如在空白的新一點裡按 Enter）。
 * 新的一點會同步到另一個語言（在背景跑，不擋畫面）。回傳新一點的 id，畫面才能接著在它下面再開一點。
 */
export async function insertAchievementAfterAction(params: {
  entryId: string;
  afterAchievementId: string;
  /** 要順便改寫的那一點（游標前的文字）；不用改就不傳。 */
  edit?: { achievementId: string; variantIndex: number; text: string };
  text: string;
}): Promise<{ error?: string; achievementId?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "請先登入" };
  const text = params.text.trim();
  if (!text) return { error: "內容是空的" };

  const { data: row } = await supabase
    .from("experience_entries")
    .select("language, entry_type, org_name, location, role_variants, period_variants, achievements")
    .eq("id", params.entryId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!row) return { error: "找不到這個經歷區塊" };

  const achievements = Array.isArray(row.achievements) ? row.achievements : [];
  if (params.edit) {
    const target = achievements.find((a: { id: string }) => a.id === params.edit!.achievementId);
    if (target?.variants?.[params.edit.variantIndex]) target.variants[params.edit.variantIndex].text = params.edit.text;
  }
  const achievement = {
    id: `ach_${Math.random().toString(36).slice(2, 10)}`,
    variants: [{ text, angleLabel: "", source: "手動新增" }],
  };
  const at = achievements.findIndex((a: { id: string }) => a.id === params.afterAchievementId);
  achievements.splice(at < 0 ? achievements.length : at + 1, 0, achievement);

  const { error } = await supabase
    .from("experience_entries")
    .update({ achievements, updated_at: new Date().toISOString() })
    .eq("id", params.entryId)
    .eq("user_id", user.id);
  if (error) return { error: error.message };

  // 雙語同步要問 AI，放到回應之後跑，打字不用等。
  const { after } = await import("next/server");
  after(async () => {
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
      text,
      sourceLabel: "手動新增（雙語同步）",
    }).catch(() => null);
  });

  revalidatePath("/experience");
  return { achievementId: achievement.id };
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
 * 使用者已經明確表示這是新內容，所以一律當成新的 achievement，不用再讓 AI 猜要不要合併。
 * AI 問答一次可能拆成好幾點（drafts），每點各自是一個 achievement，依序排在這段經歷最後面。 */
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
  drafts: { text: string; angleLabel: string }[];
  sourceLabel?: string;
}): Promise<CommitResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "請先登入" };

  const drafts = params.drafts.filter((d) => d.text.trim());
  if (drafts.length === 0) return { error: "沒有要新增的內容" };
  const newAchievements = drafts.map((d) => ({
    id: `ach_${Math.random().toString(36).slice(2, 10)}`,
    variants: [{ text: d.text, angleLabel: d.angleLabel, source: params.sourceLabel ?? "手動新增" }],
  }));

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
    achievements.push(...newAchievements);

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
        achievements: newAchievements,
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

  // 一點一點依序同步，不能同時跑：同步是「讀出另一個語言 → 改 → 寫回」，同時跑會互相蓋掉，
  // 甚至在另一個語言建出重複的經歷區塊。
  const { syncToOtherLanguage } = await import("@/lib/experience/syncLanguage");
  let syncedCount = 0;
  for (const d of drafts) {
    const synced = await syncToOtherLanguage({
      supabase,
      userId: user.id,
      sourceLanguage,
      orgName: sourceOrgName,
      role: sourceRole,
      location: sourceLocation,
      period: sourcePeriod,
      entryType: sourceEntryType,
      text: d.text,
      sourceLabel: `${params.sourceLabel ?? "手動新增"}（雙語同步）`,
    });
    if (synced !== null) syncedCount++;
  }

  revalidatePath("/experience");
  revalidatePath("/"); // 首次設定走「直接打字」時，首頁要知道使用者已經有經歷資料庫了
  return {
    success: true,
    entryId: resultEntryId,
    achievementId: newAchievements[0].id,
    variantIndex: 0,
    syncedToOtherLanguage: syncedCount > 0,
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
  /** 違反了哪幾類規則（BULLET_RULE_TAGS 的代號），卡片上顯示成標籤。舊的建議沒有。 */
  rules?: string[];
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

  // 使用者關掉的提醒類別：AI 不用檢查這幾類，回來的建議也濾掉。
  const muted = await loadMutedRules(supabase, user.id);
  const unmuted = (rules: string[] | undefined) => (rules ?? []).filter((r) => !muted.has(r));

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
          // 有標籤、而且標籤全被關掉的建議不顯示（之後打開又會出現）。
          .filter((f) => !f.reviewed && f.stored && !(f.stored.rules?.length && unmuted(f.stored.rules).length === 0))
          .map((f) => ({
            entryId: f.entryId,
            achievementId: f.achievementId,
            variantIndex: f.variantIndex,
            text: f.text,
            suggestion: stripRuleRefs(f.stored!.suggestion),
            rewrite: f.stored!.rewrite,
            rules: unmuted(f.stored!.rules),
          }))
      : [];
  const flat = all.filter((f) => !f.reviewed && !f.stored);

  const total = flat.length;
  const reviewedCount = all.length - flat.length;
  const batch = flat.slice(offset, offset + limit);
  if (batch.length === 0) return { flags: storedFlags, passed: [], total, reviewedCount };

  const { askClaude } = await import("@/lib/ai/askClaude");
  const { BULLET_RULES, RULE_TAG_INSTRUCTIONS, BULLET_RULE_TAGS } = await import("@/lib/experience/bulletRules");
  const mutedNames = BULLET_RULE_TAGS.filter((t) => muted.has(t.id)).map((t) => `${t.id}（${t.name}）`);
  const { toTraditional } = await import("@/lib/text/toTraditional");
  const { toFullWidthPunctuation } = await import("@/lib/text/fullWidthPunctuation");
  const systemPrompt = `你是履歷內容品質檢查助手。使用者會給你經歷資料庫裡一批 bullet 的清單（每條有編號），照下面的規則逐條檢查。這是經歷資料庫，還沒有目標 JD。

${BULLET_RULES}

另外也要抓錯字：不管中文英文，明顯的錯字、漏字、重複字都要標記，suggestion 直接指出錯在哪個字、應該是什麼。

${RULE_TAG_INSTRUCTIONS}
${mutedNames.length > 0 ? `\n使用者已經關掉這幾類提醒，這幾類的問題不用標記，也不用在 suggestion 提到：${mutedNames.join("、")}。\n` : ""}
每條都用同一套標準，不要因為前後文放寬或收緊。全部符合就是通過，不用列出來；有任何一條不符合就要列出：
- suggestion：用繁體中文一兩句話講清楚問題在哪（同一條有好幾個問題都要提到）。清單的 [0]、[1] 編號只是給你對照用，使用者看不到，提到別條時引用那條開頭幾個字（例如「跟「Rebuilt the corporate…」那條重複」），不要寫「第 6 條」。中文句子用全形標點。
- rewrite：直接給一個照規則改好的版本，語言跟原文相同，中文一律繁體。只能用原文裡已經有的事實跟數字，不要編造；如果問題是缺數字、光靠原文改不好，rewrite 還是先把結構改對，並在 suggestion 提醒「補上數字會更好，可以點『跟 AI 聊』補」。只有錯字的話，rewrite 就是改好錯字的原文。

只輸出 JSON，不要其他文字：
{ "flags": [{ "index": number, "rules": string[], "suggestion": string, "rewrite": string | null }] }`;

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

  let parsed: { flags: { index: number; rules?: unknown; suggestion: string; rewrite?: string | null }[] };
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
    const tagged = readRuleTags(f.rules);
    const rules = unmuted(tagged);
    // 只違反了被關掉的類別：當成通過。
    if (tagged.length > 0 && rules.length === 0) continue;
    flaggedIndexes.add(f.index);
    const rewrite = f.rewrite?.trim() ? toTraditional(f.rewrite.trim()) : null;
    flags.push({
      entryId: item.entryId,
      achievementId: item.achievementId,
      variantIndex: item.variantIndex,
      text: item.text,
      suggestion: toFullWidthPunctuation(stripRuleRefs(toTraditional(f.suggestion))),
      rewrite: rewrite && rewrite !== item.text ? rewrite : null,
      rules,
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
        v.flag = { text: f.text, suggestion: f.suggestion, rewrite: f.rewrite, rules: f.rules };
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

export type BackgroundEdit =
  | { kind: "summary"; index: number; text: string }
  | { kind: "removeSummary"; index: number }
  | { kind: "education"; index: number; field: keyof EducationItem; value: string }
  | { kind: "addEducation"; school: string }
  | { kind: "removeEducation"; index: number }
  | { kind: "skills"; text: string }
  | { kind: "languages"; text: string };

/**
 * 經歷資料庫頁直接編輯 Summary、學歷、技能、語言（profile_data.data.background）。
 * 每次只送一個改動、在這裡套到最新的資料上，連續改好幾格時才不會互相蓋掉。
 */
export async function updateBackgroundAction(
  language: string,
  edit: BackgroundEdit,
): Promise<{ error?: string; success?: boolean }> {
  if (language !== "zh" && language !== "en") return { error: "不支援的語言" };
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "請先登入" };

  const { data: existing } = await supabase.from("profile_data").select("data").eq("user_id", user.id).maybeSingle();
  const data = existing?.data ?? {};
  const all = readBackground(data);
  const b = all[language];

  switch (edit.kind) {
    case "summary":
      if (edit.text.trim()) b.summaries[edit.index] = edit.text.trim();
      else b.summaries.splice(edit.index, 1);
      break;
    case "removeSummary":
      b.summaries.splice(edit.index, 1);
      break;
    case "education": {
      const item = b.education[edit.index];
      if (!item) break;
      const value = edit.value.trim();
      // 校名清空等於刪掉這筆學歷。
      if (edit.field === "school") {
        if (value) item.school = value;
        else b.education.splice(edit.index, 1);
      } else {
        item[edit.field] = value || null;
      }
      break;
    }
    case "addEducation":
      b.education.push({ school: edit.school, detail: null, period: null, location: null });
      break;
    case "removeEducation":
      b.education.splice(edit.index, 1);
      break;
    case "skills":
      b.skills = splitList(edit.text);
      break;
    case "languages":
      b.languages = splitList(edit.text);
      break;
  }

  const { error } = await supabase.from("profile_data").upsert({ user_id: user.id, data: { ...data, background: all } });
  if (error) return { error: error.message };
  revalidatePath("/experience");
  return { success: true };
}

/** 經歷資料庫「從英文版翻成中文」（或反過來）：這個語言沒有的學歷、技能、語言，從另一個語言翻過來存好。 */
export async function translateBackgroundAction(language: string): Promise<{ error?: string; success?: boolean }> {
  if (language !== "zh" && language !== "en") return { error: "不支援的語言" };
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "請先登入" };

  try {
    await ensureBackgroundLanguage({ supabase, userId: user.id, language });
  } catch (e) {
    return { error: e instanceof Error ? e.message : "翻譯失敗" };
  }
  revalidatePath("/experience");
  return { success: true };
}

/** AI 問答寫第一份履歷的人：回答學歷、技能、語言三個問題，整理後存進經歷資料庫。 */
export async function saveBackgroundInterviewAction(
  answers: BackgroundAnswers,
): Promise<{ error?: string; added?: number }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "請先登入" };

  try {
    const added = await saveBackgroundAnswers({ supabase, userId: user.id, answers });
    revalidatePath("/experience");
    return { added };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "整理失敗" };
  }
}

/** 使用者關掉的提醒類別（profile_data.data.muted_rules），只影響「檢查」，不影響生成履歷。 */
async function loadMutedRules(supabase: Awaited<ReturnType<typeof createClient>>, userId: string): Promise<Set<string>> {
  const { data } = await supabase.from("profile_data").select("data").eq("user_id", userId).maybeSingle();
  return new Set(readRuleTags(data?.data?.muted_rules));
}

/** 建議卡片的「這類不用再提醒」，以及經歷資料庫上的「恢復提醒」。 */
export async function setRuleMutedAction(ruleId: string, muted: boolean): Promise<{ error?: string; mutedRules?: string[] }> {
  if (readRuleTags([ruleId]).length === 0) return { error: "不認得的提醒類別" };
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "請先登入" };

  const { data: existing } = await supabase.from("profile_data").select("data").eq("user_id", user.id).maybeSingle();
  const data = existing?.data ?? {};
  const current = new Set(readRuleTags(data.muted_rules));
  if (muted) current.add(ruleId);
  else current.delete(ruleId);
  const mutedRules = [...current];
  const { error } = await supabase.from("profile_data").upsert({ user_id: user.id, data: { ...data, muted_rules: mutedRules } });
  if (error) return { error: error.message };
  return { mutedRules };
}

/** 經歷資料庫「上一步／下一步」記下來的一份完整狀態：兩個語言的所有經歷，加上 Summary／學歷／技能／語言。 */
export interface ExperienceSnapshot {
  entries: {
    id: string;
    language: string;
    entryType: string;
    orgName: string;
    location: string | null;
    roleVariants: unknown;
    periodVariants: unknown;
    achievements: unknown;
    createdAt?: string;
  }[];
  background: unknown;
}

/**
 * 把經歷資料庫整份還原成某個時間點（上一步／下一步）：
 * 快照裡有的經歷寫回去（被刪掉的補回來），快照裡沒有的刪掉，Summary／學歷／技能／語言也換回當時的版本。
 * 只動目前登入的使用者自己的資料。
 */
export async function restoreExperienceSnapshotAction(snapshot: ExperienceSnapshot): Promise<{ error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "請先登入" };
  if (!Array.isArray(snapshot?.entries)) return { error: "還原的資料格式不對" };

  const { data: current, error: readError } = await supabase.from("experience_entries").select("id").eq("user_id", user.id);
  if (readError) return { error: readError.message };
  const keep = new Set(snapshot.entries.map((e) => e.id));

  const rows = snapshot.entries
    .filter((e) => (e.language === "zh" || e.language === "en") && (e.entryType === "work" || e.entryType === "leadership"))
    .map((e) => ({
      id: e.id,
      user_id: user.id,
      language: e.language,
      entry_type: e.entryType,
      org_name: e.orgName,
      location: e.location,
      role_variants: e.roleVariants,
      period_variants: e.periodVariants,
      achievements: e.achievements,
      ...(e.createdAt ? { created_at: e.createdAt } : {}),
      updated_at: new Date().toISOString(),
    }));
  if (rows.length > 0) {
    const { error } = await supabase.from("experience_entries").upsert(rows, { onConflict: "id" });
    if (error) return { error: error.message };
  }
  const toRemove = (current ?? []).map((r) => r.id).filter((id) => !keep.has(id));
  if (toRemove.length > 0) {
    const { error } = await supabase.from("experience_entries").delete().eq("user_id", user.id).in("id", toRemove);
    if (error) return { error: error.message };
  }

  if (snapshot.background && typeof snapshot.background === "object") {
    const { data: profile } = await supabase.from("profile_data").select("data").eq("user_id", user.id).maybeSingle();
    const { error } = await supabase
      .from("profile_data")
      .upsert({ user_id: user.id, data: { ...(profile?.data ?? {}), background: readBackground({ background: snapshot.background }) } });
    if (error) return { error: error.message };
  }

  revalidatePath("/experience");
  return {};
}
