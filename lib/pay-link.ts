import crypto from "crypto";
import db, { json } from "./db";
import { parseChoiceStocks } from "./choice-stock";
import { notifyChoiceFull } from "./notify";

/*
 * 付款連結：後台先把品項、數量、價格談好配置成一條連結，對方打開就是結帳頁，
 * 自己填收件與發票資料，走站上原本的綠界／LINE Pay。訂單在對方送出的那一刻才成立。
 *
 * 兩個關鍵設計：
 *
 * 一、建立連結的當下就預扣庫存。答應人家 100 盒 8/24，那 100 盒就不該再賣給別人；
 *    否則對方走完公司請款流程才付款時，貨早就被散客買光了。預扣的量由 hold_days
 *    控制何時放回去，兩個機制互補：預扣保住量，保留天數避免死單永遠鎖著庫存。
 *
 * 二、一次性是以「訂單成立」為準，不是以「付款成功」為準。若等付款成功才失效，
 *    對方刷卡失敗後重走一次流程就會再成立一張訂單，同一批貨被鎖兩份庫存。
 *    成立後對方要重試，走的是訂單本身的免重填付款連結（/api/orders/pay）。
 */

/* id=0 代表不綁商品（純收款，例如拍片服務費），不扣庫存也不進出貨工作台 */
export type PayLinkItem = { id: number; name: string; choice: string | null; price: number; qty: number };

export type PayLinkRow = {
  id: number; token: string; title: string; items: string;
  need_address: number; pays: string; hold_days: number;
  inv_tax_id: string; inv_company: string;
  preset_name: string; preset_phone: string; preset_email: string;
  status: string; order_no: string; reserved: number;
  created_at: string; used_at: string;
};

export function payLinkItems(row: Pick<PayLinkRow, "items">): PayLinkItem[] {
  return json<PayLinkItem[]>(row.items, []).filter((i) => i && typeof i.qty === "number");
}

/* 有沒有實體商品要出貨。決定訂單付款後是「待出貨」還是直接「已完成」，
   也決定夥伴工作台看不看得到這一筆。 */
export function itemsNeedShipping(items: PayLinkItem[]): boolean {
  return items.some((i) => Number(i.id) > 0);
}

export function payLinkByToken(token: string): PayLinkRow | undefined {
  if (!token) return undefined;
  return db.prepare("SELECT * FROM pay_links WHERE token=?").get(token) as PayLinkRow | undefined;
}

export function payLinkTotal(items: PayLinkItem[]): number {
  return items.reduce((s, i) => s + Math.max(0, Math.floor(i.price)) * Math.max(0, Math.floor(i.qty)), 0);
}

/*
 * 預扣／放回綁定商品的庫存。sign=-1 扣、+1 放回。
 * 與訂單那條路共用同一組欄位（products.stock 與 products.choice_stocks），
 * 所以夥伴頁與商店頁看到的剩餘量本來就會跟著變，不需要另外扣一份。
 */
function moveStock(items: PayLinkItem[], sign: 1 | -1) {
  const bound = items.filter((i) => Number(i.id) > 0);
  if (bound.length === 0) return;
  const get = db.prepare("SELECT choice_stocks FROM products WHERE id=?");
  const setChoices = db.prepare("UPDATE products SET choice_stocks=? WHERE id=?");
  const moveTotal = db.prepare("UPDATE products SET stock = stock + ? WHERE id=?");
  const maps = new Map<number, Record<string, number>>();
  for (const it of bound) {
    moveTotal.run(sign * it.qty, it.id);
    if (!it.choice) continue;
    if (!maps.has(it.id)) {
      const row = get.get(it.id) as { choice_stocks: string } | undefined;
      if (!row) continue;
      maps.set(it.id, parseChoiceStocks(row.choice_stocks));
    }
    const m = maps.get(it.id);
    if (m && Object.prototype.hasOwnProperty.call(m, it.choice)) m[it.choice] += sign * it.qty;
  }
  for (const [id, m] of maps) setChoices.run(JSON.stringify(m), id);
}

/* 建立連結：檢查庫存夠不夠 → 預扣 → 寫入。整組在同一個交易裡，
   扣了庫存卻沒建成連結（或反過來）都是永久對不起來的帳。 */
