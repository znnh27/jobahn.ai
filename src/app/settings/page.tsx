import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { BrandMark } from "../BrandMark";
import { AnthropicKeyForm } from "./key-form";

export default async function SettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: settings } = await supabase
    .from("user_settings")
    .select("anthropic_key_last4")
    .eq("user_id", user.id)
    .maybeSingle();

  return (
    <div className="page">
      <div className="page-container">
        <BrandMark />
        <div className="page-header">
          <h1 className="heading-page">帳號設定</h1>
          <Link href="/" className="link-muted">
            回首頁
          </Link>
        </div>

        <AnthropicKeyForm last4={settings?.anthropic_key_last4 ?? null} />
      </div>
    </div>
  );
}
