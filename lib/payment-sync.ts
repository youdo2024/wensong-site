import db, { json } from "./db";
import { isAutoCancelled, AUTO_CANCEL_MARK } from "./order-superseded";
import { PAY_TYPE_NAME } from "./payuni";
import { sendOrderPaidMail, sendOrderAtmMail, sendSponsorThanksMail } from "./mail";
import { notifyProductPurchases, notifySponsorship } from "./notify";
import { restoreChoiceStocks, deductChoiceStocks, parseChoiceStocks } from "./choice-stock";
import { itemsNeedShipping, type PayLinkItem } from "./pay-link";
import { gaPurchaseEvent, gaServerEvent } from "./ga";
import { invoiceForOrder } from "./amego";
import { addOneMonth } from "./month";
import { notifyOrderLine, orderStatusUrl, type LineOrderLike } from "./line";
import { rememberSponsorTradeNo } from "./sponsor-trade-no";

type OrderRow = {
  order_no: string; name: string; email: string; address: string;
  items: string; subtotal: number; shipping: number; total: number; pay_note: string; ga_cid: string;
  pay_link?: string;
};

/*
 * 入帳成功之後的共用收尾。三家金流各有一段幾乎一樣的程式碼，
 * 抄三份的話改了一處沒改另外兩處是遲早的事，所以收成一支。
 *
 * 兩件連結型訂單專屬的事：
 *  · 沒有實體商品要出貨的（例如收拍片服務費）直接標成已完成，
 *    不然後台與夥伴工作台會一直掛著一筆永遠不會出貨的單。
 *  · 不送 GA。這種單是站長私下談成的，灌進 GA 與廣告像素會讓
 *    Meta 以為某個廣告超級有效而把預算推往錯的地方，這種汙染很難事後拆開。
 *    錢是真的收到，所以後台業績照算（後台是直接讀資料庫，不受這裡影響）。
 */
function afterOrderPaid(orderId: number, revived: boolean) {
  const full = db.prepare("SELECT * FROM orders WHERE id=?").get(orderId) as OrderRow;
  if (revived)
    noteOrder(orderId, "⚠️這筆先前已逾期自動取消，款項晚一步才進來，系統已重新成立訂單並把庫存扣回去。請確認這些貨還做得出來，做不出來要主動聯絡顧客退款。");
  if (!full.pay_link) gaPurchaseEvent(full);
  if (full.pay_link && !itemsNeedShipping(json<PayLinkItem[]>(full.items, []))) {
    db.prepare("UPDATE orders SET status='done' WHERE id=? AND status='paid'").run(orderId);
  }
  void sendOrderPaidMail(full);
  /* 有綁 LINE 的人推一則；沒綁或推不出去就只有 Email（付款完成本來就不發簡訊） */
  void notifyOrderLine("paid", full as LineOrderLike, { url: orderStatusUrl(full.order_no, (full as LineOrderLike).token || "") }).catch((e) => console.error("[line] paid", e));
  void notifyProductPurchases(orderId);
  void invoiceForOrder(orderId);
}

/*
 * 人工把一筆訂單標成已付款。
 *
 * 什麼時候用：錢確實進來了，但系統沒有自動入帳。實際發生過的情況是
 * 訂單被誤判成重複而取消，虛擬帳號卻還活著，顧客照著繳費單去轉帳，
 * 通知回來時 status 已經不是 pending，入帳的條件式 UPDATE 搶不到，
 * 於是錢收了、訂單停在已取消、發票沒開、出貨清單上也沒有這一筆。
 *
 * 這支走的是跟自動入帳完全一樣的後續流程（開發票、寄確認信、
 * 進出貨清單、通知），不是只把狀態欄改一改。只改狀態的話
 * 顧客拿不到發票、你的出貨清單也不會多出這一盒。
 *
 * 用條件式 UPDATE 搶佔：金流的通知萬一晚一步才進來，
 * 那邊的 WHERE status='pending' 會撲空，不會重複開發票或重複扣庫存。
 */
