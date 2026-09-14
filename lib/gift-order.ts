import crypto from "crypto";
import { SEO } from "./seo";
import { checkEmail } from "./email-typo";
import db from "./db";
import { taipeiYMD } from "./month";
import { parseChoiceStocks } from "./choice-stock";
import { normalizePhone, phoneUsable } from "./phone";
import { cvsPickupText } from "./multi-ship";
import { isCvsMethod } from "./cvs";

/*
 * 贈品訂單：自己要送人的單，不收錢，但貨是真的要做、要寄。
 *
 * 設計上的三個要點：
 *
 * 一、狀態直接就是已付款。夥伴工作台的「待出貨」抓的是 status='paid'，
 *     不是這個狀態他就看不到，也就不會出貨。
 *
 * 二、不走 afterOrderPaid。那支會開發票、寄付款完成信、記 GA 購買事件，
 *     三件對贈品單來說都是錯的：他沒付錢、不開發票，而 0 元的購買事件
 *     會讓 Meta 以為某個廣告超便宜就有轉換，把預算推到錯的地方。
 *     所以這裡直接寫進資料庫，不借用那條路。
 *
 * 三、用 gift 欄位標記，不是靠訂單編號開頭去認。YG 前綴是給人看的。
 *     拿字串當旗標已經出過兩次事（「繳費帳號」比對不到商店訂單、
 *     取消標記認不出另一種寫法），同樣的錯不要犯第三次。
 *
 * 全有全無：一批裡任何一位過不了，整批都不建。半成品狀態會讓站長
 * 不確定到底建了幾筆，重貼時很容易把前面幾筆再建一次變成重複出貨。
 */

export type GiftRecipient = {
  name: string;
  phone: string;
  /*
   * 收件人自己的信箱，可留空。
   *
   * 填了：出貨通知就寄給這一位（他會知道東西寄出來了）。
   * 留空：退回站長自己的信箱——送禮常常是不希望對方事先知道的，
   *       或者根本要不到對方的信箱。原本的行為就是全部寄給站長，
   *       所以留空＝維持原樣，不會有人突然收到不該收的信。
   */
  email?: string;
  qty: number;
  shipMethod: string;
  address?: string;
  storeName?: string;
  storeNo?: string;
};

export type GiftBatch = {
  productId: number;
  choice: string;      // 出貨週，整批共用
  note: string;        // 用途備註，整批共用
  recipients: GiftRecipient[];
};

/*
 * 失敗的時候回傳的是「一整份問題清單」，不是第一個遇到的問題。
 *
 * 為什麼：站長一次貼十八位進來，如果只講「第 5 位電話錯了」，他改完再送，
 * 系統才告訴他「第 11 位沒地址」。十八位的名單要來回四五趟。
 * 一次全部講完，他一輪就能改好。
 *
 * badRows 是給介面用的：哪幾列要標紅，站長不用自己數到第幾位。
 */
export type GiftResult =
  | { ok: true; orderNos: string[] }
  | { ok: false; error: string; problems: string[]; badRows: number[] };

