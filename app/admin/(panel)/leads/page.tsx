import type { Metadata } from "next";
import db from "@/lib/db";

import { requireAdmin } from "@/lib/admin-guard";
import AdminTabs from "@/components/AdminTabs";
import PageHead from "@/components/admin/PageHead";
import FilterBar from "@/components/admin/FilterBar";
import Empty from "@/components/admin/Empty";
export const metadata: Metadata = { title: "名單總覽" };

/*
 * 名單總覽：把全站留下 Email 的人集中在一處——
 * 支持（sponsorships）、投稿（submissions）、會員（users）、
 * 訂單（orders）、新品訂閱（subscribers）。同一個 Email 合併成一筆，
 * 標出全部來源與最近一次互動時間。
 *
 * 2026-09-06 改版第五批：原本上面是一排來源統計卡（每個來源一張），
 * 下面一張四欄的表。統計卡按不動、也不能拿來篩，站長要找「只有訂閱來的那些人」
 * 得自己用眼睛掃。現在改成跟訂單列表同一套：來源變成可以點的膠囊、
 * 手機一行一個人、匯出收進頁尾工具區。資料查詢一行都沒有動。
 */

type Lead = {
  email: string;
  name: string;
  sources: Set<string>;
  last: string;
  newsletterOk: boolean;
};

function collectLeads(): Lead[] {
  const map = new Map<string, Lead>();
  const add = (email: string, name: string, source: string, at: string, newsletterOk = false) => {
    const key = (email || "").trim().toLowerCase();
    if (!key || !key.includes("@")) return;
    const cur = map.get(key);
    if (cur) {
      cur.sources.add(source);
      if (!cur.name && name) cur.name = name;
      if (at > cur.last) cur.last = at;
      cur.newsletterOk = cur.newsletterOk || newsletterOk;
    } else {
      map.set(key, { email: key, name: name || "", sources: new Set([source]), last: at || "", newsletterOk });
    }
  };

  for (const r of db.prepare("SELECT email,display_name,created_at,status FROM sponsorships").all() as { email: string; display_name: string; created_at: string; status: string }[]) {
    add(r.email, r.display_name, r.status === "pending" || r.status === "failed" ? "支持（未完成）" : "支持", r.created_at);
  }
  for (const r of db.prepare("SELECT email,name,created_at,newsletter FROM users").all() as { email: string; name: string; created_at: string; newsletter: number }[]) {
    add(r.email, r.name, "會員", r.created_at, r.newsletter === 1);
  }
  for (const r of db.prepare("SELECT email,name,created_at FROM orders").all() as { email: string; name: string; created_at: string }[]) {
    add(r.email, r.name, "訂單", r.created_at);
  }
  for (const r of db.prepare("SELECT email,name,created_at,source FROM subscribers").all() as { email: string; name: string; created_at: string; source: string }[]) {
    add(r.email, r.name, `訂閱（${r.source || "網站"}）`, r.created_at, true);
  }
  return [...map.values()].sort((a, b) => (a.last < b.last ? 1 : -1));
}