export function markOrderPaidManually(orderId: number, who: string, tradeNo?: string): { ok: boolean; reason?: string } {
  const o = db.prepare("SELECT id,status,items FROM orders WHERE id=?").get(orderId) as
    | { id: number; status: string; items: string }
    | undefined;
  if (!o) return { ok: false, reason: "查無這筆訂單" };
  if (o.status === "paid" || o.status === "shipped" || o.status === "done") {
    return { ok: false, reason: "這筆已經是付款成功的狀態了，不用再標一次" };
  }
  if (o.status !== "pending" && o.status !== "cancelled") {
    return { ok: false, reason: `目前狀態是 ${o.status}，不處理` };
  }

  /* 已取消的訂單庫存早就放回去了，重新成立要再扣一次；
     待付款的庫存本來就還鎖著，再扣就會扣兩次。 */
  const wasCancelled = o.status === "cancelled";
  const stamp = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 16).replace("T", " ");
  const note = `（${stamp} ${who} 人工確認款項已到，手動標記為已付款${tradeNo ? `，金流單號 ${tradeNo}` : ""}）`;
  const win = db
    .prepare(
      `UPDATE orders SET status='paid', pay_note=trim(COALESCE(pay_note,'') || ' ' || ?)
       WHERE id=? AND status IN ('pending','cancelled')`
    )
    .run(note, orderId);
  if (win.changes === 0) return { ok: false, reason: "狀態剛剛被別的流程改掉了，請重新整理再看一次" };

  if (wasCancelled) {
    deductStock(o.items);
    /* 庫存可能已經賣給別人而扣成負數。那是真實情況不是錯誤，
       但一定要讓站長看到並自己決定要補做還是退款。 */
    noteOrder(orderId, "⚠️這筆是取消後才人工補回來的，庫存已重新扣除。請確認這些貨還做得出來。");
  }
  afterOrderPaid(orderId, false);
  return { ok: true };
}

/*
 * PayUni Return/Notify 共用處理。
 * TradeStatus：0=取號成功(ATM/超商已取號待付款) 1=已付款 2=付款失敗 3=付款取消
 * MerTradeNo 前綴：YD=商店訂單、SP=贊助（單筆或首期）、SPR=定期扣款續期
 */
export type SyncResult =
  | { kind: "order"; orderNo: string; outcome: "paid" | "pending" | "failed" }
  | { kind: "sponsorship"; id: number; mode: string; outcome: "paid" | "pending" | "failed" }
  | { kind: "unknown" };

export function restoreStock(itemsJson: string) {
  try {
    const items = JSON.parse(itemsJson) as { id: number; qty: number }[];
    const inc = db.prepare("UPDATE products SET stock = stock + ? WHERE id=?");
    for (const i of items) inc.run(i.qty, i.id);
  } catch (e) {
    /* 原本是空 catch：解析失敗時庫存靜靜地不回補，沒有 log 也沒有痕跡，
       等於商品永遠假性售罄卻查不出原因。至少要留下可追的紀錄。 */
    console.error("[payment-sync] 庫存回補失敗，items 無法解析", itemsJson?.slice(0, 200), e);
  }
  restoreChoiceStocks(itemsJson);
}

/* 回補的反向動作：訂單重新成立時把兩層庫存再扣回去 */
function deductStock(itemsJson: string) {
  try {
    const items = JSON.parse(itemsJson) as { id: number; qty: number }[];
    const dec = db.prepare("UPDATE products SET stock = stock - ? WHERE id=?");
    for (const i of items) dec.run(i.qty, i.id);
  } catch (e) {
    console.error("[payment-sync] 庫存重扣失敗，items 無法解析", itemsJson?.slice(0, 200), e);
  }
  deductChoiceStocks(itemsJson);
}

function noteOrder(id: number, text: string) {
  db.prepare("UPDATE orders SET pay_note=trim(COALESCE(pay_note,'') || ' ' || ?) WHERE id=?").run(text, id);
}

