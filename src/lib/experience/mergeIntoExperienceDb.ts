import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { askClaude } from "@/lib/ai/askClaude";
import { readContact, type ResumeContact } from "@/lib/resumes/contact";
import {
  mergeLanguageBackground,
  readBackground,
  readLanguageBackground,
  type LanguageBackground,
} from "@/lib/resumes/background";

// Phase 1（經歷資料庫重新設計）的核心：把「新內容」（一份履歷檔案的原文，或一次應徵定案
// 用到的內容）併進使用者既有的經歷資料庫，只會新增、絕對不會刪除既有資料。
//
// 跟舊版 parseAllResumesForUser 的差異：
// 1. 舊版每次重新處理「全部」上傳過的檔案、整批 INSERT 新資料，從來沒刪掉舊的 → 每次重新
//    解析都會重複。這版只處理「這一次的新內容」，跟現有資料庫比對後決定要併到哪裡。
// 2. 同一件事的不同寫法（bullet）不再依「來源檔案」分組，而是依「同一個成就/同一件事」分組
//    在同一個 achievement 底下，每個寫法附一個簡短的「強調重點」標籤，供之後挑選用。

interface ExistingAchievementSummary {
  achievementId: string;
  variantTexts: string[];
}

interface ExistingEntrySummary {
  entryId: string;
  language: string;
  entryType: string;
  orgName: string;
  location: string | null;
  roles: string[];
  periods: string[];
  achievements: ExistingAchievementSummary[];
}

interface AppendVariantAction {
  action: "append_variant";
  entryId: string;
  achievementId: string;
  text: string;
  angleLabel: string;
}

interface VariantDraft {
  text: string;
  angleLabel: string;
}

interface NewAchievementAction {
  action: "new_achievement";
  entryId: string;
  variants: VariantDraft[];
}

interface AppendRoleVariantAction {
  action: "append_role_variant";
  entryId: string;
  role: string;
}

interface NewEntryAction {
  action: "new_entry";
  language: string;
  entryType: string;
  orgName: string;
  location: string | null;
  role: string;
  period: string;
  achievements: { variants: VariantDraft[] }[];
}

type MergeAction =
  | AppendVariantAction
  | NewAchievementAction
  | AppendRoleVariantAction
  | NewEntryAction;

interface MergePlanResponse {
  contact: Partial<ResumeContact> | null;
  background: Record<string, unknown> | null;
  conflicts_needing_confirmation: string[];
  actions: MergeAction[];
}

export interface MergeResult {
  newEntriesCreated: number;
  newAchievementsCreated: number;
  variantsAppended: number;
  roleVariantsAppended: number;
  /** 新增的 Summary、學歷、技能、語言總共幾項。 */
  backgroundItemsAdded: number;
  conflicts: string[];
}

