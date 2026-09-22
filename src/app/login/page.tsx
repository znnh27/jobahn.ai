import Link from "next/link";
import { login } from "./actions";

export default async function LoginPage(props: PageProps<"/login">) {
  const { error, message } = await props.searchParams;

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
          <h1 className="heading-auth">登入</h1>
          <p className="text-muted">jobahn 找工作助手</p>
        </div>

        {error && <div className="alert alert-error">{error}</div>}
        {message && <div className="alert alert-success">{message}</div>}

        <form action={login} className="form-stack">
          <div className="field">
            <label htmlFor="email" className="label">
              Email
            </label>
            <input id="email" name="email" type="email" required className="input" />
          </div>
          <div className="field">
            <label htmlFor="password" className="label">
              密碼
            </label>
            <input id="password" name="password" type="password" required className="input" />
          </div>
          <button type="submit" className="btn btn-primary btn--full">
            登入
          </button>
        </form>

        <p className="text-muted text-center">
          還沒有帳號？{" "}
          <Link href="/signup" className="link">
            註冊
          </Link>
        </p>
      </div>
    </div>
  );
}
