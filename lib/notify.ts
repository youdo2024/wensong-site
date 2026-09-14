import db, { getSetting, json, setSetting } from "./db";
import { sendMail, wrapMail, wrapOwnerMail } from "./mail";
import { logMail } from "./mail-log";
import { money, ORDER_STATUS } from "./format";
import { parseChoiceStocks } from "./choice-stock";
import { recipientOf } from "./recipient";
import { isMultiShip } from "./multi-ship";

/*
 * 商品購買通知：後台勾選「通知」的商品一有人下單（即時，不等付款），
 * 寄信到「網站設定 → 訂單通知信箱」（可多個，逗號分隔），
 * 信裡是這筆訂單的明細，並附上該商品的即時統計 Excel（CSV）。
 */

type OrderRow = {
  id: number; order_no: string; name: string; phone: string; email: string;
  address: string; ship_method: string; items: string; total: number; status: string; created_at: string;
  recipient_name?: string; recipient_phone?: string;
};
type Item = { id: number; name: string; choice: string | null; price: number; qty: number };

const STATUS_LABEL: Record<string, string> = { pending: "待付款", paid: "已付款", shipped: "已出貨", done: "已完成" };

function siteBase(): string {
  return (process.env.SITE_URL || "https://www.wensong.tw").replace(/\/$/, "");
}

/* 有人投稿就通知站主：寄到「網站設定 → 站長通知信箱」（自己的信箱，跟商品訂購通知分開；
   沒設就不寄，投稿人的確認信不受影響） */
export async function notifySubmission(s: {
  name: string; penName: string; quote: string; email: string; phone: string;
  title: string; body: string; photoCount: number;
}): Promise<void> {
  try {
    const emails = getSetting("owner_notify_emails", "")
      .split(/[,，;\s]+/)
      .map((x) => x.trim())
      .filter((x) => x.includes("@"));
    if (emails.length === 0) return;

    const esc = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const excerpt = s.body.length > 300 ? `${s.body.slice(0, 300)}…` : s.body;
    const html = wrapOwnerMail(
      "有人投稿了",
      `<p style="font-size:15px;line-height:2;">〈<b>${esc(s.title)}</b>〉</p>
       <p style="font-size:13.5px;color:#8A7A6E;line-height:2;">
         全名：${esc(s.name)}${s.penName ? `　筆名：${esc(s.penName)}` : "　（沒有填筆名）"}<br>
         ${s.quote ? `報價：<b style="color:#EA962E;">${esc(s.quote)}</b>（投稿人開的價，要寄出載明金額的採用通知，契約才成立）<br>` : "報價：沒有填<br>"}
         Email：${esc(s.email)}　電話：${esc(s.phone)}<br>
         照片：${s.photoCount} 張
       </p>
       <p style="font-size:14px;line-height:2;white-space:pre-wrap;border-left:3px solid #D97F12;padding-left:12px;color:#33271F;">${esc(excerpt)}</p>
       <p style="font-size:13px;color:#8A7A6E;line-height:1.9;">到後台「投稿」可以看全文與照片。</p>`
    );
    for (const to of emails) {
      await sendMail(to, `有人投稿〈${s.title}〉｜問爽的`, html, undefined, { kind: "owner" });
    }
  } catch (e) {
    console.error("[notifySubmission]", e);
  }
}

/*
 * 發票開不出來就通知站主：寄到「網站設定 → 站長通知信箱」（跟投稿通知同一個）。
 *
 * 為什麼這封信非有不可：開立發票失敗「不會」擋住金流，錢早就收了。
 * 而失敗原因原本只會被寫進訂單備註欄的一行字，沒有人會主動去看那一行。
 * 實際的結局是客人幾天後來信問「我的發票呢」，那時候你才第一次知道這件事。
 *
 * rescuedNo 有值＝已經自動改開成寄 Email 的雲端發票（客人拿得到發票了），
 * 這種情況仍然要寄信，因為客人原本要的是載具或統編，你可能得補做點什麼。
 */
