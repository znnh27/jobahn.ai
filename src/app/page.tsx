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

  const { data: applications } = await supabase
    .from("applications")
    .select("id, company_name, job_title, status, ats_score, created_at")
    .order("created_at", { ascending: false });

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
              href="/onboarding"
              className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-100"
            >
              首次設定
            </Link>
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
            <p>目前使用你自己綁定的 Anthropic API Key（末 4 碼：{settings.anthropic_key_last4}）</p>
          ) : (
            <p>
              目前使用共用額度，不需要額外設定。想改用自己的 Key 可以去
              <Link href="/settings" className="font-medium text-neutral-900 underline">
                設定頁
              </Link>
              綁定。
            </p>
          )}
        </div>

        <div className="mt-6 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-neutral-900">應徵紀錄</h2>
          <Link
            href="/applications/new"
            className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-800"
          >
            + 新增應徵
          </Link>
        </div>

        <div className="mt-3 overflow-hidden rounded-lg border border-neutral-200 bg-white">
          {applications && applications.length > 0 ? (
            <table className="w-full text-left text-sm">
              <thead className="bg-neutral-50 text-neutral-500">
                <tr>
                  <th className="px-4 py-2 font-medium">公司</th>
                  <th className="px-4 py-2 font-medium">職缺</th>
                  <th className="px-4 py-2 font-medium">狀態</th>
                  <th className="px-4 py-2 font-medium">ATS</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {applications.map((app) => (
                  <tr key={app.id}>
                    <td className="px-4 py-2">
                      <Link href={`/applications/${app.id}`} className="text-neutral-900 hover:underline">
                        {app.company_name || "未命名公司"}
                      </Link>
                    </td>
                    <td className="px-4 py-2 text-neutral-600">{app.job_title || "—"}</td>
                    <td className="px-4 py-2 text-neutral-600">{app.status}</td>
                    <td className="px-4 py-2 text-neutral-600">{app.ats_score ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="p-4 text-sm text-neutral-500">還沒有應徵紀錄</p>
          )}
        </div>
      </div>
    </div>
  );
}