/*
 * 「已經自動取消了，錢卻在這時候進來」的救回。
 *
 * 會發生是因為兩件事同時進行：顧客在第 23 小時 59 分點提醒信去付款，
 * 對帳在第 24 小時 01 分判定逾期、把訂單取消並放回庫存。
 * 金流的成功通知回來時 status 已經不是 pending，入帳的條件式 UPDATE 搶不到，
 * 結果是錢收了、訂單停在已取消、發票沒開、確認信也沒寄，而且沒有人會發現。
 *
 * 所以在入帳之前先把這種單翻回 pending，讓原本的入帳流程照常跑完。
 * 只救「系統自己因為逾期取消」的那種——站長手動取消、或金流回報失敗而取消的，
 * 都是有人做過判斷的結果，不能被一則遲來的通知推翻。
 *
 * 庫存要重新扣回去。這時候很可能已經賣給別人而扣成負數，那是真實情況不是錯誤，
 * 一定要讓站長看到並自己決定要補做還是退款，所以另外寫一行醒目備註。
 */


/*
 * 顧客主動要重試「因為刷卡失敗而被取消」的訂單。
 *
 * 為什麼需要：金流回報失敗時我們就把訂單取消、庫存放回去，於是感謝頁上那顆
 * 「換個方式再試」的按鈕永遠不會出現，因為它的條件是「待付款」。
 * 那顆按鈕原本就是為了這個情境做的，結果在這個情境下失效。
 *
 * 庫存是關鍵：取消時已經放回去了，可能已經賣給別人。所以要在這一刻重新檢查，
 * 不夠就明講，不能默默扣成負數。這也是為什麼不在失敗當下就保留庫存，
 * 那會讓每一次刷卡失敗都白鎖一批貨。
 *
 * 哪幾種取消可以由顧客自己點連結復原：
 *
 *  · 金流回報失敗——這支本來就是為它做的。
 *
 *  · 逾期未付款而自動取消——原本擋掉，那是錯的。待聯絡清單裡的人多半就是這種，
 *    站長傳簡訊過去請他付款，他點開卻看到「這筆訂單已經取消了」，
 *    等於我們自己請人來、又把門關上。而且逾期取消完全是時間到了系統做的，
 *    沒有任何人做過判斷，本來就該讓他能接續付款。
 *
 * 擋下來的兩種：
 *
 *  · 被後續訂單取代——那句「你後來已經有一筆訂單付款成功了」要留著。
 *    讓他重付一次的後果是同一批貨付兩次錢，比讓他多問一句嚴重得多。
 *
 *  · 站長手動取消——有人做過判斷，不能被一次點擊推翻。
 */
const GATEWAY_FAIL_RE = /付款未完成|付款失敗|授權失敗|LINE Pay 請款失敗/;