const SYSTEM_PROMPT = `你是履歷經歷資料庫的合併助手。使用者已經有一份整理好的經歷資料庫（依公司/職位分組，每組底下的 bullet 又依「同一件事的不同寫法」分組成 achievement），現在要把「一份新的履歷內容」併進這個資料庫。

規則：
1. 只會新增，絕對不會刪除或覆蓋既有的 achievement、variant、entry。
2. 新內容裡的每一條 bullet，你要判斷屬於哪一種情況：
   a. 這條講的事情跟某個既有 entry 底下某個既有 achievement 是同一件事（只是寫法不同）→ 輸出 append_variant，帶那個 entry 跟 achievement 的 id
   b. 這條是某個既有 entry（同一家公司同一個職位）底下的新成就，資料庫裡還沒有 → 輸出 new_achievement，帶那個 entry 的 id
   c. 這是一個全新的公司/組織或全新的職位，資料庫裡完全沒有對應的 entry → 輸出 new_entry，附完整資訊
   判斷「是不是同一件事」要看底層事件，不要看措辭：同一個專案、同一個產出、同一個量化指標、同一段合作關係，就算用詞、長短、強調角度、數字寫法完全不同，都算同一件事。資料庫裡每個 achievement 會列出它目前「全部」的寫法（variantTexts），請跟每一條都比對，不要只看第一條。
   **幾乎一樣的不要輸出**：新內容的 bullet 如果跟某個既有 variant 只差幾個字、標點、語序或同義詞替換，講的重點跟角度都一樣，就當成重複，這條什麼動作都不要輸出。只有換了強調角度、補了新的事實或數字，才算新的寫法。
   **拿不準時一律選 append_variant**：多一條寫法沒有傷害，多出一個重複的 achievement 會污染資料庫。只有在確定是資料庫裡沒出現過的另一件事時，才用 new_achievement。
   如果新內容裡有好幾條 bullet 講的是同一件新的事，把它們放進同一個 new_achievement（或 new_entry 底下同一個 achievement）的 variants 陣列，不要拆成好幾個 achievement。
3. 判斷「同一家公司」時要看語意，不要只比對字串——「台灣積體電路製造股份有限公司」「台灣積體電路製造股份有限公司（半導體公司...）」「TSMC」如果指的是同一家公司，都算同一個 entry，不要因為附註文字不同就當成不同公司開新的 entry。
4. 每一條輸出的 bullet 文字都要附一個簡短的「角度標籤」（angleLabel），描述這個寫法強調什麼重點，例如「強調從 0 到 1 實作」「強調數據分析與量化成果」「強調跨部門溝通協調」，這個標籤只給使用者自己參考挑選用，不會出現在正式履歷裡。
5. 職稱也要比照 bullet 累積不同寫法：如果新內容對某個既有 entry 的職稱寫法（跟資料庫裡列出的 roles 比對）不完全一樣（例如「PM」vs「Project Manager」、中英文不同語言下的職稱說法），輸出 append_role_variant 把新寫法加進去；如果新內容的職稱只是大小寫、標點差異，跟既有寫法本質相同，就不用輸出這個動作，避免重複累積幾乎一樣的字串。**任職期間（period）不用做這個處理**，維持原本第一次寫入的版本就好，不管新內容怎麼描述期間都不用理它。
6. 中文和英文內容分開處理，不要互相翻譯，language 欄位一律用 "zh" 或 "en"。
7. 不要編造任何內容。
8. 聯絡資訊（contact）：跟使用者目前已經存的 contact 合併。同一個真實值只是格式不同就直接正規化輸出（電話號碼一律 +886-9XXXXXXXX 格式）；真的兜不起來、無法判斷哪個正確的欄位維持原本值，把說明放進 conflicts_needing_confirmation，不要把衝突文字塞進欄位本身。新內容裡沒有聯絡資訊就回傳 null。
9. 經歷以外的內容（background）：把新內容裡的 Professional Summary／自我介紹、學歷、技能、語言能力抽出來，依內容的語言放進 "zh" 或 "en"（跟規則 6 一樣不要互相翻譯）。**這幾項有出現就一定要抽**，不要因為新內容沒有聯絡資訊或缺了其中一項就整個略過；只有新內容完全沒有的項目才給空陣列。
   - summaries：Summary 整段原文照抄，一段一個字串。
   - education：每間學校一筆，school 只放校名（城市、國家放 location，不要接在校名後面），detail 放學位、科系、輔修、交換、GPA 等補充（沒有就 null），period、location 沒寫就 null。
   - skills：工具、軟體、專業技能，一項一個字串，例如 "Figma"、"SQL"、"A/B Testing"。不要把語言能力放進來。
   - languages：一個語言一個字串，程度寫在括號裡，例如 "English (Fluent, TOEIC 945)"、"German (B2)"、「日文（N2）」。
   - 跟使用者目前已經存的 background 是同一件事的（同一間學校、同一個技能、同一個語言），用跟既有資料一字不差的寫法輸出，系統才會認出是重複；只有新的資訊（例如新的檢定分數）才用新寫法。
10. 只輸出 JSON，不要有其他文字、不要用 markdown code fence 包起來。

輸出格式（嚴格遵守）：
{
  "contact": { "name_zh": string|null, "name_en": string|null, "email": string|null, "phone": string|null, "linkedin": string|null, "portfolio": string|null } | null,
  "background": {
    "zh": { "summaries": string[], "education": [{ "school": string, "detail": string|null, "period": string|null, "location": string|null }], "skills": string[], "languages": string[] },
    "en": { 同上 }
  },
  "conflicts_needing_confirmation": string[],
  "actions": [
    { "action": "append_variant", "entryId": string, "achievementId": string, "text": string, "angleLabel": string },
    { "action": "new_achievement", "entryId": string, "variants": [{ "text": string, "angleLabel": string }] },
    { "action": "append_role_variant", "entryId": string, "role": string },
    { "action": "new_entry", "language": "zh"|"en", "entryType": "work"|"leadership", "orgName": string, "location": string|null, "role": string, "period": string, "achievements": [{ "variants": [{ "text": string, "angleLabel": string }] }] }
  ]
}`;

