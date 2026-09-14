import type { Metadata } from "next";
import Link from "next/link";
import db from "@/lib/db";
import { memberEnabled } from "@/lib/member";

import { requireAdmin } from "@/lib/admin-guard";
import AdminTabs from "@/components/AdminTabs";
import PageHead from "@/components/admin/PageHead";
import FilterBar from "@/components/admin/FilterBar";
import Empty from "@/components/admin/Empty";
export const metadata: Metadata = { title: "會員名單" };
export const dynamic = "force-dynamic";

/*
 * 會員名單（2026-09-06 改版第五批）。
 *
 * 這頁有兩份不同的名單：會員（Google／LINE 登入）與新品通知訂閱名單。
 * 原本兩張表上下攤開，中間夾兩張數字磚，402 寬要捲很久才看得到第二份。
 * 現在用膠囊切（全部／會員／訂閱名單），手機一行一個人，桌機還是表格。
 * 查詢與欄位一行都沒有動。
 */

type UserRow = {
  id: number; email: string; name: string; provider: string;
  newsletter: number; created_at: string; last_login_at: string;
};
type SubRow = { id: number; email: string; name: string; source: string; created_at: string };

const PROVIDER: Record<string, string> = { google: "Google", line: "LINE" };
const LINE_ST: Record<string, string> = { bound: "已綁定", blocked: "封鎖", nofriend: "沒加好友" };