export function reopenFailedOrderForRetry(orderNo: string): { ok: boolean; reason?: string } {
  const o = db.prepare("SELECT id,status,items,pay_note FROM orders WHERE order_no=?").get(orderNo) as
    | { id: number; status: string; items: string; pay_note: string }
    | undefined;
  if (!o) return { ok: false, reason: "找不到訂單" };
  if (o.status === "pending") return { ok: true };
  if (o.status !== "cancelled") return { ok: false, reason: "這筆訂單不是待付款狀態" };
  const note = o.pay_note || "";
  /* 這句要先問：被後續訂單取代的一律擋，就算它同時也逾期了 */
  if (note.includes("後續已由")) return { ok: false, reason: "你後來已經有一筆訂單付款成功了" };
  const canRetry = GATEWAY_FAIL_RE.test(note) || note.includes(AUTO_CANCEL_MARK);
  if (!canRetry) return { ok: false, reason: "這筆訂單已經取消了" };

  /* 庫存要在同一個交易裡檢查與扣回，中間不能有任何非同步 */
  let short = "";
  try {
    db.transaction(() => {
      const items = JSON.parse(o.items || "[]") as { id: number; name: string; choice: string | null; qty: number }[];
      const takenTotal = new Map<number, number>();
      const takenChoice = new Map<string, number>();
      for (const it of items) {
        if (!(Number(it.id) > 0)) continue;
        const p = db.prepare("SELECT name,stock,choice_stocks FROM products WHERE id=?").get(it.id) as
          | { name: string; stock: number; choice_stocks: string }
          | undefined;
        if (!p) { short = "商品已經下架了"; throw new Error(short); }
        const wantTotal = (takenTotal.get(it.id) || 0) + it.qty;
        if (p.stock < wantTotal) { short = `「${p.name}」已經沒有那麼多了`; throw new Error(short); }
        takenTotal.set(it.id, wantTotal);
        if (it.choice) {
          const m = parseChoiceStocks(p.choice_stocks);
          if (Object.prototype.hasOwnProperty.call(m, it.choice)) {
            const key = `${it.id}\u0000${it.choice}`;
            const want = (takenChoice.get(key) || 0) + it.qty;
            if (m[it.choice] < want) { short = `「${it.choice}」已經被訂滿了`; throw new Error(short); }
            takenChoice.set(key, want);
          }
        }
      }
      const win = db.prepare("UPDATE orders SET status='pending' WHERE id=? AND status='cancelled'").run(o.id);
      if (win.changes === 0) { short = "這筆訂單剛剛被處理過了"; throw new Error(short); }
      deductStock(o.items);
      const stamp = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(5, 16).replace("T", " ");
      db.prepare("UPDATE orders SET pay_note=trim(COALESCE(pay_note,'') || ' ' || ?) WHERE id=?")
        .run(`（${stamp} 顧客重新嘗試付款，訂單已復原）`, o.id);
    })();
  } catch {
    return { ok: false, reason: short || "無法重新開啟這筆訂單" };
  }
  return { ok: true };
}

function reopenIfAutoCancelled(orderId: number): boolean {
  const o = db.prepare("SELECT status,items,pay_note FROM orders WHERE id=?").get(orderId) as
    | { status: string; items: string; pay_note: string }
    | undefined;
  if (!o || o.status !== "cancelled") return false;
  /*
   * 兩種自動取消都要能復原。原本只認「逾期未付款」那一種，
   * 被判定為重複付款嘗試而取消的那種認不出來，於是那筆訂單的 ATM 虛擬帳號
   * 還活著、顧客照著繳費單去轉帳，錢進來了卻永遠停在已取消：
   * 不開發票、不寄信、不進出貨清單，沒有任何人會發現。
   */
  if (!isAutoCancelled(o.pay_note)) return false;
  const win = db.prepare("UPDATE orders SET status='pending' WHERE id=? AND status='cancelled'").run(orderId);
  if (win.changes === 0) return false;
  deductStock(o.items);
  return true;
}

/*
 * TapPay 商店訂單入帳／失敗。條件式 UPDATE 搶佔（只有 pending 會被改），
 * notify 與 3D 導回頁可能同時進來，只有一邊會成功，不重複開發票或寄信。
 * 發票與 PayUni 不同：TapPay 不會開，所以付款成功時由光貿開立（invoiceForOrder）。
 */
export function applyTappayOrderResult(orderNo: string, outcome: "paid" | "failed", recTradeId: string, note: string, paidAmount?: number): SyncResult {
  const order = db.prepare("SELECT id,status,items,total FROM orders WHERE order_no=?").get(orderNo) as
    | { id: number; status: string; items: string; total: number }
    | undefined;
  if (!order) return { kind: "unknown" };

  /* 防禦縱深：TapPay 回查金額若為有效正數且與應付不符，不入帳（只記錄，交由後台人工查）。
     金額未知（undefined／0）時不阻擋，避免誤殺正常付款。 */
  if (outcome === "paid" && typeof paidAmount === "number" && paidAmount > 0 && paidAmount !== order.total) {
    db.prepare("UPDATE orders SET pay_note=trim(COALESCE(pay_note,'') || ' ' || ?) WHERE id=?")
      .run(`⚠️金額不符：TapPay 回報 ${paidAmount}、應付 ${order.total}，未自動入帳`, order.id);
    return { kind: "order", orderNo, outcome: "failed" };
  }

  if (outcome === "paid") {
    const revived = reopenIfAutoCancelled(order.id);
    const win = db
      .prepare("UPDATE orders SET status='paid', trade_no=?, pay_method='信用卡（TapPay）', pay_note=? WHERE id=? AND status='pending'")
      .run(recTradeId, note, order.id);
    if (win.changes > 0) afterOrderPaid(order.id, revived);
    return { kind: "order", orderNo, outcome: "paid" };
  }

  const win = db
    .prepare("UPDATE orders SET status='cancelled', trade_no=?, pay_note=? WHERE id=? AND status='pending'")
    .run(recTradeId, note || "付款失敗", order.id);
  if (win.changes > 0) restoreStock(order.items);
  return { kind: "order", orderNo, outcome: "failed" };
}