export function createGiftOrders(batch: GiftBatch): GiftResult {
  const list = batch.recipients || [];
  if (list.length === 0) return { ok: false, error: "至少要填一位收件人", problems: ["至少要填一位收件人"], badRows: [] };
  if (list.length > 50) return { ok: false, error: "一次最多 50 位，請分批建立", problems: ["一次最多 50 位，請分批建立"], badRows: [] };

  /* 先把格式問題全部挑出來再說，不要建到一半才發現第五位電話打錯。
     每一位都跑完，問題全部收進 problems，不中途 return。 */
  const problems: string[] = [];
  const badRows: number[] = [];
  const flag = (i: number, msg: string) => { problems.push(msg); if (!badRows.includes(i)) badRows.push(i); };

  for (let i = 0; i < list.length; i++) {
    const r = list[i];
    const nm = String(r.name || "").trim();
    const who = nm ? `第 ${i + 1} 位（${nm}）` : `第 ${i + 1} 位`;
    if (!nm) flag(i, `${who}沒有填姓名`);
    /*
     * 電話只要「看得出來是電話」就收，不再限定 09 開頭 10 碼。
     * 送禮的名單裡本來就有市話——寄到店裡、寄到公司，對方只給得出
     * 04 2235 1691 這種號碼，而那是宅配司機真的打得通的電話。
     * 詳細的判斷規則寫在 lib/phone.ts。
     */
    if (!phoneUsable(r.phone)) flag(i, `${who}的電話看不出來是電話（手機、市話都可以，至少要 7 碼數字）`);
    const qty = Math.floor(Number(r.qty));
    if (!Number.isFinite(qty) || qty < 1 || qty > 99) flag(i, `${who}的盒數要在 1 到 99 之間`);
    if (isCvsMethod(r.shipMethod)) {
      if (!String(r.storeName || "").trim() || !String(r.storeNo || "").trim())
        flag(i, `${who}選了 7-11 店到店，門市名稱與店號都要填`);
    } else if (!String(r.address || "").trim()) {
      flag(i, `${who}選了宅配，地址要填`);
    }
    /* 信箱可以不填，但填了就要是能寄到的——打錯網域的話對方永遠收不到出貨通知，
       而站長也不會知道，因為退信是退到寄件的信箱去 */
    const mail = String(r.email || "").trim();
    if (mail) {
      const err = checkEmail(mail);
      if (err) flag(i, `${who}的 Email：${err}`);
    }
  }
  if (problems.length > 0) {
    return {
      ok: false,
      error: problems.length === 1 ? problems[0] : `有 ${problems.length} 個地方要改`,
      problems,
      badRows,
    };
  }

  const p = db.prepare("SELECT id,name,price,stock,choice_stocks,option_name FROM products WHERE id=?").get(batch.productId) as
    | { id: number; name: string; price: number; stock: number; choice_stocks: string; option_name: string | null }
    | undefined;
  if (!p) return { ok: false, error: "找不到這個商品", problems: ["找不到這個商品"], badRows: [] };
  if (!String(batch.choice || "").trim()) return { ok: false, error: "請選出貨週", problems: ["請選出貨週"], badRows: [] };

  const need = list.reduce((s, r) => s + Math.floor(Number(r.qty)), 0);

  let err = "";
  const orderNos: string[] = [];
  try {
    /* 庫存檢查與扣除、編號產生、寫入，全部在同一個交易裡。
       better-sqlite3 的 transaction 是同步的，裡面不能有任何 await。 */
    db.transaction(() => {
      if (p.stock < need) { err = `「${p.name}」總庫存只剩 ${p.stock}，這批要 ${need}`; throw new Error(err); }
      const map = parseChoiceStocks(p.choice_stocks);
      const limited = Object.prototype.hasOwnProperty.call(map, batch.choice);
      if (limited && map[batch.choice] < need) {
        err = `「${batch.choice}」只剩 ${map[batch.choice]} 個位子，這批要 ${need}。要嘛改週，要嘛先去商品那邊把該週的數量加大`;
        throw new Error(err);
      }

      const ymd = taipeiYMD().short;
      const seqKey = `gift_seq_${ymd}`;
      const lastNo = (db.prepare("SELECT MAX(order_no) AS m FROM orders WHERE order_no LIKE ?").get(`YG${ymd}%`) as { m: string | null }).m;
      const markRow = db.prepare("SELECT value FROM settings WHERE key=?").get(seqKey) as { value: string } | undefined;
      let seq = Math.max(lastNo ? Number(lastNo.slice(-4)) || 0 : 0, Number(markRow?.value) || 0);
      const taken = db.prepare("SELECT 1 FROM orders WHERE order_no=?");

      const now = new Date().toISOString();
      const stamp = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 16).replace("T", " ");
      const ins = db.prepare(
        `INSERT INTO orders
         (order_no,name,phone,email,address,ship_method,pay_method,invoice_type,invoice_data,items,
          subtotal,shipping,total,status,created_at,token,gift,pay_note,addon_amount,discount_code,discount_amount)
         VALUES (?,?,?,?,?,?,?,?,?,?,0,0,0,'paid',?,?,1,?,0,'',0)`
      );

      for (const r of list) {
        const qty = Math.floor(Number(r.qty));
        seq++;
        let orderNo = `YG${ymd}${String(seq).padStart(4, "0")}`;
        for (let guard = 0; taken.get(orderNo) && guard < 10000; guard++) {
          seq++;
          orderNo = `YG${ymd}${String(seq).padStart(4, "0")}`;
        }
        const isCvs = isCvsMethod(r.shipMethod);
        const address = isCvs
          ? cvsPickupText(r.storeName, r.storeNo)
          : String(r.address).trim();
        /* 單價記 0：整張單從上到下都是 0，一眼就知道沒收錢 */
        const items = JSON.stringify([{ id: p.id, name: p.name, choice: batch.choice, price: 0, qty }]);
        ins.run(
          orderNo, String(r.name).trim(), normalizePhone(r.phone),
          (r.email || "").trim() || SEO.email, address, r.shipMethod, "贈品（不收費）", "none", "{}", items,
          now, crypto.randomBytes(12).toString("hex"),
          `（${stamp} 站長建立的贈品單）${batch.note ? ` ${batch.note}` : ""}`
        );
        orderNos.push(orderNo);
      }

      /* 編號水位立刻寫上去：即使這批後來被取消，這些號碼也算用掉了 */
      db.prepare("INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
        .run(seqKey, String(seq));

      db.prepare("UPDATE products SET stock = stock - ? WHERE id=?").run(need, p.id);
      if (limited) {
        map[batch.choice] -= need;
        db.prepare("UPDATE products SET choice_stocks=? WHERE id=?").run(JSON.stringify(map), p.id);
      }
    })();
  } catch (e) {
    const msg = err || (e instanceof Error ? e.message : "建立失敗");
    /* 庫存不足這類問題不屬於任何一列，badRows 留空，介面就不會亂標紅 */
    return { ok: false, error: msg, problems: [msg], badRows: [] };
  }
  return { ok: true, orderNos };
}