/* 畫面只列這麼多筆：一次把七八千筆全部渲染出來會讓這頁在手機上開不起來 */
const SHOW = 500;

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<{ src?: string; q?: string }>;
}) {
  await requireAdmin();
  const { src = "all", q } = await searchParams;
  const all = collectLeads();
  const bySource = new Map<string, number>();
  for (const l of all) for (const s of l.sources) bySource.set(s, (bySource.get(s) || 0) + 1);
  const newsletterN = all.filter((l) => l.newsletterOk).length;

  /*
   * 篩選：來源膠囊與搜尋各管各的，切來源時搜尋字要留著。
   * 「可寄電子報」不是來源，是一個獨立的條件，但站長要的動作是同一種（先看這一群人），
   * 所以放在同一排膠囊裡，用 news 這個值跟來源分開。
   */
  const list = all.filter((l) => {
    if (src === "news" ? !l.newsletterOk : src !== "all" && !l.sources.has(src)) return false;
    const kw = String(q || "").trim().toLowerCase();
    if (!kw) return true;
    return l.email.includes(kw) || String(l.name || "").toLowerCase().includes(kw);
  });

  const hrefFor = (k: string) => {
    const p = new URLSearchParams();
    if (k !== "all") p.set("src", k);
    if (q) p.set("q", String(q));
    const s = p.toString();
    return s ? `/admin/leads?${s}` : "/admin/leads";
  };

  return (
    <>
      <AdminTabs active="leads" tabs={[
        { key: "leads", label: "名單總覽", href: "/admin/leads" },
        { key: "members", label: "會員名單", href: "/admin/members" },
        { key: "mail", label: "發送", href: "/admin/mail" },
        { key: "newsletter", label: "電子報", href: "/admin/newsletter" },
        { key: "sms", label: "簡訊", href: "/admin/sms" },
        { key: "line", label: "LINE", href: "/admin/line" },
      ]} />
      <PageHead
        title="名 單 總 覽"
        sub={<>{all.length} 位不重複，其中 {newsletterN} 位可寄電子報。同一個 Email 合併為一筆</>}
      />

      <FilterBar
        chips={[
          { label: "全部", href: hrefFor("all"), on: src === "all" },
          ...[...bySource.entries()].map(([k, n]) => ({ label: `${k} ${n}`, href: hrefFor(k), on: src === k })),
          { label: `可寄電子報 ${newsletterN}`, href: hrefFor("news"), on: src === "news" },
        ]}
        search={{
          action: "/admin/leads",
          name: "q",
          defaultValue: q || "",
          placeholder: "搜信箱或名稱",
          hidden: src === "all" ? {} : { src },
        }}
      />

      {list.length === 0 ? (
        <Empty>沒有符合的名單。換一顆膠囊或清掉搜尋字看看。</Empty>
      ) : (
        <>
          {/* 手機：一行一個人。左邊名字與來源，右邊信箱與最近互動 */}
          <div className="ad-rows">
            {list.slice(0, SHOW).map((l) => (
              <div className="ad-row person" key={l.email}>
                <span className="ad-l">
                  <span className="ad-nm">{l.name || "（沒有留名字）"}<span className="no">　{[...l.sources].join("・")}</span></span>
                  <span className="ad-tm sans">{(l.last || "").slice(0, 10) || "—"}</span>
                </span>
                <span className="ad-r">
                  <span className="ad-em sans">{l.email}</span>
                  {l.newsletterOk && <span className="ad-tag">可寄電子報</span>}
                </span>
              </div>
            ))}
          </div>
          <p className="ad-listnote">
            依使用條款第八條，這些 Email 可寄送必要通知與不定期最新消息（信中需附取消方式）。
            「訂閱」與勾過電子報的會員屬明確訂閱者，優先寄送。
            {list.length > SHOW && <>　畫面只列最近 {SHOW} 筆，完整名單請用下面的匯出。</>}
          </p>
        </>
      )}

      {/* 桌機表格；手機按「看表格」也會切到這張，兩邊同一份 list */}
      <div className="ad-tablebox">
        <div className="adm-table-wrap">
          <table className="adm-table">
            <thead><tr><th>Email</th><th>名稱</th><th>來源</th><th>最近互動</th></tr></thead>
            <tbody>
              {list.length === 0 && <tr><td colSpan={4} className="empty">沒有符合的名單</td></tr>}
              {list.slice(0, SHOW).map((l) => (
                <tr key={l.email}>
                  <td data-label="Email" className="sans brk">{l.email}</td>
                  <td data-label="名稱">{l.name || "—"}</td>
                  <td data-label="來源">{[...l.sources].join("・")}{l.newsletterOk ? "・可寄電子報" : ""}</td>
                  <td data-label="最近互動" className="sans">{(l.last || "").slice(0, 10) || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* 頁尾工具區（ia.md §4）：匯出一週用不到一次，收起來 */}
      <details className="ad-tools">
        <summary>工具（匯出 Excel）</summary>
        <div className="in">
          <div className="btnrow">
            <a className="btn" href="/api/admin/leads-csv">匯出全部名單 Excel</a>
          </div>
          <p className="fine">
            匯出的是全部 {all.length} 筆（不受上面的膠囊與搜尋影響），含來源與最近互動時間。
            要匯入名單請到「電子報」那一頁，那裡接的是 ManyChat 的 Google 試算表。
          </p>
        </div>
      </details>
    </>
  );
}