/*
 * 綠界商店訂單入帳／失敗。
 *
 * 綠界的 ReturnURL 與 OrderResultURL 幾乎同時抵達，而且失敗時還會重送，
 * 所以跟 TapPay 那條一樣要用條件式 UPDATE 搶佔：只有 status='pending' 的那一次會贏，
 * 開發票、寄信、記 GA 只有贏家做。少了這道，同一筆會開兩張發票，作廢比重寄信麻煩得多。
 *
 * 發票同樣由光貿開（invoiceForOrder）：綠界只收款，不像 PayUni 會代開。
 */
export function applyEcpayOrderResult(
  orderNo: string,
  outcome: "paid" | "failed",
  tradeNo: string,
  payMethodLabel: string,
  note: string,
  paidAmount?: number
): SyncResult {
  const order = db.prepare("SELECT id,status,items,total FROM orders WHERE order_no=?").get(orderNo) as
    | { id: number; status: string; items: string; total: number }
    | undefined;
  if (!order) return { kind: "unknown" };

  /* 金額不符不入帳，只留備註給後台人工看。金額未知時不阻擋，避免誤殺正常付款 */
  if (outcome === "paid" && typeof paidAmount === "number" && paidAmount > 0 && paidAmount !== order.total) {
    db.prepare("UPDATE orders SET pay_note=trim(COALESCE(pay_note,'') || ' ' || ?) WHERE id=?")
      .run(`⚠️金額不符：綠界回報 ${paidAmount}、應付 ${order.total}，未自動入帳`, order.id);
    return { kind: "order", orderNo, outcome: "failed" };
  }

  if (outcome === "paid") {
    const revived = reopenIfAutoCancelled(order.id);
    const win = db
      .prepare("UPDATE orders SET status='paid', trade_no=?, pay_method=?, pay_note=? WHERE id=? AND status='pending'")
      .run(tradeNo, payMethodLabel, note, order.id);
    if (win.changes > 0) afterOrderPaid(order.id, revived);
    return { kind: "order", orderNo, outcome: "paid" };
  }

  const win = db
    .prepare("UPDATE orders SET status='cancelled', trade_no=?, pay_note=? WHERE id=? AND status='pending'")
    .run(tradeNo, note || "付款失敗", order.id);
  if (win.changes > 0) restoreStock(order.items);
  return { kind: "order", orderNo, outcome: "failed" };
}

/*
 * 綠界 ATM 取號：還沒付錢，只是拿到虛擬帳號。
 * 訂單維持 pending，把繳費資訊寫進去並寄信通知，顧客才知道要匯到哪裡。
 */
export function applyEcpayOrderAtmInfo(orderNo: string, bank: string, vacc: string, expire: string): SyncResult {
  const order = db.prepare("SELECT id,status FROM orders WHERE order_no=?").get(orderNo) as
    | { id: number; status: string }
    | undefined;
  if (!order) return { kind: "unknown" };
  const note = `ATM 轉帳：${bank} ${vacc}${expire ? `（${expire} 前完成）` : ""}`;
  /* 「尚未寫過繳費帳號」的守門與贊助版相同：綠界會重送取號通知，
     沒有這個條件的話 changes 每次都 >0，繳費信就會寄好幾封 */
  const win = db
    .prepare("UPDATE orders SET pay_method='ATM 轉帳', pay_note=? WHERE id=? AND status='pending' AND COALESCE(pay_note,'') NOT LIKE '%ATM 轉帳：%'")
    .run(note, order.id);
  if (win.changes > 0) {
    const full = db.prepare("SELECT * FROM orders WHERE id=?").get(order.id) as OrderRow;
    void sendOrderAtmMail(full);
    void notifyOrderLine("atm", full as LineOrderLike, { info: note, url: orderStatusUrl(full.order_no, (full as LineOrderLike).token || "") }).catch((e) => console.error("[line] atm", e));
  }
  return { kind: "order", orderNo, outcome: "pending" };
}