export async function mergeContentIntoExperienceDb(params: {
  supabase: SupabaseClient;
  userId: string;
  sourceLabel: string;
  rawContent: string;
}): Promise<MergeResult> {
  const { supabase, userId, sourceLabel, rawContent } = params;

  const existingSummary = await loadExistingSummary(supabase, userId);

  const { data: existingProfile } = await supabase
    .from("profile_data")
    .select("data")
    .eq("user_id", userId)
    .maybeSingle();

  const userPrompt = `===== 使用者目前的經歷資料庫（摘要，每個 achievement 列出目前全部的寫法）=====
${JSON.stringify(existingSummary, null, 2)}

===== 使用者目前的聯絡資訊（contact）=====
${JSON.stringify(readContact(existingProfile?.data), null, 2)}

===== 使用者目前的 background =====
${JSON.stringify(readBackground(existingProfile?.data), null, 2)}

===== 新內容（來源：${sourceLabel}）=====
${rawContent}`;

  const response = await askClaude({
    userId,
    feature: "experience_merge",
    systemPrompt: SYSTEM_PROMPT,
    userPrompt,
    maxTokens: 16000,
    supabase,
  });

  const plan = parseJsonResponse(response.text);

  const backgroundItemsAdded = await mergeProfile(supabase, userId, existingProfile?.data ?? {}, plan);

  const result: MergeResult = {
    newEntriesCreated: 0,
    newAchievementsCreated: 0,
    variantsAppended: 0,
    roleVariantsAppended: 0,
    backgroundItemsAdded,
    conflicts: plan.conflicts_needing_confirmation ?? [],
  };

  for (const action of plan.actions) {
    if (action.action === "new_entry") {
      const achievements = action.achievements
        .map((a) => toVariants(a.variants, sourceLabel))
        .filter((variants) => variants.length > 0)
        .map((variants) => ({ id: newAchievementId(), variants }));

      const { error } = await supabase.from("experience_entries").insert({
        user_id: userId,
        language: action.language,
        entry_type: action.entryType,
        org_name: action.orgName,
        location: action.location,
        role_variants: [{ role: action.role, source: [sourceLabel] }],
        period_variants: [{ period: action.period, source: [sourceLabel] }],
        achievements,
      });
      if (error) throw new Error(`新增經歷區塊失敗：${error.message}`);
      result.newEntriesCreated += 1;
      result.newAchievementsCreated += achievements.length;
      continue;
    }

    if (action.action === "new_achievement") {
      const { data: row, error: readError } = await supabase
        .from("experience_entries")
        .select("achievements")
        .eq("id", action.entryId)
        .eq("user_id", userId)
        .maybeSingle();
      if (readError || !row) throw new Error(`找不到要新增成就的經歷區塊：${action.entryId}`);

      const variants = toVariants(action.variants, sourceLabel);
      if (variants.length === 0) continue;

      const achievements = Array.isArray(row.achievements) ? row.achievements : [];
      achievements.push({ id: newAchievementId(), variants });

      const { error: writeError } = await supabase
        .from("experience_entries")
        .update({ achievements, updated_at: new Date().toISOString() })
        .eq("id", action.entryId)
        .eq("user_id", userId);
      if (writeError) throw new Error(`寫入新成就失敗：${writeError.message}`);
      result.newAchievementsCreated += 1;
      continue;
    }

    if (action.action === "append_variant") {
      const { data: row, error: readError } = await supabase
        .from("experience_entries")
        .select("achievements")
        .eq("id", action.entryId)
        .eq("user_id", userId)
        .maybeSingle();
      if (readError || !row) throw new Error(`找不到要新增寫法的經歷區塊：${action.entryId}`);

      const achievements = Array.isArray(row.achievements) ? row.achievements : [];
      const target = achievements.find(
        (a: { id: string }) => a.id === action.achievementId,
      );
      if (!target) throw new Error(`找不到要新增寫法的 achievement：${action.achievementId}`);

      // 應徵定案寫回時，直接沿用資料庫原文的 bullet 會被 AI 當成「新寫法」再加一次，
      // 所以寫入前先比對，文字實質相同就跳過
      const key = normalizeForDedupe(action.text);
      if (target.variants.some((v: { text: string }) => normalizeForDedupe(v.text) === key)) continue;

      target.variants.push({ text: action.text, angleLabel: action.angleLabel, source: sourceLabel });

      const { error: writeError } = await supabase
        .from("experience_entries")
        .update({ achievements, updated_at: new Date().toISOString() })
        .eq("id", action.entryId)
        .eq("user_id", userId);
      if (writeError) throw new Error(`寫入新寫法失敗：${writeError.message}`);
      result.variantsAppended += 1;
      continue;
    }

    if (action.action === "append_role_variant") {
      const { data: row, error: readError } = await supabase
        .from("experience_entries")
        .select("role_variants")
        .eq("id", action.entryId)
        .eq("user_id", userId)
        .maybeSingle();
      if (readError || !row) throw new Error(`找不到要新增職稱寫法的經歷區塊：${action.entryId}`);

      const roleVariants = Array.isArray(row.role_variants) ? row.role_variants : [];
      roleVariants.push({ role: action.role, source: [sourceLabel] });

      const { error: writeError } = await supabase
        .from("experience_entries")
        .update({ role_variants: roleVariants, updated_at: new Date().toISOString() })
        .eq("id", action.entryId)
        .eq("user_id", userId);
      if (writeError) throw new Error(`寫入新職稱寫法失敗：${writeError.message}`);
      result.roleVariantsAppended += 1;
      continue;
    }
  }

  return result;
}

