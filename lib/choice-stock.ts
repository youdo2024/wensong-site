import db from "./db";

/*
 * 規格庫存（products.choice_stocks）：JSON 物件 {規格名: 剩餘數}。
 * 物件裡「沒有該規格的鍵」＝該規格不限量，只受總庫存（stock）管。
 * 總庫存與規格庫存是兩層上限：下單兩層都扣、訂單取消／刪除兩層都加回。
 * 規格名稱是這張表的鍵：上架後改名＝舊名的庫存記錄斷鏈、重新起算。
 */

export function parseChoiceStocks(raw: string | null | undefined): Record<string, number> {
  try {
    const o = JSON.parse(raw || "{}") as unknown;
    if (o && typeof o === "object" && !Array.isArray(o)) {
      const out: Record<string, number> = {};
      for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
        const n = Number(v);
        if (Number.isFinite(n)) out[k] = Math.floor(n);
      }
      return out;
    }
  } catch {}
  return {};
}

/* 內部共用：對訂單品項的規格庫存做加減（sign=+1 加回、-1 重新扣掉） */
function adjustChoiceStocks(itemsJson: string, sign: 1 | -1) {
  try {
    const items = JSON.parse(itemsJson) as { id: number; choice?: string | null; qty: number }[];
    const get = db.prepare("SELECT choice_stocks FROM products WHERE id=?");
    const set = db.prepare("UPDATE products SET choice_stocks=? WHERE id=?");
    const touched = new Map<number, Record<string, number>>();
    for (const it of items) {
      if (!it.choice) continue;
      if (!touched.has(it.id)) {
        const row = get.get(it.id) as { choice_stocks: string } | undefined;
        if (!row) continue;
        touched.set(it.id, parseChoiceStocks(row.choice_stocks));
      }
      const map = touched.get(it.id);
      if (map && Object.prototype.hasOwnProperty.call(map, it.choice)) {
        map[it.choice] += sign * Math.max(1, Math.floor(Number(it.qty) || 0));
      }
    }
    for (const [id, map] of touched) set.run(JSON.stringify(map), id);
  } catch (e) {
    /* 原本是空 catch：規格庫存靜靜地沒加回，總庫存卻加回了，
       兩層數字從此對不起來而且完全查不出原因。至少要留下可追的紀錄。 */
    console.error(
      `[choice-stock] 規格庫存${sign > 0 ? "回補" : "扣減"}失敗，items 無法處理`,
      itemsJson?.slice(0, 200), e
    );
  }
}

/* 訂單取消／刪除時把規格庫存加回（跟總庫存的加回一起呼叫） */
export function restoreChoiceStocks(itemsJson: string) {
  adjustChoiceStocks(itemsJson, 1);
}

/* 已取消的訂單被改回有效狀態時，重新扣掉規格庫存（updateOrder 用） */
export function deductChoiceStocks(itemsJson: string) {
  adjustChoiceStocks(itemsJson, -1);
}
