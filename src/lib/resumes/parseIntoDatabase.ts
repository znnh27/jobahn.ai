import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { askClaude } from "@/lib/ai/askClaude";
import { extractResumeText } from "./extractText";

const SYSTEM_PROMPT = `你是履歷資料解析助手。使用者會給你多份他自己不同版本的履歷原文（可能中英文都有，內容彼此有重疊但用詞不同）。

你的任務：把這些內容解析、比對、合併成一份結構化的「經歷資料庫」，讓使用者之後可以從這個資料庫裡挑選內容去客製化寫給不同職缺的履歷。

規則：
1. 同一段工作/組織經歷在不同版本履歷裡的不同寫法，都要保留成「描述變體」，標註來源檔名，不要自己決定哪個版本比較好、也不要合併成一個版本，使用者自己會挑。
2. 中文和英文內容分開處理，不要互相翻譯。
3. 不要編造任何內容，資訊有衝突（例如日期、電話號碼不一致）要在 conflicts_needing_confirmation 裡列出來，不要自己猜測哪個對。
4. 只輸出 JSON，不要有其他文字、不要用 markdown code fence 包起來。

輸出格式（嚴格遵守這個 JSON 結構）：
{
  "profile": {
    "contact": { "name_zh": string|null, "name_en": string|null, "email": string|null, "phone": string|null, "linkedin": string|null, "portfolio": string|null },
    "education": [{ "school_zh": string|null, "school_en": string|null, "period": string, "location": string|null, "major": string|null, "minor": string|null }],
    "languages": string|null,
    "skills": string[],
    "summary_variants": [{ "source": string, "language": "zh"|"en", "text": string }]
  },
  "entries": [
    {
      "language": "zh"|"en",
      "entry_type": "work"|"leadership",
      "org_name": string,
      "location": string|null,
      "role_variants": [{ "role": string, "source": string[] }],
      "period_variants": [{ "period": string, "source": string[] }],
      "description_variants": [{ "source": string, "bullets": string[] }]
    }
  ],
  "conflicts_needing_confirmation": string[]
}`;

interface ParseResumesResult {
  entriesWritten: number;
  conflicts: string[];
}

export async function parseAllResumesForUser(
  supabase: SupabaseClient,
  userId: string,
): Promise<ParseResumesResult> {
  const { data: resumes, error: listError } = await supabase
    .from("original_resumes")
    .select("id, file_name, storage_path")
    .eq("user_id", userId);

  if (listError) throw new Error(`讀取履歷清單失敗：${listError.message}`);
  if (!resumes || resumes.length === 0) {
    throw new Error("還沒有上傳任何履歷");
  }

  const extracted: { fileName: string; text: string }[] = [];

  for (const resume of resumes) {
    const { data: fileBlob, error: downloadError } = await supabase.storage
      .from("original-resumes")
      .download(resume.storage_path);

    if (downloadError || !fileBlob) {
      throw new Error(`下載「${resume.file_name}」失敗：${downloadError?.message ?? "unknown"}`);
    }

    const buffer = Buffer.from(await fileBlob.arrayBuffer());
    const text = await extractResumeText(buffer, resume.file_name);
    extracted.push({ fileName: resume.file_name, text });
  }

  const userPrompt = extracted
    .map((e) => `===== 檔案：${e.fileName} =====\n${e.text}`)
    .join("\n\n");

  const response = await askClaude({
    userId,
    feature: "resume_parse",
    systemPrompt: SYSTEM_PROMPT,
    userPrompt,
    maxTokens: 16000,
    supabase,
  });

  const parsed = parseJsonResponse(response.text);

  await supabase.from("profile_data").upsert({
    user_id: userId,
    data: parsed.profile,
  });

  if (parsed.entries.length > 0) {
    const rows = parsed.entries.map((entry) => ({
      user_id: userId,
      language: entry.language,
      entry_type: entry.entry_type,
      org_name: entry.org_name,
      location: entry.location,
      role_variants: entry.role_variants,
      period_variants: entry.period_variants,
      description_variants: entry.description_variants,
    }));

    const { error: insertError } = await supabase.from("experience_entries").insert(rows);
    if (insertError) throw new Error(`寫入經歷資料庫失敗：${insertError.message}`);
  }

  return {
    entriesWritten: parsed.entries.length,
    conflicts: parsed.conflicts_needing_confirmation ?? [],
  };
}

interface ParsedResumeData {
  profile: Record<string, unknown>;
  entries: Array<{
    language: string;
    entry_type: string;
    org_name: string;
    location: string | null;
    role_variants: unknown;
    period_variants: unknown;
    description_variants: unknown;
  }>;
  conflicts_needing_confirmation: string[];
}

function parseJsonResponse(text: string): ParsedResumeData {
  // 保險起見剝掉可能出現的 markdown code fence
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "");

  try {
    return JSON.parse(cleaned) as ParsedResumeData;
  } catch {
    throw new Error("AI 回傳的內容不是有效的 JSON，解析失敗");
  }
}
