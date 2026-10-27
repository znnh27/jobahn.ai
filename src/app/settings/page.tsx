import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AppNav, getDisplayName } from "../AppNav";
import { AnthropicKeyForm } from "./key-form";
import { ContactForm } from "../ContactForm";
import { readContact } from "@/lib/resumes/contact";
import { readMemory } from "@/lib/ai/userMemory";
import { MemoryForm } from "./memory-form";

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

  const { data: profile } = await supabase
    .from("profile_data")
    .select("data")
    .eq("user_id", user.id)
    .maybeSingle();

  return (
    <div className="page page--with-nav">
      <AppNav userName={getDisplayName(user)} />
      <div className="page-container">
        <div className="page-header">
          <h1 className="heading-page">帳號設定</h1>
        </div>

        <div className="card stack">
          <div className="stack-tight">
            <h2 className="heading-card">履歷抬頭</h2>
            <p className="text-muted">履歷最上面的姓名跟聯絡資訊，求職信署名也會用這裡的名字。</p>
          </div>
          <ContactForm initial={readContact(profile?.data)} />
        </div>

        <MemoryForm notes={readMemory(profile?.data)} />

        <AnthropicKeyForm last4={settings?.anthropic_key_last4 ?? null} />
      </div>
    </div>
  );
}
