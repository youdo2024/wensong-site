import type { Metadata } from "next";
import Link from "next/link";
import db from "@/lib/db";
import { requireAdmin } from "@/lib/admin-guard";
import AdminTabs from "@/components/AdminTabs";
import { audienceCount } from "@/lib/newsletter";
import { newsleopardEnabled } from "@/lib/newsleopard";
import { fmtDateTimeDash } from "@/lib/format";
import { readSyncState, sheetCsvUrl, syncSummary } from "@/lib/subscriber-import";
import { importSubscribers, saveSheetUrl, syncSheetNow } from "@/app/admin/actions";
import PageHead from "@/components/admin/PageHead";
import Empty from "@/components/admin/Empty";
import { newsletterStatus } from "@/components/admin/list-fmt";

export const metadata: Metadata = { title: "電子報" };
export const dynamic = "force-dynamic";

/*
 * 電子報列表（2026-09-06 改版第六批）。
 *
 * 「寫一封新的」是頁首那顆主動作。
 *
 * 匯入訂閱名單原本在這頁最下面的 <details> 工具區（09-06 那批收進去的），
 * 2026-09-07 站長說找不到，搬回清單上面。理由寫在下面那段註解。
 */

export default async function NewsletterList({
  searchParams,
}: {
  searchParams: Promise<{ imported?: string; err?: string }>;
}) {
  await requireAdmin();
  const sp = await searchParams;
  const rows = db
    .prepare(
      `SELECT n.*,
              (SELECT COUNT(*) FROM newsletter_sends s WHERE s.newsletter_id=n.id) total,
              (SELECT COUNT(*) FROM newsletter_sends s WHERE s.newsletter_id=n.id AND s.status='sent') sent
       FROM newsletters n ORDER BY n.id DESC LIMIT 100`
    )
    .all() as { id: number; subject: string; status: string; created_at: string; total: number; sent: number }[];

  const drafts = rows.filter((r) => r.status === "draft").length;
  /* 匯入區要用的兩件事：有沒有設試算表網址、上一次同步的結果 */
  const sheetUrl = sheetCsvUrl();
  const sync = readSyncState();
  const canSend = newsleopardEnabled();

  return (
    <>
      <AdminTabs active="newsletter" tabs={[
        { key: "leads", label: "名單總覽", href: "/admin/leads" },
        { key: "members", label: "會員名單", href: "/admin/members" },
        { key: "mail", label: "發送", href: "/admin/mail" },
        { key: "newsletter", label: "電子報", href: "/admin/newsletter" },
        { key: "sms", label: "簡訊", href: "/admin/sms" },
        { key: "line", label: "LINE", href: "/admin/line" },
      ]} />

      <PageHead
        title="電 子 報"
        sub={<>{rows.length} 封{drafts > 0 && <>（{drafts} 封草稿）</>}，目前可寄給 {audienceCount()} 位訂閱者（已排除退訂與寄不到的信箱）</>}
        action={<Link className="btn fill" href="/admin/newsletter/new">寫一封新的</Link>}
      />

      {sp.imported && <p className="msg-ok">{sp.imported}</p>}
      {sp.err && <p className="msg-err">{sp.err}</p>}
      {!canSend && <p className="msg-err">電子豹尚未設定，現在還不能寄。</p>}

      {/*
        * 匯入訂閱名單搬回清單上面（2026-09-07）。
        *
        * 09-06 那一批照 ia.md §4 把它收進頁尾的 <details>，理由是「一個月用不到一次」。
        * 實際上站長就是找不到它：收起來的抽屜在手機要捲到底、還要多按一下才展開，
        * 而他要用的時候是「現在就想把名單灌進來」。用得少不等於藏得起來，
        * 少用的東西藏起來只會變成沒人知道它存在。所以搬回上面，並且把上次同步的
        * 結果直接印出來，他不用點開任何東西就知道名單有沒有在進來。
        */}
      <div className="ad-part">
        <div className="ad-sect"><h2>匯 入 訂 閱 名 單</h2><div className="rule" /></div>
        <p className="fine">
          ManyChat 收到的名單。<b>退訂過的人不會被加回來</b>：那張表是累積的，
          每次同步都把退訂的人加回去，他會一直收信一直退訂，最後按「檢舉為垃圾郵件」，
          那一下傷的是整個網域，連訂單確認信都會開始進垃圾桶。
        </p>

        <p className={sync.error ? "msg-err" : "ad-listnote"}>{syncSummary(sync, fmtDateTimeDash)}</p>

        <form className="adm-form" action={saveSheetUrl}>
          <div className="field">
            <label>Google 試算表的 CSV 網址（試算表 → 檔案 → 共用 → 發布到網路 → 選 CSV）</label>
            <input type="text" name="sheet_url" defaultValue={sheetUrl} placeholder="https://docs.google.com/spreadsheets/d/e/.../pub?output=csv" />
          </div>
          <div className="adm-actions"><button className="btn" type="submit">儲存網址</button></div>
        </form>

        {sheetUrl && (
          <form action={syncSheetNow} className="ad-mt">
            <button className="btn fill" type="submit">立即從試算表同步</button>
          </form>
        )}

        <form className="adm-form" action={importSubscribers}>
          <div className="field">
            <label>或直接貼上（從試算表複製一整欄貼進來就好，格式不拘）</label>
            <textarea name="emails" placeholder="a@example.com&#10;b@example.com" />
          </div>
          <div className="adm-actions"><button className="btn" type="submit">匯入</button></div>
        </form>
      </div>

      <div className="ad-sect"><h2>電 子 報 清 單</h2><div className="rule" /></div>

      {rows.length === 0 ? (
        <Empty>還沒有電子報。按右上角「寫一封新的」開第一封。</Empty>
      ) : (
        <>
          {/* 手機：一行一封，整行點進去編輯或看進度 */}
          <div className="ad-rows">
            {rows.map((r) => (
              <Link className="ad-row" key={r.id} href={`/admin/newsletter/${r.id}`} data-tone={newsletterStatus(r.status)[1]}>
                <span className="ad-l">
                  <span className="ad-nm">{r.subject}</span>
                  <span className="ad-tm sans">{fmtDateTimeDash(r.created_at)}</span>
                </span>
                <span className="ad-r">
                  <span className="ad-amt sans">{r.total ? `${r.sent} / ${r.total}` : "—"}</span>
                  <span className="ad-st2"><i />{newsletterStatus(r.status)[0]}</span>
                </span>
              </Link>
            ))}
          </div>
          <p className="ad-listnote">右邊的數字是「已寄／總收件人」。整行可點進去。</p>
        </>
      )}

      <div className="ad-tablebox">
        <div className="adm-table-wrap">
          <table className="adm-table">
            <thead>
              <tr><th>主旨</th><th>狀態</th><th>寄送</th><th>建立時間</th></tr>
            </thead>
            <tbody>
              {rows.length === 0 && <tr><td colSpan={4} className="empty">還沒有電子報</td></tr>}
              {rows.map((r) => (
                <tr key={r.id}>
                  <td data-label="主旨"><Link href={`/admin/newsletter/${r.id}`}>{r.subject}</Link></td>
                  <td data-label="狀態">
                    <span className="ad-st" data-tone={newsletterStatus(r.status)[1]}><i />{newsletterStatus(r.status)[0]}</span>
                  </td>
                  <td data-label="寄送" className="sans">{r.total ? `${r.sent} / ${r.total}` : "—"}</td>
                  <td data-label="建立時間" className="sans">{fmtDateTimeDash(r.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

    </>
  );
}
