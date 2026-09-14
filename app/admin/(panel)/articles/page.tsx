import type { Metadata } from "next";
import Link from "next/link";
import db from "@/lib/db";
import { fmtDate } from "@/lib/format";
import { monthRange } from "@/lib/month";
import SortButtons from "@/components/SortButtons";
import PublishToggle from "@/components/PublishToggle";
import CtaToggle from "@/components/CtaToggle";

import { requireAdmin } from "@/lib/admin-guard";
import PageHead from "@/components/admin/PageHead";
import Empty from "@/components/admin/Empty";
export const metadata: Metadata = { title: "文章管理" };

/* 前台六大區域：代號、顯示名稱、對應網址。
   這份表跟下面的瀏覽統計 2026-09-05 從總覽搬過來（ia.md §3）：
   總覽只留「本月」與「今天要處理」，瀏覽次數是內容的事，收在文章列表頁尾。 */
const PAGE_LABEL: [string, string, string][] = [
  ["home", "首 頁", "/"],
  ["articles", "文 章", "/articles"],
  ["support", "贊 助", "/support"],
  ["shop", "商 店", "/shop"],
  ["episodes", "集 數", "/ep"],
  ["guests", "來 賓", "/guests"],
];

/*
 * 文章列表（2026-09-06 改版第六批）。
 *
 * 手機一行一篇：標題可點進編輯、分類與日期在旁邊、右邊是觀看數與一顆發布開關。
 * 文末 CTA 兩顆開關留在桌機表格：那是「一次調一整欄」的事，
 * 手機一列擠三顆鈕誰都按不準，而卡片一列只留一個動作（站長 2026-09-05）。
 */
export default async function AdminArticles() {
  await requireAdmin();
  /* 跟前台文章列表同一套順序（前 10 照 sort 自訂、第 11 起照點擊數），後台所見即前台。
     未發布的文章不佔前 10 名額，統一排在最後。 */
  const bySort = db
    .prepare("SELECT id,slug,title,category,tags,date,published,views,COALESCE(cta_shop,1) cta_shop,COALESCE(cta_support,1) cta_support FROM articles ORDER BY sort, id")
    .all() as { id: number; slug: string; title: string; category: string; tags: string; date: string; published: number; views: number; cta_shop: number; cta_support: number }[];
  const pub = bySort.filter((a) => a.published);
  const list = [
    ...pub.slice(0, 10),
    ...pub.slice(10).sort((a, b) => (b.views || 0) - (a.views || 0)),
    ...bySort.filter((a) => !a.published),
  ];
  const totalViews = list.reduce((s, a) => s + (a.views || 0), 0);
  const drafts = list.length - pub.length;

  /* ── 各區瀏覽：本月與總累計（站長自己的瀏覽已在 /api/pv 端排除）── */
  const mr = monthRange();
  const one = (sql: string) => (db.prepare(sql).get() as { v: number }).v;
  const pvRows = db.prepare("SELECT page, ym, count FROM page_views").all() as { page: string; ym: string; count: number }[];
  /* 文章／商店／廚師另加「所有內容頁」的既有計數，代表整個區域的熱度 */
  const contentTotal: Record<string, number> = {
    articles: one("SELECT COALESCE(SUM(views),0) v FROM articles"),
    shop: one("SELECT COALESCE(SUM(views),0) v FROM products"),
    episodes: one("SELECT COALESCE(SUM(views),0) v FROM episodes"),
    guests: one("SELECT COALESCE(SUM(views),0) v FROM guests"),
  };
  const pv = (page: string) => {
    const rows = pvRows.filter((r) => r.page === page);
    return {
      month: rows.filter((r) => r.ym === mr.ym).reduce((a, r) => a + r.count, 0),
      total: rows.reduce((a, r) => a + r.count, 0) + (contentTotal[page] || 0),
    };
  };
  const pvAny = pvRows.length > 0;

  return (
    <>
      <PageHead
        title="文 章"
        sub={<>{list.length} 篇，總觀看 {totalViews.toLocaleString()} 次{drafts > 0 && <>，{drafts} 篇未發布</>}</>}
        action={<Link className="btn fill" href="/admin/articles/new">新增文章</Link>}
      />

      {list.length === 0 ? (
        <Empty>還沒有文章。按右上角「新增文章」寫第一篇。</Empty>
      ) : (
        <>
          {/* 手機：一行一篇，右邊是觀看數與唯一一顆動作（發布／隱藏） */}
          <div className="ad-rows">
            {list.map((a) => (
              <div className="ad-row withbtn" key={a.id} data-tone={a.published ? "ok" : "muted"}>
                <span className="ad-l">
                  <span className="ad-nm">
                    <Link href={`/admin/articles/${a.id}`}>{a.title}</Link>
                    <span className="no">　{a.category}</span>
                  </span>
                  <span className="ad-tm sans">{fmtDate(a.date)}</span>
                </span>
                <span className="ad-r">
                  <span className="ad-amt sans">{(a.views || 0).toLocaleString()}</span>
                  <span className="ad-rowbtn">
                    <PublishToggle table="articles" id={a.id} published={a.published === 1} onLabel="已發布" offLabel="隱藏中" />
                  </span>
                </span>
              </div>
            ))}
          </div>
          <p className="ad-listnote">右邊的數字是觀看次數。文末 CTA 的兩顆開關在表格檢視裡（按上面的「看表格」）。</p>
        </>
      )}

      <div className="ad-tablebox">
        <div className="adm-table-wrap">
          <table className="adm-table">
            <thead><tr><th>順序</th><th>標題</th><th>分類</th><th className="sans num">觀看</th><th>日期</th><th>狀態</th><th>文末 CTA</th><th></th></tr></thead>
            <tbody>
              {list.length === 0 && <tr><td colSpan={8} className="empty">還沒有文章</td></tr>}
              {list.map((a, i) => (
                <tr key={a.id}>
                  <td className="acts"><SortButtons table="articles" id={a.id} isFirst={i === 0} isLast={i === list.length - 1} /></td>
                  <td data-label="標題"><Link href={`/admin/articles/${a.id}`}>{a.title}</Link></td>
                  <td data-label="分類"><span className="badge blue">{a.category}</span></td>
                  <td data-label="觀看" className="sans num">{(a.views || 0).toLocaleString()}</td>
                  <td data-label="日期" className="sans">{fmtDate(a.date)}</td>
                  <td className="acts"><PublishToggle table="articles" id={a.id} published={a.published === 1} onLabel="已發布" offLabel="隱藏中" /></td>
                  <td className="acts"><CtaToggle id={a.id} shop={a.cta_shop !== 0} support={a.cta_support !== 0} /></td>
                  <td className="acts"><a href={`/articles/${a.slug}`} target="_blank">預覽 ↗</a></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* 各區瀏覽次數（2026-09-05 從總覽搬過來）：低頻、看一眼就好，收合放頁尾 */}
      <details className="ad-tools">
        <summary>各區瀏覽次數（本月與總累計）</summary>
        <div className="in">
          <p className="fine">
            本月＝{mr.label}（每月 1 號重新計算）・總累計＝開站至今；文章／商店／集數／來賓的總累計含所有內容頁。你自己登入後台時的瀏覽不計入。
          </p>
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
          {!pvAny && (
            <p className="fine">
              瀏覽統計從這次更新後開始累積，訪客一有人來就會出現數字。
            </p>
          )}
        </div>
      </details>
    </>
  );
}
