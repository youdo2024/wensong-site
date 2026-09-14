import type { Metadata } from "next";
import { requireAdmin } from "@/lib/admin-guard";
import { settlement } from "@/lib/settlement";
import { money } from "@/lib/format";
import { taipeiYMD } from "@/lib/month";
import AdminTabs from "@/components/AdminTabs";
import PageHead from "@/components/admin/PageHead";

export const metadata: Metadata = { title: "結算報表" };
export const dynamic = "force-dynamic";

/*
 * 夥伴月結報表（2026-09-06 改版第六批）。
 *
 * 這一頁刻意保留寬表格（.adm-table.wide）：十三欄數字要對得齊，
 * 換成手機一行一筆會把「銷售額、運費收入、運費成本、損益」拆到四行，
 * 對帳的人要的是同一列橫著比，拆開就對不出來了。
 * 改的只有外框（收進 .ad-tablebox）、顏色（改成語意色 class）與篩選列的長相。
 *
 * 金額只有站長看得到；夥伴工作台只顯示份數，這是拷問時定的界線。
 * 加購支持是參考欄：錢歸站長，不進拆帳（文案本來就寫「額外支持問爽的」）。
 */
export default async function SettlementPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  await requireAdmin();
  const sp = await searchParams;
  const today = taipeiYMD().iso;                       /* YYYY-MM-DD */
  const monthStart = `${today.slice(0, 7)}-01`;
  const from = /^\d{4}-\d{2}-\d{2}$/.test(sp.from || "") ? sp.from! : monthStart;
  const to = /^\d{4}-\d{2}-\d{2}$/.test(sp.to || "") ? sp.to! : today;
  /* created_at 存 UTC ISO：台北自然日換成 UTC 邊界（-8h）再比 */
  const utcFrom = new Date(`${from}T00:00:00+08:00`).toISOString();
  const utcTo = new Date(new Date(`${to}T00:00:00+08:00`).getTime() + 24 * 3600 * 1000).toISOString();
  const rows = settlement(utcFrom, utcTo);
  const sum = rows.reduce(
    (s, r) => ({
      sales: s.sales + r.sales, units: s.units + r.units, freight: s.freight + r.freight, addon: s.addon + r.addonRef,
      orders: s.orders + r.orderCount, home: s.home + r.parcelHome, cvs: s.cvs + r.parcelCvs, cold: s.cold + r.parcelCold,
      coldCvs: s.coldCvs + r.parcelColdCvs, cost: s.cost + r.freightCost,
    }),
    { sales: 0, units: 0, freight: 0, addon: 0, orders: 0, home: 0, cvs: 0, cold: 0, coldCvs: 0, cost: 0 }
  );

  /* 快捷區間：月結時 95% 的情境就這兩顆 */
  const ym = today.slice(0, 7);
  const prevEnd = new Date(new Date(`${ym}-01T00:00:00+08:00`).getTime() - 24 * 3600 * 1000).toISOString().slice(0, 10);
  const prevYm = prevEnd.slice(0, 7);
  const thisMonth = { from: monthStart, to: today };
  const lastMonth = { from: `${prevYm}-01`, to: prevEnd };
  const onRange = (r: { from: string; to: string }) => from === r.from && to === r.to;

  /* 運費損益：負數是這期免運政策讓站長貼了錢，用朱紅；正數用茶墨（靛藍已從後台拿掉） */
  const profitClass = (v: number) => (v < 0 ? "tone-fail ad-pos" : "ad-pos");

  return (
    <>
      <AdminTabs active="settlement" tabs={[
        { key: "partners", label: "夥伴管理", href: "/admin/partners" },
        { key: "settlement", label: "結算報表", href: "/admin/settlement" },
        { key: "workbench", label: "開出貨總覽", href: "/partner", blank: true },
      ]} />

      <PageHead
        title="結 算 報 表"
        sub={<>{from} 到 {to}，{rows.length} 位夥伴有單。照這張表對帳發放</>}
      />

      {/* 篩選列：兩顆快捷膠囊在上、自訂區間在下，跟其他列表頁同一個位置 */}
      <div className="ad-filter">
        <div className="chips">
          <a className={`chip${onRange(thisMonth) ? " on" : ""}`} href={`/admin/settlement?from=${thisMonth.from}&to=${thisMonth.to}`}>本月</a>
          <a className={`chip${onRange(lastMonth) ? " on" : ""}`} href={`/admin/settlement?from=${lastMonth.from}&to=${lastMonth.to}`}>上月</a>
        </div>
        <form method="get" className="ad-frow ad-mt">
          <div className="field f-md">
            <label>起（含當日）</label>
            <input className="sans" type="date" name="from" defaultValue={from} />
          </div>
          <div className="field f-md">
            <label>迄（含當日）</label>
            <input className="sans" type="date" name="to" defaultValue={to} />
          </div>
          <button className="btn" type="submit">查詢</button>
        </form>
      </div>

      <p className="fine">
        四種包裹數是實際寄出的件數（一個出貨地×溫層＝一件）。
        <b>運費成本</b>是你要付出去的（免運的包裹照算，因為貨照樣要寄）；
        <b>運費損益</b>＝收入減成本，負數代表這期免運政策讓你貼了錢。
        「已退款」的訂單以負項沖回。加購支持歸本店，只列參考。
      </p>

      <div className="ad-tablebox always">
        <div className="adm-table-wrap">
          <table className="adm-table wide sans">
            <thead>
              <tr>
                <th className="l">出貨夥伴</th>
                <th className="num">銷售額</th>
                <th className="num">份數</th>
                <th className="num">訂單數</th>
                <th className="num">額外贊助</th>
                <th className="num">常溫宅配</th>
                <th className="num">常溫店到店</th>
                <th className="num">冷凍宅配</th>
                <th className="num">冷凍店到店</th>
                <th className="num">運費收入</th>
                <th className="num">運費成本</th>
                <th className="num">運費損益</th>
                <th className="num">退款單</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr><td colSpan={13} className="empty">這段期間沒有訂單。</td></tr>
              )}
              {rows.map((r) => (
                <tr key={r.partnerId}>
                  <td className="l"><b>{r.partnerName}</b></td>
                  <td className={r.sales < 0 ? "num tone-fail" : "num"}>{money(r.sales)}</td>
                  <td className="num">{r.units}</td>
                  <td className="num">{r.orderCount}</td>
                  <td className={r.addonRef ? "num tone-fail" : "num tone-muted"}>{r.addonRef ? money(r.addonRef) : "—"}</td>
                  <td className="num">{r.parcelHome || "—"}</td>
                  <td className="num">{r.parcelCvs || "—"}</td>
                  <td className="num">{r.parcelCold || "—"}</td>
                  <td className="num">{r.parcelColdCvs || "—"}</td>
                  <td className="num">{money(r.freight)}</td>
                  <td className="num tone-muted">{money(r.freightCost)}</td>
                  <td className={`num ${profitClass(r.freight - r.freightCost)}`}>
                    {money(r.freight - r.freightCost)}
                  </td>
                  <td className={r.refundOrders > 0 ? "num tone-fail" : "num tone-muted"}>{r.refundOrders || "—"}</td>
                </tr>
              ))}
              {rows.length > 0 && (
                <tr className="total">
                  <td className="l"><b>合計</b></td>
                  <td className="num">{money(sum.sales)}</td>
                  <td className="num">{sum.units}</td>
                  <td className="num">{sum.orders}</td>
                  <td className="num">{sum.addon ? money(sum.addon) : "—"}</td>
                  <td className="num">{sum.home || "—"}</td>
                  <td className="num">{sum.cvs || "—"}</td>
                  <td className="num">{sum.cold || "—"}</td>
                  <td className="num">{sum.coldCvs || "—"}</td>
                  <td className="num">{money(sum.freight)}</td>
                  <td className="num">{money(sum.cost)}</td>
                  <td className={`num ${profitClass(sum.freight - sum.cost)}`}>{money(sum.freight - sum.cost)}</td>
                  <td />
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <p className="fine">
        歸屬按「商品目前的出貨夥伴」對照，換歸屬前先把當期結完。
        國稅局規定代銷結帳不得超過兩個月；結算後才發生的退款，依協議自下期貨款扣回。
      </p>

      {/* 頁尾工具區（ia.md §4）：匯出一個月按一次，收起來 */}
      <details className="ad-tools">
        <summary>工具（匯出 CSV）</summary>
        <div className="in">
          <div className="btnrow">
            <a className="btn" href={`/api/admin/settlement-csv?from=${from}&to=${to}`}>匯出這段期間的 CSV</a>
          </div>
          <p className="fine">匯出的範圍就是上面選的區間（{from} 到 {to}）。</p>
        </div>
      </details>
    </>
  );
}