/*
 * TapPay 回查結果的統一處理。
 *
 * notify 與 redirect 兩支 route 原本各有一份幾乎相同的判斷，改一處不會動到另一處。
 * 它們也都做了同一個推論：「查得到紀錄但不是已付款」就標記失敗、取消訂單並回補庫存。
 *
 * 依官方 Java SDK 的 RecordStatus 值域（ERROR -1／OK 0／PARTIALREFUNDED 2／REFUNDED 3），
 * 這個值域裡沒有「處理中」，3D 驗證途中的交易是查無紀錄而不是某個非 0 狀態，
 * 所以 -1 可以安全地當成明確失敗。但除此之外一律不推論：
 * 退款（2／3）代表曾經成功過，狀態讀不出來時也維持待付款，交給對帳與逾期流程判斷。
 */
export function settleTappayFromQuery(
  orderNo: string,
  q: { found: boolean; paid: boolean; failed: boolean; refunded: boolean; recTradeId: string; amount: number; bankMsg: string; statusCode: number }
): "paid" | "failed" | "pending" {
  if (q.paid) {
    applyTappayOrderResult(orderNo, "paid", q.recTradeId, `TapPay 付款成功${q.bankMsg ? `（${q.bankMsg}）` : ""}`, q.amount);
    return "paid";
  }
  if (q.failed) {
    applyTappayOrderResult(orderNo, "failed", q.recTradeId, `TapPay 授權失敗${q.bankMsg ? `（${q.bankMsg}）` : ""}`);
    return "failed";
  }
  if (q.found) {
    /* 同一個狀態不重複追加，否則每次回查都會讓備註愈長 */
    const mark = `recordstatus=${q.statusCode}`;
    const note = q.refunded
      ? `TapPay 回查：這筆交易已被退款（${mark}），未自動入帳，請人工確認`
      : `TapPay 回查：尚未完成付款（${mark}${q.bankMsg ? ` ${q.bankMsg}` : ""}）`;
    db.prepare(
      `UPDATE orders SET pay_note=trim(COALESCE(pay_note,'') || ' ' || ?)
       WHERE order_no=? AND status='pending' AND COALESCE(pay_note,'') NOT LIKE ?`
    ).run(note, orderNo, `%${mark}%`);
  }
  return "pending";
}