export async function notifyInvoiceFailure(x: {
  kind: "order" | "sponsor";
  ref: string;
  amount: number;
  buyerEmail: string;
  reason: string;
  /* 自動補開成功時的發票號碼 */
  rescuedNo?: string;
  /* 補開時被拿掉的欄位，寫給站長看的人話（例：手機條碼載具 /ABC1234） */
  dropped?: string;
  adminPath?: string;
}): Promise<void> {
  try {
    const emails = getSetting("owner_notify_emails", "")
      .split(/[,，;\s]+/)
      .map((v) => v.trim())
      .filter((v) => v.includes("@"));
    if (emails.length === 0) return;

    const esc = (v: string) => String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const what = x.kind === "order" ? "訂單" : "贊助";
    const rescued = Boolean(x.rescuedNo);
    const title = rescued ? `發票改開成功，但客人選的方式沒成立` : `發票開立失敗，客人沒有拿到發票`;
    const subject = rescued
      ? `［發票改開］${what} ${x.ref}｜問爽的`
      : `［發票開不出來］${what} ${x.ref}｜問爽的`;
    const link = x.adminPath ? `${siteBase()}${x.adminPath}` : "";

    const body = rescued
      ? `<p style="font-size:14.5px;line-height:2;">
           客人選的<b>${esc(x.dropped || "發票方式")}</b>光貿不接受，
           已經自動改開成寄到 Email 的雲端發票，<b>客人拿得到發票</b>，不必緊急處理。<br>
           發票號碼：<b>${esc(x.rescuedNo || "")}</b>
         </p>`
      : `<p style="font-size:14.5px;line-height:2;color:#EA962E;">
           <b>這筆的錢已經收了，但發票沒開出來。</b>自動改開也失敗了，需要你到光貿後台手動補開。
         </p>`;

    const html = wrapOwnerMail(
      title,
      `${body}
       <p style="font-size:13.5px;color:#8A7A6E;line-height:2;">
         ${what}編號：${esc(x.ref)}<br>
         金額：${money(x.amount)}<br>
         買受人 Email：${esc(x.buyerEmail)}<br>
         光貿回覆：${esc(x.reason)}
       </p>
       ${link ? `<p style="font-size:13.5px;line-height:2;"><a href="${link}">到後台看這筆 →</a></p>` : ""}`
    );
    for (const to of emails) await sendMail(to, subject, html, undefined, { kind: "owner" });
  } catch (e) {
    /* 通知失敗不能反過來影響開票流程 */
    console.error("[notifyInvoiceFailure]", e);
  }
}

/* 企業訂購諮詢通知：企業訂購頁的表單送出時通知站主。
   這是詢問不是訂單，站主要自己回信報價，所以把聯絡方式擺在最前面。 */