export function createPayLink(input: {
  title: string; items: PayLinkItem[]; needAddress: boolean; pays: string[]; holdDays: number;
  invTaxId?: string; invCompany?: string; presetName?: string; presetPhone?: string; presetEmail?: string;
}): { ok: true; token: string } | { ok: false; error: string } {
  const items = input.items.filter((i) => i.qty > 0 && i.name.trim());
  if (items.length === 0) return { ok: false, error: "至少要有一個項目" };
  if (items.some((i) => i.price < 0)) return { ok: false, error: "金額不能是負數" };
  const total = payLinkTotal(items);
  /* 金流收不了 0 元，這裡就要擋掉，不要讓對方走到綠界才被打回來 */
  if (total < 1) return { ok: false, error: "總金額必須大於 0" };
  if (!input.pays.length) return { ok: false, error: "至少要開放一種付款方式" };
  /* 綁商品＝有實體貨要做要寄，卻設定成不用填地址的話，
     這批貨會進夥伴的出貨清單但沒有地址可寄。表單上有提醒，這裡直接擋死。 */
  if (!input.needAddress && items.some((i) => Number(i.id) > 0))
    return { ok: false, error: "這條連結綁了商品（有實體貨要寄），不能設定成不用填收件地址" };

  const token = crypto.randomBytes(12).toString("base64url");
  /* 這次預扣把某一週剛好扣到額滿：跟一般下單一樣要通知站長（該發限動了）。
     少了這一條，最大的那幾筆企業單反而是唯一不會觸發額滿通知的路徑。 */
  const justFilled: { productId: number; productName: string; choice: string; label: string }[] = [];
  try {
    db.transaction(() => {
      /*
       * 庫存檢查與預扣要在同一個交易內，中間不能有任何非同步。
       *
       * 累計很重要：一條連結可以把同一個商品的同一個出貨週拆成好幾列
       * （例如兩列各 3 盒）。逐列各自跟資料庫的原始數字比的話，
       * 兩列都會通過檢查，然後一起扣掉 6 盒，只剩 5 的那一週就被扣成 -1。
       * 這跟一般下單那條路踩過的坑是同一個，所以要跟它一樣先累加再比。
       */
      const takenTotal = new Map<number, number>();
      const takenChoice = new Map<string, number>();
      for (const it of items) {
        if (Number(it.id) <= 0) continue;
        const p = db.prepare("SELECT name,stock,choice_stocks FROM products WHERE id=?").get(it.id) as
          | { name: string; stock: number; choice_stocks: string }
          | undefined;
        if (!p) throw new Error(`商品不存在（id ${it.id}）`);
        const wantTotal = (takenTotal.get(it.id) || 0) + it.qty;
        if (p.stock < wantTotal) throw new Error(`「${p.name}」總庫存只剩 ${p.stock}，不夠 ${wantTotal}`);
        takenTotal.set(it.id, wantTotal);
        if (it.choice) {
          const m = parseChoiceStocks(p.choice_stocks);
          if (Object.prototype.hasOwnProperty.call(m, it.choice)) {
            const key = `${it.id}\u0000${it.choice}`;
            const want = (takenChoice.get(key) || 0) + it.qty;
            if (m[it.choice] < want)
              throw new Error(`「${p.name}」的「${it.choice}」只剩 ${m[it.choice]}，不夠 ${want}`);
            takenChoice.set(key, want);
          }
        }
      }
      moveStock(items, -1);
      for (const [key, want] of takenChoice) {
        const [pid, choice] = key.split("\u0000");
        const p = db.prepare("SELECT name,choice_stocks,soldout_label FROM products WHERE id=?").get(Number(pid)) as
          | { name: string; choice_stocks: string; soldout_label: string }
          | undefined;
        if (!p) continue;
        const left = parseChoiceStocks(p.choice_stocks)[choice];
        if (typeof left === "number" && left <= 0 && want > 0)
          justFilled.push({ productId: Number(pid), productName: p.name, choice, label: p.soldout_label || "已滿" });
      }
      db.prepare(
        `INSERT INTO pay_links (token,title,items,need_address,pays,hold_days,inv_tax_id,inv_company,
                                preset_name,preset_phone,preset_email,status,reserved,created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,'open',?,?)`
      ).run(
        token, input.title.trim(), JSON.stringify(items), input.needAddress ? 1 : 0,
        JSON.stringify(input.pays), Math.max(1, Math.floor(input.holdDays)),
        (input.invTaxId || "").trim(), (input.invCompany || "").trim(),
        (input.presetName || "").trim(), (input.presetPhone || "").trim(), (input.presetEmail || "").trim(),
        /* 完全沒綁商品的連結沒有庫存可扣，reserved 就是 0，之後也不需要釋放 */
        items.some((i) => Number(i.id) > 0) ? 1 : 0,
        new Date().toISOString()
      );
    })();
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "建立失敗" };
  }
  /* 通知放在交易之外：寄信是非同步且會失敗的，不該讓它有機會回滾庫存 */
  for (const f of justFilled) void notifyChoiceFull(f.productId, f.productName, f.choice, f.label);
  return { ok: true, token };
}