export function applyPayuniResult(info: Record<string, string>): SyncResult {
  const merTradeNo = info.MerTradeNo || "";

  /* ── 電子發票通知（C0401=開立、C0501=作廢）：把發票號碼記進既有備註欄，不動付款狀態 ── */
  if (info.InvoiceNotifyType) {
    const note =
      info.InvoiceNotifyType === "C0501"
        ? `發票已作廢 ${info.InvoiceNo || ""}`
        : `發票 ${info.InvoiceNo || ""}（${(info.InvoiceTime || "").slice(0, 10)}）`;
    if (merTradeNo.startsWith("YD")) {
      db.prepare("UPDATE orders SET pay_note=trim(COALESCE(pay_note,'') || ' ' || ?) WHERE order_no=?").run(note, merTradeNo);
      return { kind: "order", orderNo: merTradeNo, outcome: "paid" };
    }
    if (merTradeNo.startsWith("SP")) {
      const isRecur = merTradeNo.startsWith("SPR");
      const idMatch = merTradeNo.slice(isRecur ? 3 : 2).match(/^\d+/);
      const id = idMatch ? Number(idMatch[0]) : 0;
      if (id) db.prepare("UPDATE sponsorships SET last_charge_note=trim(last_charge_note || ' ' || ?) WHERE id=?").run(note, id);
      return { kind: "sponsorship", id, mode: "", outcome: "paid" };
    }
    return { kind: "unknown" };
  }
  const tradeStatus = info.TradeStatus ?? "";
  const tradeNo = info.TradeNo || "";
  const payName = PAY_TYPE_NAME[info.PaymentType || ""] || "";

  const outcome: "paid" | "pending" | "failed" =
    tradeStatus === "1" ? "paid" : tradeStatus === "0" ? "pending" : "failed";

  /* ── 商店訂單 ── */
  if (merTradeNo.startsWith("YD")) {
    const order = db.prepare("SELECT id,status,items,pay_method,total FROM orders WHERE order_no=?").get(merTradeNo) as
      | { id: number; status: string; items: string; pay_method: string; total: number }
      | undefined;
    if (!order) return { kind: "unknown" };

    /* 防禦縱深：回報金額與應付不符就不入帳，只留紀錄交人工處理（比照 applyTappayOrderResult）。
       金額未知（缺欄位／0）時不阻擋，避免誤殺正常付款。 */
    const paidAmt = Number(info.TradeAmt || 0);
    if (outcome === "paid" && paidAmt > 0 && paidAmt !== order.total) {
      db.prepare("UPDATE orders SET pay_note=trim(COALESCE(pay_note,'') || ' ' || ?) WHERE id=?")
        .run(`⚠️金額不符：PayUni 回報 ${paidAmt}、應付 ${order.total}，未自動入帳`, order.id);
      return { kind: "order", orderNo: merTradeNo, outcome: "failed" };
    }

    /*
     * 一律用條件式 UPDATE 搶佔，不看記憶體裡的 order.status。
     * ReturnURL 是顧客瀏覽器 POST 的、可以被重送或重整，NotifyURL 是 PayUni 伺服器 POST 的，
     * 兩者幾乎同時抵達。舊寫法先讀 status 再無條件 UPDATE，兩邊都會通過檢查，
     * 於是確認信寄兩封、GA 營收算兩次、庫存回補兩次。
     */
    if (outcome === "paid") {
      const revived = reopenIfAutoCancelled(order.id);
      const win = db
        .prepare("UPDATE orders SET status='paid', trade_no=?, pay_method=COALESCE(NULLIF(?,''),pay_method), pay_note=? WHERE id=? AND status='pending'")
        .run(tradeNo, payName, info.Message || "", order.id);
      /* PayUni 走 afterOrderPaid 的差別：它可能自己開票，開了就不要重複開 */
      if (win.changes > 0) {
        if (process.env.PAYUNI_INVOICE === "1") {
          const full = db.prepare("SELECT * FROM orders WHERE id=?").get(order.id) as OrderRow;
          if (revived) noteOrder(order.id, "⚠️這筆先前已逾期自動取消，款項晚一步才進來，系統已重新成立訂單並把庫存扣回去。請確認這些貨還做得出來，做不出來要主動聯絡顧客退款。");
          if (!full.pay_link) gaPurchaseEvent(full);
          void sendOrderPaidMail(full);
          void notifyProductPurchases(order.id);
        } else {
          afterOrderPaid(order.id, revived);
        }
      }
    } else if (outcome === "failed") {
      const win = db
        .prepare("UPDATE orders SET status='cancelled', trade_no=?, pay_note=? WHERE id=? AND status='pending'")
        .run(tradeNo, info.Message || "付款失敗", order.id);
      if (win.changes > 0) restoreStock(order.items);
    } else if (info.PayNo) {
      /* ATM／超商取號成功：寫入繳費資訊，維持待付款。
         條件加上「尚未寫過繳費資訊」，重送的通知就不會再寄一次繳費信。
         取號階段不通知站長，錢還沒收到，等 paid 再通知，避免同一筆通知兩次。 */
      const note = `ATM 繳費帳號 ${info.BankType || ""} ${info.PayNo}（${info.ExpireDate || ""} 前有效）`;
      const win = db
        .prepare("UPDATE orders SET trade_no=?, pay_note=? WHERE id=? AND status='pending' AND COALESCE(pay_note,'')=''")
        .run(tradeNo, note, order.id);
      if (win.changes > 0) {
        const full = db.prepare("SELECT * FROM orders WHERE id=?").get(order.id) as OrderRow;
        void sendOrderAtmMail(full);
        void notifyOrderLine("atm", full as LineOrderLike, { info: note, url: orderStatusUrl(full.order_no, (full as LineOrderLike).token || "") }).catch((e) => console.error("[line] atm", e));
      }
    }
    return { kind: "order", orderNo: merTradeNo, outcome };
  }

  /* ── 贊助（SP=首次、SPR=續扣） ── */
  if (merTradeNo.startsWith("SP")) {
    const isRecur = merTradeNo.startsWith("SPR");
    const idMatch = merTradeNo.slice(isRecur ? 3 : 2).match(/^\d+/);
    const id = idMatch ? Number(idMatch[0]) : 0;
    const sp = db.prepare("SELECT id,mode,status FROM sponsorships WHERE id=?").get(id) as
      | { id: number; mode: string; status: string }
      | undefined;
    if (!sp) return { kind: "unknown" };

    if (!isRecur) {
      /* 重放防護：Return 封包由使用者瀏覽器 POST、可被重送，
         條件式 UPDATE 讓「只有 pending 才處理」由資料庫保證，而不是靠先前讀到的 status。
         已取消的訂閱不能被重放封包復活繼續扣款，同時成功也只會道謝一次。 */
      if (outcome === "paid") {
        const creditHash = info.CreditHash || "";
        const next = sp.mode === "monthly" ? addOneMonth(new Date()).toISOString() : "";
        /* trade_no 一被寫就同時記進歷史（同一個 transaction）：
           這一欄只有一格，換方式或重試都會蓋掉，日後回呼要靠歷史才找得回這筆贊助 */
        const win = db.transaction(() => {
          const w = db.prepare(
            `UPDATE sponsorships SET status=?, trade_no=?, credit_hash=CASE WHEN ?!='' THEN ? ELSE credit_hash END,
             next_charge_at=?, last_charge_note=? WHERE id=? AND status='pending'`
          ).run(
            sp.mode === "monthly" ? "active" : "paid",
            tradeNo, creditHash, creditHash, next,
            sp.mode === "monthly" && !creditHash ? "首期成功，但未取得約定卡號（請確認 PayUni 已開通約定/記憶卡號功能），無法自動續扣" : "",
            sp.id
          );
          if (w.changes > 0) rememberSponsorTradeNo(sp.id, tradeNo);
          return w;
        })();
        if (win.changes > 0) {
          const full = db.prepare("SELECT id,mode,amount,display_name,email,ga_cid,ga_sid,ga_snum FROM sponsorships WHERE id=?").get(sp.id) as
            { id: number; mode: string; amount: number; display_name: string; email: string; ga_cid: string; ga_sid: string; ga_snum: string };
          void sendSponsorThanksMail(full);
          /* 比照綠界回呼與對帳補正：站長通知與 GA 轉換都要有，否則 PayUni 這條會靜靜地少掉 */
          void notifySponsorship(sp.id, sp.mode === "monthly" ? "monthly-first" : "once");
          gaServerEvent(
            full.ga_cid,
            "sponsor_complete",
            { mode: sp.mode, value: full.amount, currency: "TWD", transaction_id: tradeNo || `SP${sp.id}` },
            { sid: full.ga_sid, snum: full.ga_snum }
          );
        }
      } else if (outcome === "failed") {
        db.prepare("UPDATE sponsorships SET status='failed', last_charge_note=? WHERE id=? AND status='pending'")
          .run(info.Message || "付款失敗", sp.id);
      }
    }
    return { kind: "sponsorship", id: sp.id, mode: sp.mode, outcome };
  }

  return { kind: "unknown" };
}
