import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
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
    <div className="min-h-screen bg-neutral-50 px-6 py-10">
      <div className="mx-auto max-w-2xl space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold text-neutral-900">設定</h1>
          <Link href="/" className="text-sm text-neutral-500 hover:underline">
            回首頁
          </Link>
        </div>

        <AnthropicKeyForm last4={settings?.anthropic_key_last4 ?? null} />
      </div>
    </div>
  );
}
