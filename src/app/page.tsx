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
    .select("id, company_name, job_title, status, ats_score, resume_language, created_at")
    .order("created_at", { ascending: false });

  return (
    <div className="page">
      <div className="page-container page-container--home">
        <div className="page-header">
          <div className="stack-tight">
            <h1 className="heading-page">jobahn</h1>
            <p className="text-muted">{user.email}</p>
          </div>
          <div className="toolbar-inline">
            <Link href="/onboarding" className="btn btn-secondary">
              首次設定
            </Link>
            <Link href="/settings" className="btn btn-secondary">
              設定
            </Link>
            <form action={logout}>
              <button type="submit" className="btn btn-secondary">
                登出
              </button>
            </form>
          </div>
        </div>

        <div className="card card--dashed">
          {settings?.anthropic_key_last4 ? (
            <p>目前使用你自己綁定的 Anthropic API Key（末 4 碼：{settings.anthropic_key_last4}）</p>
          ) : (
            <p>
              目前使用共用額度，不需要額外設定。想改用自己的 Key 可以去
              <Link href="/settings" className="link">
                設定頁
              </Link>
              綁定。
            </p>
          )}
        </div>

        <div className="page-header">
          <h2 className="heading-card">應徵紀錄</h2>
          <Link href="/applications/new" className="btn btn-primary">
            + 新增應徵
          </Link>
        </div>

        <div className="table-wrap">
          {applications && applications.length > 0 ? (
            <table className="data-table">
              <thead>
                <tr>
                  <th>公司</th>
                  <th>職缺</th>
                  <th>狀態</th>
                  <th>ATS</th>
                  <th>下載履歷</th>
                </tr>
              </thead>
              <tbody>
                {applications.map((app) => (
                  <tr key={app.id}>
                    <td>
                      <Link href={`/applications/${app.id}`} className="link-table">
                        {app.company_name || "未命名公司"}
                      </Link>
                    </td>
                    <td>{app.job_title || "—"}</td>
                    <td>{app.status}</td>
                    <td>{app.ats_score ?? "—"}</td>
                    <td>
                      {app.status === "draft" ? (
                        "—"
                      ) : (
                        <div className="download-lang-list">
                          {(app.resume_language ?? []).map((lang: string) => (
                            <span key={lang} className="download-lang-item">
                              {lang}：
                              <a
                                href={`/applications/${app.id}/resume-download?lang=${lang}&format=docx`}
                                className="link-table"
                              >
                                Word
                              </a>
                              {" / "}
                              <a
                                href={`/applications/${app.id}/resume-download?lang=${lang}&format=pdf`}
                                className="link-table"
                              >
                                PDF
                              </a>
                            </span>
                          ))}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="table-empty">還沒有應徵紀錄</p>
          )}
        </div>
      </div>
    </div>
  );
}