export async function notifyCorporateInquiry(q: {
  contactName: string; phone: string; email: string;
  qty: string; needDate: string; taxId: string; company: string;
}): Promise<void> {
  try {
    const emails = getSetting("owner_notify_emails", "")
      .split(/[,，;\s]+/)
      .map((x) => x.trim())
      .filter((x) => x.includes("@"));
    if (emails.length === 0) return;

    const esc = (v: string) => String(v || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const row = (k: string, v: string) =>
      v ? `<tr><td style="padding:5px 0;font-size:13.5px;color:#8A7A6E;white-space:nowrap;">${k}</td><td style="padding:5px 0 5px 14px;font-size:14.5px;">${esc(v)}</td></tr>` : "";
    const html = wrapOwnerMail(
      "有企業要訂購",
      `<table style="border-top:2px solid #33271F;margin-top:6px;">
         ${row("聯絡人", q.contactName)}
         ${row("電話", q.phone)}
         ${row("Email", q.email)}
         ${row("預計數量", q.qty)}
         ${row("預計到貨", q.needDate)}
         ${row("統一編號", q.taxId)}
         ${row("公司抬頭", q.company)}
       </table>
       <p style="font-size:13.5px;color:#8A7A6E;line-height:1.9;margin-top:14px;">
         回覆這封信不會寄到對方那裡，請另外寄到上面那個 Email。到後台「企業訂購」可以看全部詢問。</p>`
    );
    for (const to of emails) {
      await sendMail(to, `企業訂購詢問：${q.contactName}｜${q.qty}｜問爽的`, html, undefined, { kind: "owner" });
    }
  } catch (e) {
    console.error("[notifyCorporateInquiry]", e);
  }
}

/* 規格額滿通知：某個規格（尺寸／出貨週）的庫存被買到 0 時通知站主，
   信裡附上所有規格的剩餘現況，方便決定要不要發「已滿」限動或補庫存 */
export async function notifyChoiceFull(productId: number, productName: string, choice: string, label: string): Promise<void> {
  try {
    const emails = getSetting("owner_notify_emails", "")
      .split(/[,，;\s]+/)
      .map((x) => x.trim())
      .filter((x) => x.includes("@"));
    if (emails.length === 0) return;

    const p = db.prepare("SELECT option_name,option_choices,choice_stocks,stock FROM products WHERE id=?").get(productId) as
      | { option_name: string | null; option_choices: string; choice_stocks: string; stock: number }
      | undefined;
    const esc = (v: string) => (v || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const stocks = parseChoiceStocks(p?.choice_stocks);
    const rows = json<string[]>(p?.option_choices || "[]", [])
      .map((c) => {
        const has = Object.prototype.hasOwnProperty.call(stocks, c);
        const txt = has ? (stocks[c] <= 0 ? `<b style="color:#EA962E;">${label}</b>` : `剩 ${stocks[c]}`) : "不限量";
        return `<tr><td style="padding:4px 0;">${esc(c)}</td><td style="text-align:right;">${txt}</td></tr>`;
      })
      .join("");

    const html = wrapOwnerMail(
      `「${esc(choice)}」${esc(label)}了`,
      `<p style="font-size:15px;line-height:2;"><b>${esc(productName)}</b>的「<b style="color:#EA962E;">${esc(choice)}</b>」剛剛被買到額滿。</p>
       <table style="width:100%;border-collapse:collapse;font-size:14px;border-top:2px solid #33271F;">${rows}</table>
       <p style="font-size:13.5px;color:#8A7A6E;line-height:1.9;margin-top:10px;">
         商品總庫存還剩 ${p?.stock ?? "—"} 件。想加開名額，到後台「商品」把該${esc(p?.option_name || "規格")}的庫存改大即可；順手發個「${esc(choice)}${esc(label)}」的限動，稀缺感是真的。
       </p>`
    );
    for (const to of emails) {
      await sendMail(to, `「${choice}」${label}｜${productName}`, html, undefined, { kind: "owner" });
    }
  } catch (e) {
    console.error("[notifyChoiceFull]", e);
  }
}

/* 贊助通知：每筆贊助付款成功（單筆、定額首期、定額每期扣款、ATM 入帳）就通知站主，
   寄到「網站設定 → 站長通知信箱」（跟投稿通知同一個；沒設就不寄，不影響贊助者的信） */
export async function notifySponsorship(
  spId: number,
  kind: "once" | "monthly-first" | "monthly-charge",
  chargeAmount?: number
): Promise<void> {
  try {
    const emails = getSetting("owner_notify_emails", "")
      .split(/[,，;\s]+/)
      .map((x) => x.trim())
      .filter((x) => x.includes("@"));
    if (emails.length === 0) return;

    const sp = db
      .prepare("SELECT id,mode,amount,display_name,message,email,pay_method FROM sponsorships WHERE id=?")
      .get(spId) as {
        id: number; mode: string; amount: number; display_name: string;
        message: string; email: string; pay_method: string;
      } | undefined;
    if (!sp) return;

    const esc = (v: string) => (v || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const amount = chargeAmount || sp.amount;
    const kindLabel =
      kind === "once" ? "單次支持" : kind === "monthly-first" ? "每月支持・首期授權成功" : "每月支持・本期扣款";

    const html = wrapOwnerMail(
      "有人支持了",
      `<p style="font-size:22px;margin:0 0 6px;"><b style="color:#EA962E;">${money(amount)}</b>
         <span style="font-size:14px;color:#8A7A6E;">${kind === "once" ? "" : "／月"}</span></p>
       <p style="font-size:13.5px;color:#8A7A6E;line-height:2;">
         ${kindLabel}・${esc(sp.pay_method || "—")}<br>
         支持者：${esc(sp.display_name) || "（匿名）"}　Email：${esc(sp.email)}
       </p>
       ${sp.message ? `<p style="font-size:14px;line-height:2;white-space:pre-wrap;border-left:3px solid #D97F12;padding-left:12px;color:#33271F;">${esc(sp.message)}</p>` : ""}
       <p style="font-size:13px;color:#8A7A6E;line-height:1.9;">發票由系統自動開立；明細與發票狀態到後台「贊助紀錄」查看。</p>`
    );
    for (const to of emails) {
      await sendMail(to, `有人支持 ${money(amount)}${kind === "monthly-charge" ? "（本月扣款）" : ""}｜問爽的`, html, undefined, { kind: "owner" });
    }
  } catch (e) {
    console.error("[notifySponsorship]", e);
  }
}

/*
 * 舊繳費帳號入帳通知：綠界回呼帶的單號比對不到現行 trade_no，
 * 是靠 sponsor_trade_nos 的歷史才認出這筆贊助，代表錢打在「已經被換掉的那組單號」上。
 *
 * 為什麼非通知不可：換付款方式並不會讓綠界那組虛擬帳號失效，
 * 所以顧客先取 ATM 帳號、改刷卡、幾天後又照舊帳號轉一次，是真的會發生的事。
 * 系統這邊全自動處理完站長不會有感覺，但這兩種情況他各有一件事要做：
 *
 *   duplicate=false（贊助還是待付款）＝ 單純的晚到轉帳。錢是這筆的，已照正常流程入帳、
 *     開發票、寄感謝信，站長什麼都不用做，只是要知道「這個人走的是舊帳號」。
 *   duplicate=true（贊助已經 paid／active）＝ 重複付款。刷卡已經收過一次，又轉了一次。
 *     系統絕對不會把它再入帳一次（不能重複開發票、重複道謝，那是稅務問題），
 *     所以這筆錢會停在金流商那裡沒有對應的贊助紀錄，站長要主動退款給人家。
 *     這封信就是唯一會讓他知道的管道。
 *
 * 寄到「網站設定 → 站長通知信箱」，跟發票失敗、投稿、贊助成功同一格。
 * 整支包在 try 裡：通知寄不出去絕對不可以反過來影響金流回呼。
 */
export async function notifySponsorStaleTradeNo(x: {
  spId: number;
  mtn: string;
  amount: number;
  /* true＝已付款的贊助又收到一筆錢，要退款 */
  duplicate: boolean;
  status: string;
}): Promise<void> {
  try {
    const emails = getSetting("owner_notify_emails", "")
      .split(/[,，;\s]+/)
      .map((v) => v.trim())
      .filter((v) => v.includes("@"));
    if (emails.length === 0) return;

    const sp = db
      .prepare("SELECT id,mode,amount,display_name,email,pay_method,trade_no FROM sponsorships WHERE id=?")
      .get(x.spId) as
      | { id: number; mode: string; amount: number; display_name: string; email: string; pay_method: string; trade_no: string }
      | undefined;

    const esc = (v: unknown) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const amount = x.amount || sp?.amount || 0;
    const title = x.duplicate ? "重複付款：這筆錢要退給對方" : "有人用舊的繳費帳號付款了";
    const subject = x.duplicate
      ? `［重複付款］贊助 #${x.spId} ${money(amount)}｜問爽的`
      : `［舊帳號入帳］贊助 #${x.spId} ${money(amount)}｜問爽的`;

    const lead = x.duplicate
      ? `<p style="font-size:14.5px;line-height:2;color:#EA962E;">
           <b>從舊的繳費帳號收到一筆 ${money(amount)}，但系統沒有把它入帳。</b><br>
           這筆贊助現在的狀態是「${esc(x.status)}」，不是待付款，最常見的原因是同一個人重複付款：
           已經刷卡付過一次，後來又照舊的虛擬帳號轉了一次。<br>
           系統<b>沒有</b>再入帳一次，也沒有動這筆贊助的任何欄位：重複開發票、重複道謝比漏帳更難收拾。<br>
           要做的事：到綠界後台核對這筆款項，確認是重複付款之後，把多收的退還給對方。
         </p>`
      : `<p style="font-size:14.5px;line-height:2;">
           對方換過付款方式，但後來還是照<b>舊的那組虛擬帳號</b>轉了帳。
           綠界的虛擬帳號不會因為換方式就失效，所以這是正常會發生的事。<br>
           錢是這筆贊助的，系統已經照一般付款流程入帳、開發票、寄感謝信，<b>你不用做任何事</b>，
           只是帳目上會看到金流單號跟後台記的那組不一樣。
         </p>`;

    const html = wrapOwnerMail(
      title,
      `${lead}
       <p style="font-size:13.5px;color:#8A7A6E;line-height:2;">
         贊助編號：#${x.spId}<br>
         金額：${money(amount)}<br>
         支持者：${esc(sp?.display_name) || "（匿名）"}　Email：${esc(sp?.email)}<br>
         付款方式（後台目前記的）：${esc(sp?.pay_method || "—")}<br>
         這次入帳的單號：<b>${esc(x.mtn)}</b>（已作廢的舊單號）<br>
         後台目前記的單號：${esc(sp?.trade_no || "—")}
       </p>
       <p style="font-size:13.5px;line-height:2;">
         <a href="${siteBase()}/admin/sponsors?open=${x.spId}#s${x.spId}">到後台看這筆 →</a>
       </p>`
    );
    for (const to of emails) await sendMail(to, subject, html, undefined, { kind: "owner" });
  } catch (e) {
    /* 通知失敗不能反過來影響金流回呼 */
    console.error("[notifySponsorStaleTradeNo]", e);
  }
}

/*
 * 訂單通知的收件人＝「商品訂購通知信箱」聯集「站長通知信箱」，不分大小寫去重。
 *
 * 為什麼要聯集（2026-09-07 站長回報）：站長看到欄位叫「站長通知信箱」就把自己的信箱
 * 填在那一格，然後有人下單他什麼都沒收到，因為訂單通知從頭到尾只讀 notify_emails。
 * 兩格都是「要通知的人」，差別只在站長那格還會收到投稿、贊助這些商品以外的事，
 * 所以訂單通知兩格一起收，是唯一不會讓人踩空的行為。欄位說明也一起改清楚了。
 *
 * 去重必須不分大小寫：同一個人常常兩格填得不一樣（Hi@x.com 與 hi@x.com），
 * 那是同一個信箱，同一張單寄兩封只會讓人以為系統壞了。
 * 保留第一次出現的原始寫法，寄信時大小寫照舊。
 */
export function orderNotifyRecipients(shopField: string, ownerField: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of `${shopField},${ownerField}`.split(/[,，;\s]+/)) {
    const v = raw.trim();
    if (!v.includes("@")) continue;
    const key = v.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v);
  }
  return out;
}

/*
 * 兩格都沒填的時候留一筆「沒寄」紀錄。
 *
 * 以前這種情況是安靜地什麼都不做：站長在發送頁看不到任何一列，
 * 分不出「沒有人設定要收」與「寄了但失敗」，只能猜。
 * 記一筆 skipped 進 mail_log，發送頁（打開營運通知）就看得到那張單的通知去哪了。
 */
export function logOrderNotifySkip(orderNo: string, subject: string): number {
  return logMail({
    kind: "owner",
    to: "",
    subject,
    status: "skipped",
    detail: "沒有設定任何通知信箱：設定・通知的「商品訂購通知信箱」與「站長通知信箱」都是空的，這筆訂單沒有人收到通知",
    refNo: orderNo,
  });
}

export async function notifyProductPurchases(orderId: number): Promise<void> {
  const emails = orderNotifyRecipients(getSetting("notify_emails", ""), getSetting("owner_notify_emails", ""));
  /* 站長名單空也不能 return：夥伴的通知走自己的名單，跟站長有沒有填無關 */

  const o = db
    .prepare("SELECT id,order_no,name,phone,email,address,ship_method,items,total,created_at,notified,recipient_name,recipient_phone FROM orders WHERE id=?")
    .get(orderId) as (OrderRow & { notified: number }) | undefined;
  if (!o) return;

  /*
   * 同一筆訂單只通知一次（ATM 取號通知過，之後付款完成不再重寄）。
   *
   * 這一行 UPDATE 就是鎖，所以它必須留在寄信「之前」：SQLite 的單句 UPDATE 是原子的，
   * 帶著 notified=0 當條件，同時進來的兩個呼叫只有一個會拿到 changes=1，
   * 另一個看到 0 就走人。改成「寄完再標記」的話，兩個呼叫會同時通過檢查、同時寄，
   * 站長收到兩封一模一樣的信。
   *
   * 但先標記帶來原本的毛病：寄信失敗那張單就永遠不會再通知，站長根本不知道有人下單。
   * 所以補一條回收：真的試著寄了、而且一封都沒成功，就把 notified 放回 0，
   * 下一次呼叫（例如站長在後台重新觸發付款完成）還有機會通知。
   * 「壓根沒東西可寄」（沒品項、沒設定收件人）不放回去：重跑一百次結果一樣，
   * 放回去只會讓每次呼叫都白跑一輪，而且那種情況已經有 mail_log 的 skipped 留痕。
   */
  const claim = db.prepare("UPDATE orders SET notified=1 WHERE id=? AND notified=0").run(orderId);
  if (claim.changes === 0) return;

  let attempted = false;   /* 有沒有真的送出過任何一封（含夥伴） */
  let anySent = false;     /* 其中至少一封成功 */
  try {
    const esc = (v: unknown) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const items = json<Item[]>(o.items, []);
    if (items.length === 0) return;
    const ids = items.map((i) => i.id);
    const marks = ids.map(() => "?").join(",");

    /*
     * 通知信主旨（站長指示 2026-08-30）：帶金額與商品名，不帶訂單編號——
     * 編號在手機通知列沒有意義（沒人用眼睛記編號），金額與買了什麼才有。
     * 品項多的時候只列第一項再加「等 N 項」，否則主旨會長到被截斷。
     *
     * 夥伴那封不帶金額：夥伴看份數不看錢，這是拆帳談判的界線，
     * 主旨也不能破例（他每收一封信就看到一次零售價）。
     */
    const subjectOf = (hitItems: Item[], forPartner: boolean) => {
      const first = hitItems[0];
      const name = String(first?.name || "商品").slice(0, 14);
      const qty = hitItems.reduce((s2, i) => s2 + (Number(i.qty) || 0), 0);
      const more = hitItems.length > 1 ? ` 等 ${hitItems.length} 項` : "";
      const amount = forPartner ? "" : `${money(o.total)}｜`;
      return `有人訂購 ${amount}${name} x${qty}${more}｜問爽的`;
    };

    /*
     * 訂購人與收件人分兩段列出，相同時只列一段。
     * 這裡原本把 o.name／o.phone（訂購人）標成「收件人」，是既有 bug（順手修）：
     * 站長看這封信會以為訂購人就是要收貨的人，多地址配送那種訂單的地址欄
     * 本來就是空的（名單在 ship_list，站長之後才補），一起補上一句說明，
     * 不要讓地址那一行看起來像漏資料。
     */
    const rec = recipientOf(o);
    const recipientLine = rec.sameAsBuyer
      ? `訂購人：${esc(o.name)}　${esc(o.phone)}<br>`
      : `訂購人：${esc(o.name)}　${esc(o.phone)}<br>收件人：${esc(rec.name)}　${esc(rec.phone)}<br>`;
    const addressLine = isMultiShip(o.ship_method)
      ? "（多地址配送，收件名單另在後台補齊）"
      : esc(o.address);
    const buildMail = (hitItems: Item[], workbenchLink: string, forPartner = false) => (forPartner ? wrapMail : wrapOwnerMail)(
      forPartner ? "有人訂購了你的商品" : "有人下單了",
      `<p style="font-size:15px;line-height:2;">訂單 <b class="sans">${o.order_no}</b>${forPartner ? " 有你要出的貨：" : " 的內容："}</p>
       <table style="width:100%;border-collapse:collapse;font-size:14px;">
         ${hitItems.map((i) => `<tr><td style="padding:4px 0;">${esc(i.name)}${i.choice ? `（${esc(i.choice)}）` : ""}</td><td style="text-align:right;">× ${i.qty}</td></tr>`).join("")}
       </table>
       <p style="font-size:13.5px;color:#8A7A6E;line-height:1.9;">
         ${recipientLine}
         ${esc(o.ship_method || "宅配")}：${addressLine}<br>
         ${forPartner
           /* 夥伴不看金額（拆帳談判的界線），而且 o.total 是整張訂單的總額——
              混買單的話裡面含別家商品的錢，給了既違反界線也給錯數字。
              出貨需要的是收件資訊與數量，不是價格。 */
           ? "出貨資訊如上，數量請以工作台為準。"
           : `訂單金額 ${money(o.total)}・付款狀態以後台為準。`}
       </p>
       ${workbenchLink ? `<p style="font-size:14px;line-height:2;margin-top:14px;">
         各出貨週要做多少、要寄給誰，開工作台看最新現況（按「出貨」會自動寄物流信給顧客）：<br>
         <a href="${workbenchLink}" style="color:#D97F12;font-weight:700;">${forPartner ? "出貨工作台（隨時是最新清單）" : "開出貨總覽 →"}</a>
       </p>` : ""}`
    );
    /*
     * 不附全量 CSV（信箱被盜一次外洩的是所有顧客），改工作台連結，金鑰可隨時作廢。
     *
     * 通知分兩路（多夥伴版）：
     *   一、站長的 notify_emails——收「有勾通知的商品」，全部夥伴的都看得到，連結不附
     *       （站長進後台就好，不需要一條帶金鑰的連結躺在信箱裡）。
     *   二、各夥伴的 notify_emails——只收自己商品的品項，信裡附自己的工作台連結。
     *       梅子酥夥伴不該知道蛋黃酥今天賣了幾盒：這既是雜訊也是商業資訊。
     */
    /*
     * 站長的通知：整間商店只要有人下單就寄，不再看商品有沒有勾「購買通知」
     * （站長指示 2026-08-30）。
     *
     * 舊行為是「只通知有勾的商品」，而站長自己的八個商品全都沒勾，等於賣了
     * 也不會知道。想只盯特定商品的話，把 notify_all_products 關掉，
     * 就退回舊的逐商品勾選模式。
     */
    const notifyAll = getSetting("notify_all_products", "1") === "1";
    const watched = notifyAll
      ? (db.prepare(`SELECT id,name FROM products WHERE id IN (${marks})`).all(...ids) as { id: number; name: string }[])
      : (db.prepare(`SELECT id,name FROM products WHERE notify=1 AND id IN (${marks})`).all(...ids) as { id: number; name: string }[]);
    {
      const watchedIds = new Set(watched.map((w) => w.id));
      /* 全店模式下品項全列；逐商品模式只列有勾的那些。
         連結型訂單的自訂項目（id=0，不綁商品）在全店模式也要出現，
         否則站長會收到一封沒有品項的空信。 */
      const hit = notifyAll ? items : items.filter((i) => watchedIds.has(i.id));
      if (hit.length > 0 && emails.length === 0) {
        /* 有東西該通知卻沒有人收：留一筆「沒寄」，不要安靜地消失 */
        logOrderNotifySkip(o.order_no, subjectOf(hit, false));
      }
      if (hit.length > 0 && emails.length > 0) {
        /*
         * 站長的信也放工作台連結（站長指示 2026-08-31）。
         *
         * 原本刻意留空，理由是「站長進後台就好，不需要一條帶金鑰的連結躺在信箱裡」。
         * 那個顧慮只適用於夥伴的連結——夥伴連結帶金鑰，等於一把鑰匙。
         * 站長版是 /partner 純網址，沒有任何金鑰，要看還是得先登入後台，
         * 信箱外流也拿不到東西。所以可以放，而且省掉每次手動找路徑。
         */
        const ownerHtml = buildMail(hit, `${siteBase()}/partner`);
        const subject = subjectOf(hit, false);
        for (const to of emails) {
          attempted = true;
          if (await sendMail(to, subject, ownerHtml, undefined, { kind: "owner", refNo: o.order_no })) anySent = true;
        }
      }
    }

    const partnerRows = db
      .prepare(`SELECT p.id AS pid, pr.id, pr.name, pr.notify_emails, pr.key
                FROM products p JOIN partners pr ON pr.id = p.partner_id
                WHERE pr.active=1 AND p.id IN (${marks})`)
      .all(...ids) as { pid: number; id: number; name: string; notify_emails: string; key: string }[];
    const byPartner = new Map<number, { emails: string[]; key: string; productIds: Set<number> }>();
    for (const r of partnerRows) {
      if (!byPartner.has(r.id)) {
        byPartner.set(r.id, {
          emails: r.notify_emails.split(/[,，;\s]+/).map((s) => s.trim()).filter((s) => s.includes("@")),
          key: r.key,
          productIds: new Set(),
        });
      }
      byPartner.get(r.id)!.productIds.add(r.pid);
    }
    for (const [, grp] of byPartner) {
      if (grp.emails.length === 0) continue;
      const own = items.filter((i) => grp.productIds.has(i.id));
      if (own.length === 0) continue;
      const html = buildMail(own, `${siteBase()}/api/partner-view?k=${encodeURIComponent(grp.key)}`, true);
      const subject = subjectOf(own, true);
      for (const to of grp.emails) {
        attempted = true;
        if (await sendMail(to, subject, html, undefined, { kind: "owner", refNo: o.order_no })) anySent = true;
      }
    }
  } catch (e) {
    console.error("[notifyProductPurchases]", e);
  } finally {
    /* 送了但全軍覆沒才解鎖重來。用 finally 是因為上面任何一個 return 或例外都要經過這裡 */
    if (attempted && !anySent) {
      try { db.prepare("UPDATE orders SET notified=0 WHERE id=?").run(orderId); } catch { /* 解不掉也不能再往外丟 */ }
    }
  }
}

/*
 * 逾期未出貨警報（多夥伴版）。
 *
 * 出貨週是自由文字，程式讀不懂「9/28 ~ 10/2」何時結束（不寫日期解析是既定決策，
 * 格式一變就靜靜誤判）。所以判準改用讀得懂的：付款完成超過 N 天（partner_late_days，
 * 預設 10，後台可調）仍有品項沒標出貨。預購單付款後等排程週是正常的，
 * 所以 N 給得寬；站長可依檔期節奏調。
 *
 * 每天最多寄一輪（settings 記當日戳），各夥伴只收自己的清單，站長收全部。
 * 掛在對帳排程裡跑（15 分鐘一次，本函式自己判斷今天寄過就跳過）。
 */
export async function notifyLateShipments(): Promise<void> {
  try {
    /* 0＝關閉（預設）。開了之後：有下架日的週看「截止日過了沒」，
       沒下架日的才用「付款後 N 天」——預購單付款後等出貨週是常態，天數判準對它是錯的量尺 */
    const lateDays = Number(getSetting("partner_late_days", "0")) || 0;
    if (lateDays <= 0) return;
    const { taipeiYMD } = await import("./month");
    const today = taipeiYMD().iso;
    if (getSetting("late_alert_last_day", "") === today) return;

    const orders = db
      .prepare("SELECT id,order_no,items,created_at,ship_method,COALESCE(ship_list,'') ship_list FROM orders WHERE status='paid' ORDER BY id")
      .all() as { id: number; order_no: string; items: string; created_at: string; ship_method: string; ship_list: string }[];
    if (orders.length === 0) { setSetting("late_alert_last_day", today); return; }

    const originQ = db.prepare("SELECT partner_id, choice_expiry FROM products WHERE id=?");
    const { isMultiShip } = await import("./multi-ship");
    const { parseChoiceExpiry } = await import("./choice-split");
    /* 這個品項現在算不算逾期：有下架日 → 截止日過了才算；沒有 → 付款超過 N 天才算 */
    const isLate = (choice: string | null, expiryRaw: string | null | undefined, createdAt: string): boolean => {
      if (choice) {
        const d = parseChoiceExpiry(expiryRaw)[choice];
        if (d) return today > d;
      }
      return new Date(createdAt).getTime() < Date.now() - lateDays * 86400_000;
    };
    type LateRow = { orderNo: string; name: string; choice: string; qty: number; days: number };
    const byPartner = new Map<number, LateRow[]>();
    for (const o of orders) {
      let items: { id: number; name: string; choice: string | null; qty: number; shipped?: number }[] = [];
      try { items = JSON.parse(o.items || "[]"); } catch { items = []; }
      const days = Math.floor((Date.now() - new Date(o.created_at).getTime()) / 86400_000);
      const prodOf = (id: number) => originQ.get(Number(id)) as { partner_id: number | null; choice_expiry: string } | undefined;
      const pidOf = (id: number) => prodOf(id)?.partner_id;
      /*
       * 多地址企業單的出貨記在收件人名單（ship_list），品項的 shipped 旗標從來不會動。
       * 用品項判斷會把出到一半的企業單永遠當成逾期，天天騷擾夥伴。
       * 改看名單：還有幾位沒出就是幾位，歸給訂單裡第一個夥伴商品（連結限單一出貨地）。
       */
      if (isMultiShip(o.ship_method)) {
        let list: { shipped?: number; qty?: number }[] = [];
        try { list = JSON.parse(o.ship_list || "[]"); } catch { list = []; }
        if (list.length === 0) continue; /* 名單還沒補：等站長補完名單再開始計時 */
        const remain = list.filter((r) => !r.shipped);
        if (remain.length === 0) continue;
        const first = items.find((it) => pidOf(it.id));
        const pid = first ? pidOf(first.id) : null;
        if (!pid) continue;
        if (!isLate(first!.choice, prodOf(first!.id)?.choice_expiry, o.created_at)) continue;
        if (!byPartner.has(pid)) byPartner.set(pid, []);
        byPartner.get(pid)!.push({
          orderNo: o.order_no, name: `${first!.name}（多地址，${remain.length} 位未出）`, choice: "",
          qty: remain.reduce((s2, r) => s2 + (Number(r.qty) || 0), 0), days,
        });
        continue;
      }
      for (const it of items) {
        if (it.shipped) continue;
        const prod = prodOf(it.id);
        const pid = prod?.partner_id;
        if (!pid) continue; /* 本店的貨站長自己在後台看，不寄警報信給自己一份清單兩份焦慮 */
        if (!isLate(it.choice, prod?.choice_expiry, o.created_at)) continue;
        if (!byPartner.has(pid)) byPartner.set(pid, []);
        byPartner.get(pid)!.push({ orderNo: o.order_no, name: it.name, choice: it.choice || "", qty: it.qty, days });
      }
    }
    setSetting("late_alert_last_day", today);
    if (byPartner.size === 0) return;

    const esc = (v: unknown) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const listHtml = (rows: LateRow[]) =>
      `<table style="width:100%;border-collapse:collapse;font-size:14px;">${rows
        .map((r) => `<tr><td style="padding:4px 0;">${esc(r.orderNo)}</td><td>${esc(r.name)}${r.choice ? `（${esc(r.choice)}）` : ""}</td><td style="text-align:right;">× ${r.qty}・已 ${r.days} 天</td></tr>`)
        .join("")}</table>`;

    const partners = db.prepare("SELECT id,name,key,notify_emails FROM partners WHERE active=1").all() as { id: number; name: string; key: string; notify_emails: string }[];
    const ownerRows: string[] = [];
    for (const p of partners) {
      const rows = byPartner.get(p.id);
      if (!rows || rows.length === 0) continue;
      ownerRows.push(`<p style="font-size:14.5px;margin:14px 0 4px;"><b>${esc(p.name)}</b>（${rows.length} 筆）</p>${listHtml(rows)}`);
      const emails = p.notify_emails.split(/[,，;\s]+/).map((s2) => s2.trim()).filter((s2) => s2.includes("@"));
      if (emails.length === 0) continue;
      const html = wrapMail(
        "有幾筆訂單等出貨等比較久了",
        `<p style="font-size:15px;line-height:2;">${esc(p.name)}好，下面這些訂單付款完成超過 ${lateDays} 天還沒標出貨，麻煩看一下是不是漏了：</p>
         ${listHtml(rows)}
         <p style="font-size:14px;line-height:2;margin-top:14px;">
           <a href="${siteBase()}/api/partner-view?k=${encodeURIComponent(p.key)}" style="color:#D97F12;font-weight:700;">開出貨工作台處理</a>
           　·　如果是預購排程內的單（本來就要等到出貨週），不用理這封信。</p>`
      );
      for (const to of emails) await sendMail(to, `出貨提醒：${rows.length} 筆等了超過 ${lateDays} 天｜問爽的`, html, undefined, { kind: "owner" });
    }
    const ownerEmails = getSetting("owner_notify_emails", "").split(/[,，;\s]+/).map((s2) => s2.trim()).filter((s2) => s2.includes("@"));
    if (ownerRows.length > 0 && ownerEmails.length > 0) {
      const html = wrapOwnerMail("夥伴出貨逾期總表", `<p style="font-size:15px;line-height:2;">付款超過 ${lateDays} 天未出貨的清單（已同步提醒各夥伴）：</p>${ownerRows.join("")}`);
      for (const to of ownerEmails) await sendMail(to, `夥伴出貨逾期總表｜問爽的`, html, undefined, { kind: "owner" });
    }
  } catch (e) {
    console.error("[notifyLateShipments]", e);
  }
}
