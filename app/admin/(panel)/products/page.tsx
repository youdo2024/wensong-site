import type { Metadata } from "next";
import Link from "next/link";
import db, { json } from "@/lib/db";
import { parseChoiceStocks } from "@/lib/choice-stock";
import { money } from "@/lib/format";
import SortButtons from "@/components/SortButtons";
import PublishToggle from "@/components/PublishToggle";
import NotifyToggle from "@/components/NotifyToggle";

import { requireAdmin } from "@/lib/admin-guard";
import PageHead from "@/components/admin/PageHead";
import Empty from "@/components/admin/Empty";
export const metadata: Metadata = { title: "商品管理" };

/*
 * 商品列表（2026-09-06 改版第六批）。
 *
 * 原本是一句話塞了五件事的副標，加上一張十欄的表。402 寬要橫滑兩次才看得到「上架中」。
 * 現在照 ia.md §4：手機一行一件（名稱＋分類、售價與庫存，右邊售價與一顆上下架），
 * 桌機還是那張表（順序、精選、購買通知這些一次要掃一整欄的事，表格才做得到），
 * 「最多人看」這種一週看一次的東西收進頁尾工具區。
 *
 * 為什麼手機這一列允許一顆鈕（訂單列表是一顆都不放）：
 * 上下架按錯再按一次就回來，訂單列表上那顆是催款，寄出去收不回來。
 */

export default async function AdminProducts({ searchParams }: { searchParams: Promise<{ err?: string }> }) {
  await requireAdmin();
  const { err } = await searchParams;
  const list = db
    .prepare("SELECT id,name,category,price,stock,featured,published,notify,views,option_choices,choice_stocks,soldout_label FROM products ORDER BY sort, id")
    .all() as { id: number; name: string; category: string; price: number; stock: number; featured: number; published: number; notify: number; views: number; option_choices: string; choice_stocks: string; soldout_label: string }[];
  const topProducts = [...list].filter((p) => p.views > 0).sort((a, b) => b.views - a.views).slice(0, 3);
  const onSale = list.filter((p) => p.published === 1).length;
  const outOfStock = list.filter((p) => p.stock === 0).length;

  /* 有設定規格庫存的商品，把各規格剩餘量列出來（列表與表格共用同一份判斷） */
  const stockParts = (p: (typeof list)[number]) => {
    const stocks = parseChoiceStocks(p.choice_stocks);
    return json<string[]>(p.option_choices, [])
      .filter((c) => Object.prototype.hasOwnProperty.call(stocks, c))
      .map((c) =>
        stocks[c] <= 0 ? (
          <b key={c}>{c} {p.soldout_label || "已滿"}</b>
        ) : (
          <span key={c}>{c} 剩 {stocks[c]}</span>
        )
      );
  };

  return (
    <>
      {err && <p className="msg-err">{err}</p>}

      <PageHead
        title="商 品"
        sub={<>{list.length} 件，{onSale} 件上架中{outOfStock > 0 && <>，{outOfStock} 件庫存 0</>}</>}
        action={<Link className="btn fill" href="/admin/products/new">新增商品</Link>}
      />

      <p className="fine">
        庫存 0 會顯示「補貨中」並停售（前台不顯示庫存數字）。
        下單通知預設是「整間商店都通知你」（網站設定可關），所以「購買通知」平常不用動；
        只有關掉全店通知時，它才決定要盯哪幾樣。
        夥伴的通知不歸這裡管：商品設了「出貨夥伴」，該夥伴自動收到自己商品的單。
      </p>

      {list.length === 0 ? (
        <Empty>還沒有商品。按右上角「新增商品」開第一件。</Empty>
      ) : (
        <>
          {/* 手機：一行一件。名稱可點進編輯，右邊是售價與唯一一顆動作（上下架） */}
          <div className="ad-rows">
            {list.map((p) => {
              const parts = stockParts(p);
              return (
                <div className="ad-row withbtn" key={p.id} data-tone={p.published ? "ok" : "muted"}>
                  <span className="ad-l">
                    <span className="ad-nm">
                      <Link href={`/admin/products/${p.id}`}>{p.name}</Link>
                      <span className="no">　{p.category}</span>
                    </span>
                    <span className="ad-tm sans">
                      庫存 {p.stock}
                      {p.views > 0 && <>・看過 {p.views.toLocaleString()}</>}
                      {p.featured === 1 && <>・首頁精選</>}
                    </span>
                    {parts.length > 0 && <span className="ad-stocks sans">{parts}</span>}
                  </span>
                  <span className="ad-r">
                    <span className="ad-amt sans">{money(p.price)}</span>
                    <span className="ad-rowbtn">
                      <PublishToggle table="products" id={p.id} published={p.published === 1} onLabel="上架中" offLabel="已下架" />
                    </span>
                  </span>
                </div>
              );
            })}
          </div>
          <p className="ad-listnote">點商品名進編輯；右邊那顆是上下架，按錯再按一次就回來。</p>
        </>
      )}

      {/* 桌機表格：順序、精選、購買通知這些要一次掃一整欄，只有表格做得到 */}
      <div className="ad-tablebox">
        <div className="adm-table-wrap">
          <table className="adm-table">
            <thead><tr><th>順序</th><th>商品</th><th>分類</th><th>售價</th><th>庫存</th><th className="sans num">觀看</th><th>首頁精選</th><th>購買通知</th><th>狀態</th><th>前台</th></tr></thead>
            <tbody>
              {list.length === 0 && <tr><td colSpan={10} className="empty">還沒有商品</td></tr>}
              {list.map((p, i) => {
                const parts = stockParts(p);
                return (
                  <tr key={p.id}>
                    <td className="acts"><SortButtons table="products" id={p.id} isFirst={i === 0} isLast={i === list.length - 1} /></td>
                    <td data-label="商品">
                      <Link href={`/admin/products/${p.id}`}>{p.name}</Link>
                      {parts.length > 0 && <div className="ad-stocks">{parts}</div>}
                    </td>
                    <td data-label="分類"><span className="badge blue">{p.category}</span></td>
                    <td data-label="售價" className="sans">{money(p.price)}</td>
                    <td data-label="庫存" className="sans">{p.stock === 0 ? <b className="tone-fail">0</b> : p.stock}</td>
                    <td data-label="觀看" className="sans num">{(p.views || 0).toLocaleString()}</td>
                    <td data-label="首頁精選">{p.featured ? "★" : ""}</td>
                    <td className="acts"><NotifyToggle id={p.id} notify={p.notify === 1} /></td>
                    <td className="acts"><PublishToggle table="products" id={p.id} published={p.published === 1} onLabel="上架中" offLabel="已下架" /></td>
                    {/* 看前台：未上架的商品站長也看得到（未上架預覽），開新分頁不打斷後台作業。
                        沒有這顆的話，站長要自己拼網址才能預覽新商品。 */}
                    <td className="acts">
                      <a href={`/shop/${p.id}`} target="_blank" rel="noopener" className="sans">
                        {p.published ? "看前台 ↗" : "預覽 ↗"}
                      </a>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* 頁尾工具區（ia.md §4）：排行一週看不到一次，收起來 */}
      <details className="ad-tools">
        <summary>觀看排行</summary>
        <div className="in">
          {topProducts.length === 0 ? (
            <p className="fine">還沒有人看過任何商品頁。</p>
          ) : (
            <p className="fine">最多人看：{topProducts.map((p) => `${p.name}（${p.views.toLocaleString()}）`).join("、")}</p>
          )}
        </div>
      </details>
    </>
  );
}
