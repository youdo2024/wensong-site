import type { Metadata } from "next";
import Link from "next/link";
import db, { getSetting, json } from "@/lib/db";
import { fmtDate } from "@/lib/format";
import { monthRange } from "@/lib/month";
import PublishToggle from "@/components/PublishToggle";
import { syncEpisodesNow } from "@/app/admin/actions";
import { displayTitle, epLabel, fmtDuration, type EpisodeRow } from "@/lib/episodes";
import { requireAdmin } from "@/lib/admin-guard";
import PageHead from "@/components/admin/PageHead";
import Empty from "@/components/admin/Empty";

export const metadata: Metadata = { title: "集數管理" };

const PAGE_LABEL: [string, string, string][] = [
  ["home", "首 頁", "/"],
  ["episodes", "集 數", "/ep"],
  ["guests", "來 賓", "/guests"],
  ["articles", "文 章", "/articles"],
  ["support", "支 持", "/support"],
  ["shop", "商 店", "/shop"],
];

/*
 * 集數列表：一行一集，標題可點進編輯，右邊是觀看數與發布開關。
 * 「立即同步」在右上角：從 SoundOn RSS 抓新集數，已經改過的筆記不會被洗掉（lib/episodes.ts 的分群契約）。
 */
export default async function AdminEpisodes({ searchParams }: { searchParams: Promise<{ synced?: string }> }) {
  await requireAdmin();
  const { synced } = await searchParams;
  const list = db.prepare("SELECT * FROM episodes ORDER BY pub_date DESC, id DESC").all() as EpisodeRow[];
  const totalViews = list.reduce((s, e) => s + (e.views || 0), 0);
  const drafts = list.filter((e) => !e.published).length;
  const noNotes = list.filter((e) => !e.transcript).length;
  const last = json<{ ok?: boolean; added?: number; updated?: number; total?: number; guestsAdded?: number; msg?: string; at?: string }>(getSetting("episodes_sync_last", "{}"), {});
  const guestCount = (id: number) => (db.prepare("SELECT COUNT(*) AS n FROM episode_guests WHERE episode_id=?").get(id) as { n: number }).n;

  const mr = monthRange();
  const pvRows = db.prepare("SELECT page, ym, count FROM page_views").all() as { page: string; ym: string; count: number }[];
  const one = (sql: string) => (db.prepare(sql).get() as { v: number }).v;
  const contentTotal: Record<string, number> = {
    episodes: one("SELECT COALESCE(SUM(views),0) v FROM episodes"),
    guests: one("SELECT COALESCE(SUM(views),0) v FROM guests"),
    articles: one("SELECT COALESCE(SUM(views),0) v FROM articles"),
  };
  const pv = (page: string) => {
    const rows = pvRows.filter((r) => r.page === page);
    return {
      month: rows.filter((r) => r.ym === mr.ym).reduce((a, r) => a + r.count, 0),
      total: rows.reduce((a, r) => a + r.count, 0) + (contentTotal[page] || 0),
    };
  };

  return (
    <>
      <PageHead
        title="集 數"
        sub={<>{list.length} 集，總觀看 {totalViews.toLocaleString()} 次{drafts > 0 && <>，{drafts} 集隱藏中</>}{noNotes > 0 && <>，{noNotes} 集還沒有逐字稿</>}</>}
        action={
          <form action={syncEpisodesNow}>
            <button className="btn fill" type="submit">立即同步 RSS</button>
          </form>
        }
      />
      {synced === "ok" && <p className="msg-ok">同步完成：新增 {last.added ?? 0} 集、更新 {last.updated ?? 0} 集、共 {last.total ?? 0} 集{(last.guestsAdded ?? 0) > 0 && <>，自動建了 {last.guestsAdded} 位來賓（去「來賓」補資料）</>}。</p>}
      {synced === "fail" && <p className="msg-err">同步失敗：{last.msg || "原因不明"}。RSS 網址在「設定・內容」。</p>}
      {last.at && !synced && (
        <p className="fine">上次同步：{fmtDate(String(last.at).slice(0, 10))}{last.ok === false ? `（失敗：${last.msg}）` : ""}。每天自動抓一次，新集數上架後最晚隔天出現。</p>
      )}

      {list.length === 0 ? (
        <Empty>還沒有集數。按右上角「立即同步 RSS」，27 集會在幾秒內進來。</Empty>
      ) : (
        <div className="ad-rows">
          {list.map((e) => (
            <div className="ad-row withbtn" key={e.id} data-tone={e.published ? "ok" : "muted"}>
              <span className="ad-l">
                <span className="ad-nm">
                  <Link href={`/admin/episodes/${e.id}`}>{displayTitle(e)}</Link>
                  <span className="no">　{epLabel(e.series, e.ep_no)}{e.transcript ? "" : "・無逐字稿"}{guestCount(e.id) ? `・來賓 ${guestCount(e.id)}` : ""}</span>
                </span>
                <span className="ad-tm sans">{e.pub_date ? fmtDate(e.pub_date.slice(0, 10)) : "—"}・{fmtDuration(e.duration)}</span>
              </span>
              <span className="ad-r">
                <span className="ad-amt sans">{(e.views || 0).toLocaleString()}</span>
                <span className="ad-rowbtn">
                  <PublishToggle table="episodes" id={e.id} published={e.published === 1} onLabel="已發布" offLabel="隱藏中" />
                </span>
              </span>
            </div>
          ))}
        </div>
      )}

      <details className="ad-tools">
        <summary>各區瀏覽次數（本月與總累計）</summary>
        <div className="in">
          <p className="fine">本月＝{mr.label}・總累計＝開站至今；集數／來賓／文章的總累計含所有內容頁。你自己登入後台時的瀏覽不計入。</p>
          <div className="adm-table-wrap">
            <table className="adm-table wide">
              <thead><tr><th className="l">區域</th><th className="num">本月</th><th className="num">總累計</th></tr></thead>
              <tbody>
                {PAGE_LABEL.map(([key, label, href]) => {
                  const v = pv(key);
                  return (
                    <tr key={key}>
                      <td className="l"><a href={href} target="_blank" rel="noopener">{label}</a></td>
                      <td className="sans num">{v.month.toLocaleString()}</td>
                      <td className="sans num">{v.total.toLocaleString()}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </details>
    </>
  );
}
