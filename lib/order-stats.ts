import db from "./db";

/*
 * 訂單儀表板的數字。跟贊助頁那組卡片對齊，讓兩邊看起來是同一套系統。
 *
 * 贈品單（站長自己送人的）一律不算：訂單數、盒數、營收都排除。
 * 那三個數字是拿來判斷檔期做得怎麼樣的，混進公關單只會看不清楚。
 * 「待出貨」是例外，那是「還有幾筆要出貨」的操作數字，贈品照樣要出，所以算進去。
 *
 * 「實收」的定義：只算已付款、已出貨、已完成，不含待付款與已取消。
 * 待付款的錢還沒進來，算進去會讓你以為賺得比實際多；
 * 已取消的更不能算，那筆錢從來沒存在過。
 */

export type OrderStat = { orders: number; revenue: number; addon: number; boxes: number };

function statsBetween(fromIso: string, toIso: string): OrderStat {
  const r = db
    .prepare(
      `SELECT COUNT(*) n, COALESCE(SUM(total),0) rev, COALESCE(SUM(addon_amount),0) addon
       FROM orders
       WHERE status IN ('paid','shipped','done') AND COALESCE(gift,0)=0
         AND created_at>=? AND created_at<?`
    )
    .get(fromIso, toIso) as { n: number; rev: number; addon: number };

  /* 盒數要拆 items 才算得出來，SUM 不到。只算真的有商品的列（id>0）。 */
  const rows = db
    .prepare(
      `SELECT items FROM orders
       WHERE status IN ('paid','shipped','done') AND COALESCE(gift,0)=0
         AND created_at>=? AND created_at<?`
    )
    .all(fromIso, toIso) as { items: string }[];
  let boxes = 0;
  for (const row of rows) {
    try {
      for (const it of JSON.parse(row.items || "[]") as { id: number; qty: number }[]) {
        if (Number(it.id) > 0) boxes += Number(it.qty) || 0;
      }
    } catch { /* 單一筆解析失敗不該讓整個儀表板掛掉 */ }
  }
  return { orders: r.n, revenue: r.rev, addon: r.addon, boxes };
}

export function orderStats() {
  /* 用台灣時間切月，否則每月一號凌晨的訂單會被算到上個月 */
  const tw = new Date(Date.now() + 8 * 3600 * 1000);
  const y = tw.getUTCFullYear();
  const m = tw.getUTCMonth();
  const iso = (yy: number, mm: number) => new Date(Date.UTC(yy, mm, 1) - 8 * 3600 * 1000).toISOString();

  const thisMonth = statsBetween(iso(y, m), iso(y, m + 1));
  const lastMonth = statsBetween(iso(y, m - 1), iso(y, m));
  const all = statsBetween("1970-01-01", "9999-12-31");

  /* 待處理的兩個數字：待付款要盯（ATM 會過期），待出貨要動 */
  const pending = db
    .prepare("SELECT COUNT(*) n, COALESCE(SUM(total),0) t FROM orders WHERE status='pending'")
    .get() as { n: number; t: number };
  const toShip = db.prepare("SELECT COUNT(*) n FROM orders WHERE status='paid'").get() as { n: number };

  return { thisMonth, lastMonth, all, pending, toShip };
}
