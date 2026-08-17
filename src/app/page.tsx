import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { logout } from "@/app/logout/actions";

export default async function HomePage() {
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
      <div className="mx-auto max-w-3xl">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-neutral-900">jobahn</h1>
            <p className="text-sm text-neutral-500">{user.email}</p>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/settings"
              className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-100"
            >
              設定
            </Link>
            <form action={logout}>
              <button
                type="submit"
                className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-100"
              >
                登出
              </button>
            </form>
          </div>
        </div>

        <div className="mt-8 rounded-md border border-dashed border-neutral-300 bg-white p-6 text-sm text-neutral-500">
          {settings?.anthropic_key_last4 ? (
            <p>已綁定 Anthropic API Key（末 4 碼：{settings.anthropic_key_last4}）</p>
          ) : (
            <p>
              尚未綁定 Anthropic API Key，
              <Link href="/settings" className="font-medium text-neutral-900 underline">
                去設定頁綁定
              </Link>
              後才能使用生成功能
            </p>
          )}
          <p className="mt-2">
            應徵紀錄表格、履歷生成畫布等功能會在後續里程碑加上。
          </p>
        </div>
      </div>
    </div>
  );
}
