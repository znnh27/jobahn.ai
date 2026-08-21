import Link from "next/link";
import { signup } from "./actions";

export default async function SignupPage(props: PageProps<"/signup">) {
  const { error } = await props.searchParams;

  return (
    <div className="auth-page">
      <div className="auth-card">
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
