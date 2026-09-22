import Link from "next/link";
import { signup } from "./actions";

export default async function SignupPage(props: PageProps<"/signup">) {
  const { error } = await props.searchParams;

  return (
    <div className="auth-page">
      <div className="auth-card">
        {/* eslint-disable-next-line @next/next/no-img-element -- 純裝飾性的靜態吉祥物圖，不需要 next/image 的最佳化 */}
        <img
          src="/logo-mascot.png"
          alt="jobahn 吉祥物：提著公事包的石斑魚"
          className="landing-mascot"
        />
        <h1 className="landing-wordmark">
          jo<span className="landing-wordmark-accent">bahn</span>
        </h1>
        <div className="auth-card-header">
          <h1 className="heading-auth">註冊</h1>
          <p className="text-muted">jobahn 找工作助手</p>
        </div>

        {error && <div className="alert alert-error">{error}</div>}

        <form action={signup} className="form-stack">
          <div className="field">
            <label htmlFor="displayName" className="label">
              名字
            </label>
            <input id="displayName" name="displayName" type="text" required className="input" />
          </div>
          <div className="field">
            <label htmlFor="email" className="label">
              Email
            </label>
            <input id="email" name="email" type="email" required className="input" />
          </div>
          <div className="field">
            <label htmlFor="password" className="label">
              密碼（至少 6 碼）
            </label>
            <input
              id="password"
              name="password"
              type="password"
              minLength={6}
              required
              className="input"
            />
          </div>
          <button type="submit" className="btn btn-primary btn--full">
            註冊
          </button>
        </form>

        <p className="text-muted text-center">
          已經有帳號了？{" "}
          <Link href="/login" className="link">
            登入
          </Link>
        </p>
      </div>
    </div>
  );
}