async function loadExistingSummary(
  supabase: SupabaseClient,
  userId: string,
): Promise<ExistingEntrySummary[]> {
  const { data, error } = await supabase
    .from("experience_entries")
    .select("id, language, entry_type, org_name, location, role_variants, period_variants, achievements")
    .eq("user_id", userId);

  if (error) throw new Error(`讀取既有經歷資料庫失敗：${error.message}`);

  return (data ?? []).map((row) => ({
    entryId: row.id,
    language: row.language,
    entryType: row.entry_type,
    orgName: row.org_name,
    location: row.location,
    roles: (row.role_variants ?? []).map((r: { role: string }) => r.role),
    periods: (row.period_variants ?? []).map((p: { period: string }) => p.period),
    achievements: (row.achievements ?? []).map(
      (a: { id: string; variants: { text: string }[] }) => ({
        achievementId: a.id,
        variantTexts: (a.variants ?? []).map((v) => v.text),
      }),
    ),
  }));
}

/**
 * 重新定案時用：把「某次定案寫進來、這次已經改掉或刪掉」的寫法從資料庫移除。
 * 只動 source 完全等於這個來源標籤的寫法，別的來源（上傳的履歷、其他應徵、AI 潤飾）一律不碰。
 * 一個成就的寫法被刪光了，就把那個成就也拿掉。
 */
