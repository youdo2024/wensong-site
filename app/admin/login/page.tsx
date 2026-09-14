import type { Metadata } from "next";
import { login } from "../actions";

export const metadata = { robots: { index: false, follow: false },  title: "後台登入" };

export default async function AdminLogin({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  return (
    <div className="adm-login">
      <form className="box" style={{ width: 380, maxWidth: "100%" }} action={login}>
        <div className="band" />
        <div className="inner">
          <div className="center" style={{ marginBottom: 20 }}>
            <span className="tag" style={{ display: "inline-block", border: "1.5px solid var(--indigo)", color: "var(--indigo)", fontSize: 12, letterSpacing: ".4em", padding: "4px 16px" }}>
              管 理 後 台
            </span>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/logo.png" alt="問爽的 WenSong" style={{ display: "block", width: 200, margin: "16px auto 0" }} />
          </div>
          {error === "locked" ? (
            <p className="msg-err">嘗試次數過多，請 15 分鐘後再試</p>
          ) : error === "nopw" ? (
            /* 正式站沒設 ADMIN_PASSWORD 時後台一律不給登入，訊息要指到真正的原因 */
            <p className="msg-err">後台密碼尚未設定，請在 Zeabur 設 ADMIN_PASSWORD後再登入</p>
          ) : error ? (
            <p className="msg-err">密碼不對，再試一次</p>
          ) : null}
          <div className="field">
            <label>管理密碼</label>
            <input type="password" name="password" autoFocus required />
          </div>
          <div className="center" style={{ marginTop: 20 }}>
            <button className="btn fill" type="submit">登入</button>
          </div>
        </div>
        <div className="band" />
      </form>
    </div>
  );
}
