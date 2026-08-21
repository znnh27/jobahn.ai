"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { parseAllResumesForUser } from "@/lib/resumes/parseIntoDatabase";

const ALLOWED_TYPES = new Set([
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document", // .docx
  "application/msword", // .doc
  "application/pdf",
]);

const MAX_FILE_SIZE_BYTES = 3 * 1024 * 1024; // 3MB
const MAX_TOTAL_FILES = 30;

type UploadedResumeRow = {
  id: string;
  file_name: string;
  file_size_bytes: number;
  uploaded_at: string;
};

type UploadOneResult = { error?: string; success?: boolean; resume?: UploadedResumeRow };

export async function uploadOneResumeAction(formData: FormData): Promise<UploadOneResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "請先登入" };
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return { error: "沒有收到檔案" };
  }

  if (!ALLOWED_TYPES.has(file.type)) {
    return { error: `「${file.name}」不是支援的檔案類型，只接受 docx/doc/pdf` };
  }
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return { error: `「${file.name}」超過 3MB 上限` };
  }

  const { count: existingCount } = await supabase
    .from("original_resumes")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id);

  if ((existingCount ?? 0) + 1 > MAX_TOTAL_FILES) {
    return { error: `最多只能上傳 ${MAX_TOTAL_FILES} 份履歷（目前已有 ${existingCount ?? 0} 份）` };
  }

  const storagePath = `${user.id}/${Date.now()}-${file.name}`;

  const { error: uploadError } = await supabase.storage
    .from("original-resumes")
    .upload(storagePath, file, { contentType: file.type });

  if (uploadError) {
    return { error: `「${file.name}」上傳失敗：${uploadError.message}` };
  }

  const { data: resume, error: insertError } = await supabase
    .from("original_resumes")
    .insert({
      user_id: user.id,
      file_name: file.name,
      storage_path: storagePath,
      file_size_bytes: file.size,
    })
    .select("id, file_name, file_size_bytes, uploaded_at")
    .single();

  if (insertError || !resume) {
    return { error: `「${file.name}」寫入紀錄失敗：${insertError?.message ?? "unknown"}` };
  }

  revalidatePath("/onboarding");
  return { success: true, resume };
}

export async function listUploadedResumes() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return [];

  const { data } = await supabase
    .from("original_resumes")
    .select("id, file_name, file_size_bytes, uploaded_at")
    .eq("user_id", user.id)
    .order("uploaded_at", { ascending: false });

  return data ?? [];
}

export async function deleteUploadedResume(resumeId: string): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  const { data: resume } = await supabase
    .from("original_resumes")
    .select("storage_path")
    .eq("id", resumeId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!resume) return;

  await supabase.storage.from("original-resumes").remove([resume.storage_path]);
  await supabase.from("original_resumes").delete().eq("id", resumeId);

  revalidatePath("/onboarding");
}

type ParseResult = { error?: string; success?: boolean; entriesWritten?: number; conflicts?: string[] };

export async function parseResumes(): Promise<ParseResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "請先登入" };
  }

  try {
    const result = await parseAllResumesForUser(supabase, user.id);
    revalidatePath("/onboarding");
    revalidatePath("/");
    return { success: true, entriesWritten: result.entriesWritten, conflicts: result.conflicts };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "解析失敗" };
  }
}