export async function removeVariantsFromSource(params: {
  supabase: SupabaseClient;
  userId: string;
  sourceLabel: string;
  texts: string[];
}): Promise<number> {
  const { supabase, userId, sourceLabel, texts } = params;
  const keys = new Set(texts.map(normalizeForDedupe));
  if (keys.size === 0) return 0;

  const { data: rows } = await supabase
    .from("experience_entries")
    .select("id, achievements")
    .eq("user_id", userId);

  let removed = 0;
  for (const row of rows ?? []) {
    const achievements: { id: string; variants: { text: string; source?: string }[] }[] = Array.isArray(row.achievements)
      ? row.achievements
      : [];
    let changed = false;
    const next = achievements
      .map((a) => {
        const variants = (a.variants ?? []).filter((v) => {
          const drop = v.source === sourceLabel && keys.has(normalizeForDedupe(v.text));
          if (drop) {
            removed++;
            changed = true;
          }
          return !drop;
        });
        return { ...a, variants };
      })
      .filter((a) => a.variants.length > 0);
    if (!changed) continue;
    await supabase
      .from("experience_entries")
      .update({ achievements: next, updated_at: new Date().toISOString() })
      .eq("id", row.id)
      .eq("user_id", userId);
  }
  return removed;
}

function toVariants(variants: VariantDraft[] | undefined, sourceLabel: string) {
  return (Array.isArray(variants) ? variants : [])
    .filter((v) => v.text?.trim())
    .map((v) => ({ text: v.text, angleLabel: v.angleLabel ?? "", source: sourceLabel }));
}

// 忽略空白、全形/半形標點與大小寫差異，只用來判斷「是不是同一段文字」
function normalizeForDedupe(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s\p{P}]/gu, "");
}

function newAchievementId(): string {
  return `ach_${Math.random().toString(36).slice(2, 10)}`;
}

function parseJsonResponse(text: string): MergePlanResponse {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "");

  try {
    return JSON.parse(cleaned) as MergePlanResponse;
  } catch {
    throw new Error("AI 回傳的合併計畫不是有效的 JSON，解析失敗");
  }
}

/**
 * 聯絡資訊、Summary、學歷、技能、語言併進 profile_data。只會新增，不會刪掉已經有的內容；
 * 使用者自己填過的履歷抬頭（contact_confirmed）以使用者填的為準，排版設定等其他欄位原樣保留。
 */
async function mergeProfile(
  supabase: SupabaseClient,
  userId: string,
  existingData: Record<string, unknown>,
  plan: MergePlanResponse,
): Promise<number> {
  const data = { ...existingData };
  let added = 0;

  if (plan.contact && !existingData.contact_confirmed) {
    const incoming = Object.fromEntries(
      Object.entries(plan.contact).filter(([, v]) => typeof v === "string" && v.trim()),
    );
    data.contact = { ...readContact(existingData), ...incoming };
  }

  if (plan.background) {
    const existing = readBackground(existingData);
    const merged = {
      zh: mergeLanguageBackground(existing.zh, readLanguageBackground(plan.background.zh)),
      en: mergeLanguageBackground(existing.en, readLanguageBackground(plan.background.en)),
    };
    added = countItems(merged.zh) + countItems(merged.en) - countItems(existing.zh) - countItems(existing.en);
    data.background = merged;
  }

  const { error } = await supabase.from("profile_data").upsert({ user_id: userId, data });
  if (error) throw new Error(`儲存個人資料失敗：${error.message}`);
  return added;
}

function countItems(b: LanguageBackground): number {
  return b.summaries.length + b.education.length + b.skills.length + b.languages.length;
}
