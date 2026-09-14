import db from "./db";

/*
 * 自動取消時寫進備註的兩種標記。
 *
 * 這兩句話同時是「給人看的說明」與「給程式判斷的依據」：款項晚一步進來時，
 * 要靠它認出這筆是系統自動取消的、可以重新成立。
 * 以前備註在 reconcile.ts 手寫、判斷在 payment-sync.ts 另外寫一次，
 * 兩邊一改就對不上，而對不上的後果是錢收了、訂單停在已取消，沒有人會發現。
 * 所以定義只留這一份，兩邊都從這裡拿。
 */
export const AUTO_CANCEL_MARK = "逾期未付款，系統自動取消";
export const SUPERSEDED_MARK = "這筆是未完成的付款嘗試，系統自動取消並釋放庫存";

export function supersededNote(byOrderNo: string): string {
  return `同一位顧客後續已由 ${byOrderNo} 付款成功，${SUPERSEDED_MARK}`;
}

/* 這筆訂單是不是「系統自己取消的」。是的話款項晚到時要復原，不能默默吃掉 */
export function isAutoCancelled(payNote: string): boolean {
  const n = payNote || "";
  return n.includes(AUTO_CANCEL_MARK) || n.includes(SUPERSEDED_MARK);
}

/*
 * 已經取號的 ATM。
 *
 * 商店訂單的備註寫「ATM 轉帳：822 9251262310634192（2026/08/19 前完成）」，
 * 贊助寫「繳費帳號 ...」。原本這裡只認「繳費帳號」四個字，
 * 所以商店訂單一筆都認不出來，整個例外形同不存在。
 * 實際後果：鄭貴理那筆已經拿到虛擬帳號的訂單被當成重複付款嘗試取消掉了。
 */
function hasLiveAtm(o: { pay_method?: string; pay_note?: string }): boolean {
  const note = o.pay_note || "";
  return (o.pay_method || "").includes("ATM") || note.includes("ATM 轉帳：") || note.includes("繳費帳號");
}

/* 姓名比對前先把空白拿掉。「柯 立瀅」與「柯立瀅」是同一個人 */
function normName(s?: string): string {
  return String(s || "").replace(/\s+/g, "");
}

/*
 * 「這筆待付款其實是被後面那筆取代掉的」。
 *
 * 實際情形：同一個人刷卡沒過，於是又下了一次、再一次，最後才成功。
 * 前面那幾筆會永遠停在待付款（綠界對信用卡只有授權成功才回呼），
 * 逐筆看的話系統會對著她連寄兩封「你還沒完成付款」，
 * 但她明明已經買到了，只會以為自己其實沒買成功。
 *
 * 判準有三個條件，缺一不可：
 *
 * 一、更晚成立而且已經付款成功。先付款成功、後來又下一筆待付款的，
 *     那是真的第二筆訂單，不能算被取代。
 *
 * 二、聯絡方式對得起來：同 Email 或同電話。
 *     只比 Email 會漏掉重下單時換一個信箱的人（戴與見就是這樣，
 *     兩筆同名同電話同門市，卻因為信箱不同而沒被認出來，結果被催了一次款）。
 *
 * 三、收件人姓名一樣。這條是用來擋反方向的誤判：一個人用同一個信箱
 *     幫兩個人各訂一份，收件人與地址都不同，那是兩筆真訂單。
 *     少了這條，先下的那筆會被當成重複嘗試取消掉（鄭貴理與陳惠雅就是這樣）。
 *
 * 例外：ATM 已經取號的不算被取代。那代表對方拿到虛擬帳號、打算去轉帳，
 * 跟刷卡失敗是兩回事，就算她同一天另外刷卡買了別的東西，
 * 這筆的帳號還是要提醒她去繳，不然就是我們自己把生意做丟了。
 */
export function orderSupersededBy(o: {
  id: number;
  email: string;
  name?: string;
  phone?: string;
  pay_method?: string;
  pay_note?: string;
  gift?: number;
}): string {
  if (!o.email && !o.phone) return "";
  if (hasLiveAtm(o)) return "";
  /* 贈品單不參與重複判斷。它的信箱是站長自己的、電話是收禮的人的，
     兩邊都會誤配：拿站長的信箱去比，全站的贈品單會互相認親；
     拿收禮人的電話去比，那個人哪天自己來下單就會被當成重複而取消。 */
  if (o.gift) return "";

  /* 電話比對前去掉空白與連字號，資料裡兩種寫法都有 */
  const phone = String(o.phone || "").replace(/[\s-]/g, "");
  const rows = db
    .prepare(
      `SELECT order_no,name FROM orders
       WHERE id>? AND status IN ('paid','shipped','done') AND COALESCE(gift,0)=0
         AND ( (?<>'' AND lower(trim(email))=lower(trim(?)))
            OR (?<>'' AND replace(replace(COALESCE(phone,''),' ',''),'-','')=?) )
       ORDER BY id`
    )
    .all(o.id, o.email, o.email, phone, phone) as { order_no: string; name: string }[];

  const me = normName(o.name);
  /* 舊資料可能沒帶 name 進來，這種情況維持原本只看聯絡方式的判準，
     不要因為欄位沒填就整個失效 */
  const hit = me ? rows.find((r) => normName(r.name) === me) : rows[0];
  return hit?.order_no || "";
}
