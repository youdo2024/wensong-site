import db from "./db";
import { contactQueue, suspectPaidOrders } from "./contact-queue";
import { parseChoiceExpiry } from "./choice-split";
import { taipeiYMD } from "./month";

/*
 * 後台的「今天要做什麼」數字。總覽行動卡、側欄徽章、手機底部列三處共用，
 * 算一次傳到底，不讓三個地方各養一套定義然後對不上。
 */
export type AdminTodo = {
  toShip: number;      /* 已付款、還有品項沒出的訂單數 */
  contact: number;     /* 待聯絡佇列 */
  suspect: number;     /* 可能有錢沒收到 */
  lateWeeks: number;   /* 過了下架日仍有未出品項的訂單數（有填日期的週才算得出來） */
  attention: number;   /* 要站長處理、還沒進訂單列表看過的單：待付款、付款失敗被取消（站長 2026-09-03） */
};

/*
 * 「要我處理」的訂單數。總覽鈴鐺與底部列「訂單」徽章共用這一個定義。
 * 以前徽章算的是待出貨＋待聯絡＋可疑款項，待出貨一累積就變成 289 這種沒人看的數字；
 * 站長要的是只看待付款與付款失敗，出貨的事看總覽的卡就好。
 */
export function ordersNeedingAttention(): number {
  return (db.prepare(`SELECT COUNT(*) n FROM orders WHERE admin_seen=0 AND COALESCE(gift,0)=0 AND (
      status='pending'
      OR (status='cancelled' AND (pay_note LIKE '%付款未完成%' OR pay_note LIKE '%付款失敗%' OR pay_note LIKE '%授權失敗%' OR pay_note LIKE '%請款失敗%') AND pay_note NOT LIKE '%後續已由%')
    )`).get() as { n: number }).n;
}

export function adminTodo(): AdminTodo {
  const today = taipeiYMD().iso;
  const expiryQ = db.prepare("SELECT choice_expiry FROM products WHERE id=?");
  const rows = db.prepare("SELECT items FROM orders WHERE status='paid'").all() as { items: string }[];
  let toShip = 0;
  let lateWeeks = 0;
  for (const r of rows) {
    try {
      const items = JSON.parse(r.items || "[]") as { id: number; choice: string | null; shipped?: number }[];
      const unshipped = items.filter((it) => !it.shipped);
      if (unshipped.length === 0) continue;
      toShip += 1;
      const late = unshipped.some((it) => {
        if (!it.choice) return false;
        const exp = parseChoiceExpiry((expiryQ.get(Number(it.id)) as { choice_expiry?: string } | undefined)?.choice_expiry);
        const d = exp[it.choice];
        return Boolean(d && today > d);
      });
      if (late) lateWeeks += 1;
    } catch { /* 壞資料跳過，數字寧少勿錯 */ }
  }
  let contact = 0;
  let suspect = 0;
  try { contact = contactQueue().length; } catch { contact = 0; }
  try { suspect = suspectPaidOrders().length; } catch { suspect = 0; }
  let attention = 0;
  try { attention = ordersNeedingAttention(); } catch { attention = 0; }
  return { toShip, contact, suspect, lateWeeks, attention };
}