/*
 * 訂單成立時把連結標成已使用。預扣的庫存「交接」給訂單：
 * 連結不再持有（reserved=0），訂單那邊也不重複扣一次，否則同一批貨會被扣兩份。
 *
 * 用條件式 UPDATE 搶佔：對方連點兩次送出、或兩個分頁同時送出時，
 * 只有一次會贏，第二次拿到 false 就會被擋在建立訂單之前。
 */
export function claimPayLink(token: string, orderNo: string): boolean {
  const win = db
    .prepare("UPDATE pay_links SET status='used', order_no=?, used_at=?, reserved=0 WHERE token=? AND status='open'")
    .run(orderNo, new Date().toISOString(), token);
  return win.changes > 0;
}

/*
 * 保留天數到了還沒被用掉的連結：把預扣的庫存放回去。
 * 連結本身不失效（站長選擇不設有效期限），但庫存放掉之後對方再來下單，
 * 就要照當下的真實庫存重新檢查，這件事在建立訂單那條路上會做。
 */
export function releaseExpiredPayLinks(): { released: number; notes: string[] } {
  const rows = db
    .prepare("SELECT * FROM pay_links WHERE status='open' AND reserved=1")
    .all() as PayLinkRow[];
  const out = { released: 0, notes: [] as string[] };
  const now = Date.now();
  for (const r of rows) {
    const ageDays = (now - new Date(r.created_at).getTime()) / 86400000;
    if (!Number.isFinite(ageDays) || ageDays < r.hold_days) continue;
    /* 先搶再放，而且兩件事要一起成立：只改了狀態卻沒放回庫存，
       那批貨就永遠鎖著而且再也沒有人會去釋放它。 */
    let won = false;
    db.transaction(() => {
      const win = db.prepare("UPDATE pay_links SET reserved=0, status='released' WHERE id=? AND status='open' AND reserved=1").run(r.id);
      if (win.changes === 0) return;
      moveStock(payLinkItems(r), 1);
      won = true;
    })();
    if (!won) continue;
    out.released++;
    out.notes.push(`付款連結「${r.title || r.token}」保留 ${r.hold_days} 天到期，預扣的庫存已放回`);
  }
  return out;
}

/* 後台手動作廢：還沒用掉的連結收回，庫存立刻放回去 */
export function cancelPayLink(id: number): boolean {
  const r = db.prepare("SELECT * FROM pay_links WHERE id=?").get(id) as PayLinkRow | undefined;
  if (!r || r.status !== "open") return false;
  let ok = false;
  db.transaction(() => {
    const win = db.prepare("UPDATE pay_links SET status='released', reserved=0 WHERE id=? AND status='open'").run(id);
    if (win.changes === 0) return;
    if (r.reserved) moveStock(payLinkItems(r), 1);
    ok = true;
  })();
  return ok;
}

/*
 * 夥伴工作台的「已保留」：連結建好了、庫存已預扣，但對方還沒下單。
 * 夥伴看不到的話，等對方第 10 天付款才突然多出 100 盒要做，而備料早就排定了。
 * 回傳 productId → choice → 數量。
 */
export function reservedByChoice(): Map<number, Map<string, number>> {
  const rows = db.prepare("SELECT items FROM pay_links WHERE status='open' AND reserved=1").all() as { items: string }[];
  const out = new Map<number, Map<string, number>>();
  for (const r of rows) {
    for (const it of payLinkItems(r)) {
      if (Number(it.id) <= 0) continue;
      if (!out.has(it.id)) out.set(it.id, new Map());
      const m = out.get(it.id)!;
      const key = it.choice || "";
      m.set(key, (m.get(key) || 0) + it.qty);
    }
  }
  return out;
}
