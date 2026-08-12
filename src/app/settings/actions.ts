"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

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