export default async function AdminMembers({
  searchParams,
}: {
  searchParams: Promise<{ seg?: string; q?: string; nu?: string; ns?: string }>;
}) {
  await requireAdmin();
  const { seg = "all", q, nu: nuRaw, ns: nsRaw } = await searchParams;
  const users = db.prepare("SELECT id,email,name,provider,newsletter,created_at,last_login_at FROM users ORDER BY id DESC LIMIT 500").all() as UserRow[];
  const subs = db.prepare("SELECT id,email,name,source,created_at FROM subscribers ORDER BY id DESC LIMIT 1000").all() as SubRow[];
  const orderCount = db.prepare("SELECT COUNT(*) AS n FROM orders WHERE email=? AND status IN ('paid','shipped','done')");
  /* LINE 綁定：用 email 或會員 id 對。userId 顯示出來，站長要填測試白名單時從這裡複製 */
  const lineRows = db.prepare("SELECT line_user_id,email,user_id,status FROM line_bindings").all() as { line_user_id: string; email: string; user_id: number | null; status: string }[];
  const lineOf = (u: { id: number; email: string }) => lineRows.find((r) => r.user_id === u.id || (u.email && r.email === u.email.toLowerCase()));

  /* 搜尋一把尺兩份名單都吃：站長要找的是「這個人在不在名單裡」，不是「他在哪一張表裡」 */
  const kw = String(q || "").trim().toLowerCase();
  const hit = (e: string, n: string) => !kw || String(e || "").toLowerCase().includes(kw) || String(n || "").toLowerCase().includes(kw);
  const userList = users.filter((u) => hit(u.email, u.name));
  const subList = subs.filter((s) => hit(s.email, s.name));
  const showUsers = seg === "all" || seg === "users";
  const showSubs = seg === "all" || seg === "subs";

  /*
   * 一次只顯示 10 位（2026-09-07，站長說「太多了」）。
   *
   * 用網址參數而不是 client 元件：這頁是 server component，名單是查出來就定案的陣列，
   * 「顯示更多」只是換一個數字重畫一次。做成 client 元件要把幾百筆資料序列化送到瀏覽器，
   * 沒有 JS 就整份看不到，也多一個檔要維護。用連結的話沒有 JS 照樣能用。
   *
   * 手機的 .ad-rows 與桌機的表格吃同一個 slice，不會出現「手機 10 筆桌機 500 筆」。
   * 筆數與剩餘數都算在「篩選後」的陣列上：搜尋中說「還有 137 位」卻是全站數字，
   * 那個數字會騙人。切換膠囊或重新搜尋時網址不帶 nu／ns，等於自動回到 10 筆。
   */
  const FIRST = 10, STEP = 20;
  const clampShown = (raw: string | undefined) => Math.max(FIRST, Number(raw) || FIRST);
  const nu = clampShown(nuRaw), ns = clampShown(nsRaw);
  const userShown = userList.slice(0, nu);
  const subShown = subList.slice(0, ns);

  const hrefFor = (k: string) => {
    const p = new URLSearchParams();
    if (k !== "all") p.set("seg", k);
    if (q) p.set("q", String(q));
    const s = p.toString();
    return s ? `/admin/members?${s}` : "/admin/members";
  };

  /* 「顯示更多」的連結：把目前的膠囊、搜尋字與另一份名單已展開的筆數一起帶著走 */
  const moreHref = (key: "nu" | "ns", value: number) => {
    const p = new URLSearchParams();
    if (seg !== "all") p.set("seg", seg);
    if (q) p.set("q", String(q));
    if (key === "nu") { p.set("nu", String(value)); if (ns > FIRST) p.set("ns", String(ns)); }
    else { p.set("ns", String(value)); if (nu > FIRST) p.set("nu", String(nu)); }
    return `/admin/members?${p.toString()}`;
  };

  return (
    <>
      <AdminTabs active="members" tabs={[
        { key: "leads", label: "名單總覽", href: "/admin/leads" },
        { key: "members", label: "會員名單", href: "/admin/members" },
        { key: "mail", label: "發送", href: "/admin/mail" },
        { key: "newsletter", label: "電子報", href: "/admin/newsletter" },
        { key: "sms", label: "簡訊", href: "/admin/sms" },
        { key: "line", label: "LINE", href: "/admin/line" },
      ]} />
      <PageHead
        title="會 員 名 單"
        sub={<>{users.length} 位會員，{subs.length} 筆新品通知訂閱。贊助紀錄另在贊助頁，不與會員綁定</>}
      />

      {!memberEnabled() && (
        <p className="fine">
          會員登入尚未啟用：設定環境變數 GOOGLE_CLIENT_ID／GOOGLE_CLIENT_SECRET 或 LINE_CHANNEL_ID／LINE_CHANNEL_SECRET 後，
          前台會自動出現「會員」入口。訂閱名單不受影響，結帳勾選就會進來。
        </p>
      )}

      <FilterBar
        chips={[
          { label: "全部", href: hrefFor("all"), on: seg === "all" },
          { label: `會員 ${userList.length}`, href: hrefFor("users"), on: seg === "users" },
          { label: `訂閱名單 ${subList.length}`, href: hrefFor("subs"), on: seg === "subs" },
        ]}
        search={{
          action: "/admin/members",
          name: "q",
          defaultValue: q || "",
          placeholder: "搜信箱或名稱",
          hidden: seg === "all" ? {} : { seg },
        }}
      />

      {showUsers && (
        <>
          <div className="ad-sect"><h2>會 員</h2><div className="rule" /></div>
          {userList.length === 0 ? (
            <Empty>{kw ? "沒有符合的會員。" : "還沒有會員。"}</Empty>
          ) : (
            <>
              {/* 手機：一行一位。左邊名字與登入方式，右邊信箱與訂單數／LINE 狀態 */}
              <div className="ad-rows">
                {userShown.map((u) => {
                  const b = lineOf(u);
                  const n = u.email ? (orderCount.get(u.email) as { n: number }).n : 0;
                  return (
                    <div className="ad-row person" key={u.id}>
                      <span className="ad-l">
                        <span className="ad-nm">{u.name || "（沒有留名字）"}<span className="no">　{PROVIDER[u.provider] || u.provider}</span></span>
                        <span className="ad-tm sans">{u.created_at.slice(0, 10)} 加入</span>
                      </span>
                      <span className="ad-r">
                        <span className="ad-em sans">{u.email || "（未留 Email）"}</span>
                        <span className="ad-tag">
                          {n} 筆訂單{u.newsletter ? "・訂電子報" : ""}{b ? `・LINE ${LINE_ST[b.status] || b.status}` : ""}
                        </span>
                      </span>
                    </div>
                  );
                })}
              </div>
              <div className="ad-tablebox">
                <div className="adm-table-wrap">
                  <table className="adm-table">
                    <thead>
                      <tr><th>Email</th><th>名稱</th><th>登入方式</th><th>訂閱</th><th>LINE 通知</th><th>訂單數</th><th>加入時間</th></tr>
                    </thead>
                    <tbody>
                      {userShown.map((u) => {
                        const b = lineOf(u);
                        return (
                          <tr key={u.id}>
                            <td data-label="Email" className="brk">{u.email || "（未留 Email）"}</td>
                            <td data-label="名稱">{u.name}</td>
                            <td data-label="登入方式">{PROVIDER[u.provider] || u.provider}</td>
                            <td data-label="訂閱">{u.newsletter ? "有" : ""}</td>
                            <td data-label="LINE 通知">
                              {b ? <span title={b.line_user_id}>{LINE_ST[b.status] || b.status}<span className="sub2 sans">{b.line_user_id}</span></span> : ""}
                            </td>
                            <td data-label="訂單數" className="num">{u.email ? (orderCount.get(u.email) as { n: number }).n : 0}</td>
                            <td data-label="加入時間">{u.created_at.slice(0, 10)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
              {userList.length > nu && (
                <div className="ad-morerow">
                  <Link className="btn" href={moreHref("nu", nu + STEP)}>顯示更多（還有 {userList.length - nu} 位）</Link>
                </div>
              )}
            </>
          )}
        </>
      )}

      {showSubs && (
        <>
          <div className="ad-sect"><h2>新 品 通 知 訂 閱 名 單</h2><div className="rule" /></div>
          {subList.length === 0 ? (
            <Empty>{kw ? "沒有符合的訂閱者。" : "還沒有訂閱者。結帳頁與會員中心的勾選會進到這裡。"}</Empty>
          ) : (
            <>
              <div className="ad-rows">
                {subShown.map((s) => (
                  <div className="ad-row person" key={s.id}>
                    <span className="ad-l">
                      <span className="ad-nm">{s.name || "（沒有留名字）"}<span className="no">　{s.source}</span></span>
                      <span className="ad-tm sans">{s.created_at.slice(0, 10)} 訂閱</span>
                    </span>
                    <span className="ad-r"><span className="ad-em sans">{s.email}</span></span>
                  </div>
                ))}
              </div>
              <div className="ad-tablebox">
                <div className="adm-table-wrap">
                  <table className="adm-table">
                    <thead><tr><th>Email</th><th>名稱</th><th>來源</th><th>訂閱時間</th></tr></thead>
                    <tbody>
                      {subShown.map((s) => (
                        <tr key={s.id}>
                          <td data-label="Email" className="brk">{s.email}</td>
                          <td data-label="名稱">{s.name}</td>
                          <td data-label="來源">{s.source}</td>
                          <td data-label="訂閱時間">{s.created_at.slice(0, 10)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
              {subList.length > ns && (
                <div className="ad-morerow">
                  <Link className="btn" href={moreHref("ns", ns + STEP)}>顯示更多（還有 {subList.length - ns} 筆）</Link>
                </div>
              )}
            </>
          )}
        </>
      )}

      {/* 頁尾工具區（ia.md §4）：匯出收起來 */}
      <details className="ad-tools">
        <summary>工具（匯出 Excel）</summary>
        <div className="in">
          <div className="btnrow">
            <a className="btn" href="/api/admin/subscribers-csv">匯出訂閱名單 Excel</a>
          </div>
          <p className="fine">
            匯出的是全部訂閱名單（不受上面的膠囊與搜尋影響）。要匯入名單請到「電子報」那一頁，
            那裡接的是 ManyChat 的 Google 試算表。
          </p>
        </div>
      </details>
    </>
  );
}
