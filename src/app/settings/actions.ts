"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { ResumeContact } from "@/lib/resumes/contact";

async function verifyAnthropicKey(key: string): Promise<boolean> {
  try {
    const res = await fetch("https://api.anthropic.com/v1/models", {
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function setAnthropicKey(formData: FormData) {
  const key = (formData.get("anthropicKey") as string)?.trim();

  if (!key) {
    return { error: "請輸入 API Key" };
  }

  const isValid = await verifyAnthropicKey(key);
  if (!isValid) {
    return { error: "這組 API Key 驗證失敗，請確認是否複製正確或額度是否足夠" };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_user_anthropic_key", {
    p_key: key,
  });

  if (error) {
    return { error: `儲存失敗：${error.message}` };
  }

  revalidatePath("/settings");
  revalidatePath("/");
  return { success: true };
}

export async function removeAnthropicKey() {
  const supabase = await createClient();
  const { error } = await supabase.rpc("remove_user_anthropic_key");

  if (error) {
    return { error: `移除失敗：${error.message}` };
  }

  revalidatePath("/settings");
  revalidatePath("/");
  return { success: true };
}

// 給 <form action> 用的版本：不回傳值（回傳值另外用 useActionState 處理的表單走 removeAnthropicKey）
export async function removeAnthropicKeyAction(): Promise<void> {
  await removeAnthropicKey();
}

/** 儲存履歷抬頭（姓名＋聯絡資訊）。標記 contact_confirmed，之後上傳履歷解析出來的聯絡資訊
 * 就不會蓋掉使用者自己填的內容（見 lib/experience/mergeIntoExperienceDb.ts）。 */
export async function saveContactAction(
  contact: ResumeContact,
): Promise<{ error?: string; success?: boolean }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "請先登入" };

  const clean = (v: string | null) => (v && v.trim() ? v.trim() : null);
  const cleaned = {
    name_zh: clean(contact.name_zh),
    name_en: clean(contact.name_en),
    email: clean(contact.email),
    phone: clean(contact.phone),
    linkedin: clean(contact.linkedin),
    portfolio: clean(contact.portfolio),
    others: (contact.others ?? [])
      .map((o) => ({ label: o.label.trim(), value: o.value.trim() }))
      .filter((o) => o.label && o.value),
  };
  if (!cleaned.name_zh && !cleaned.name_en) return { error: "至少要填一個名字（中文或英文）" };
  if (!cleaned.email) return { error: "請填 Email" };

  const { data: existing } = await supabase
    .from("profile_data")
    .select("data")
    .eq("user_id", user.id)
    .maybeSingle();

  const { error } = await supabase.from("profile_data").upsert({
    user_id: user.id,
    data: { ...(existing?.data ?? {}), contact: cleaned, contact_confirmed: true },
  });
  if (error) return { error: error.message };

  revalidatePath("/settings");
  revalidatePath("/applications", "layout");
  return { success: true };
}
