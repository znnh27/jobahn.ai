"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function signup(formData: FormData) {
  const supabase = await createClient();

  const email = formData.get("email") as string;
  const password = formData.get("password") as string;
  const displayName = formData.get("displayName") as string;

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { display_name: displayName },
    },
  });

  if (error) {
    redirect(`/signup?error=${encodeURIComponent(error.message)}`);
  }

  // Supabase 關掉 Confirm email 時，signUp 會直接回傳 session，已經是登入狀態
  if (data.session) {
    redirect("/");
  }

  redirect(`/login?message=${encodeURIComponent("請至信箱完成驗證後登入")}`);
}
