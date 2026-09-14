/*
 * 訂購人與收件人的統一顯示規則。
 *
 * 站規：結帳時「訂購人」跟「收件人」可以分開，也可以相同。
 * orders.recipient_name／recipient_phone 留空＝同訂購人，這是唯一的判斷依據，
 * 全站只有這一套規則，其他地方一律呼叫這支，不各自判斷（字串旗標各自判斷
 * 這個站已經出過三次事了，見 lib/multi-ship.ts 的說明）。
 *
 * 純函式，不 import db：舊訂單（沒有 recipient_name／recipient_phone 兩個欄位）
 * 一樣要能正確 fallback 成訂購人本人，不是只對新訂單有效。
 */

export type RecipientSource = {
  name: string;
  phone?: string | null;
  recipient_name?: string | null;
  recipient_phone?: string | null;
};

export type Recipient = {
  name: string;
  phone: string;
  /* true＝收件人欄位是空的，顯示的就是訂購人本人 */
  sameAsBuyer: boolean;
};

export function recipientOf(o: RecipientSource): Recipient {
  const rn = String(o.recipient_name || "").trim();
  const sameAsBuyer = !rn;
  return {
    name: sameAsBuyer ? o.name : rn,
    /* 電話理論上跟姓名一起填，但防呆一下：只有姓名沒有電話時退回訂購人電話 */
    phone: sameAsBuyer ? String(o.phone || "") : String(o.recipient_phone || "").trim() || String(o.phone || ""),
    sameAsBuyer,
  };
}
