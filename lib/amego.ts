import crypto from "crypto";
import db from "./db";
import { INVOICE_ITEM } from "./item-name";
import { isReviewSite } from "./review-mode";
import { notifyInvoiceFailure } from "./notify";

/*
 * 光貿（Amego）電子發票：贊助付款成功後自動開立。
 * 文件：https://invoice.amego.tw/api_doc/
 * 簽章：md5(data JSON 字串 + time + App Key)，Content-Type 為 form-urlencoded。
 * 沒設環境變數時使用官方測試環境（統編 12345678），測試發票不會寄信。
 */

const AMEGO_API = "https://invoice-api.amego.tw";
const TEST_TAX_ID = "12345678";
const TEST_APP_KEY = "sHeq7t8G1wiQvhAuIM27";

export function amegoConfig() {
  /*
   * 審核用測試站一律走光貿測試環境，不管環境變數裡有沒有正式金鑰。
   *
   * 2026-08-13 TapPay 的窗口在正式站測試下單，光貿真的開出一張正式發票
   * DR69013737，站長事後手動作廢。那次靠人補救，這一行讓它變成靠程式。
   */
  if (isReviewSite()) return { taxId: TEST_TAX_ID, appKey: TEST_APP_KEY, live: false };
  return {
    taxId: process.env.AMEGO_TAX_ID || TEST_TAX_ID,
    appKey: process.env.AMEGO_APP_KEY || TEST_APP_KEY,
    live: Boolean(process.env.AMEGO_TAX_ID && process.env.AMEGO_APP_KEY),
  };
}

async function callAmego(path: string, data: unknown): Promise<{ code: number; msg: string; [k: string]: unknown }> {
  const { taxId, appKey } = amegoConfig();
  const dataStr = JSON.stringify(data);
  const time = Math.floor(Date.now() / 1000);
  const sign = crypto.createHash("md5").update(dataStr + time + appKey).digest("hex");
  const body = new URLSearchParams({ invoice: taxId, data: dataStr, time: String(time), sign });
  const res = await fetch(AMEGO_API + path, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
    /* 沒有 timeout 的話，對方沒回應時這個請求會一直掛著 */
    signal: AbortSignal.timeout(30_000),
  });
  /* 先看 HTTP 狀態再解析：對方回 502 時 body 是 HTML，
     直接 res.json() 會拋出與發票完全無關的 SyntaxError，查不出真正原因 */
  const text = await res.text();
  try {
    return JSON.parse(text) as { code: number; msg: string };
  } catch {
    throw new Error(`光貿回應無法解析（HTTP ${res.status}）：${text.slice(0, 200)}`);
  }
}

export type SponsorInvoiceInput = {
  orderId: string;          // 唯一訂單編號（≤40 字）
  amount: number;           // 含稅總額
  email: string;            // 寄發票通知
  displayName: string;
  invoiceType: string;      // b2c / b2b
  invoiceData: { carrierType?: string; carrierNo?: string; npoban?: string; company?: string; taxId?: string };
  itemDesc?: string;
};

/*
 * 開立結果。原本只回發票號碼字串，資訊不夠用：
 * 「開成了」與「原本要的方式沒成立、改開成寄 Email 的」是兩件事，
 * 呼叫端要能分辨才通知得了站長。
 */
export type IssueResult = {
  no: string;        /* 發票號碼；空字串＝沒開成 */
  degraded: boolean; /* true＝客人選的方式被拿掉，改開成寄 Email 的雲端發票 */
  dropped: string;   /* 被拿掉的是什麼，寫給人看（例：手機條碼載具 /ABC1234） */
  error: string;     /* 光貿的錯誤（degraded 時是「第一次」失敗的原因） */
};

/*
 * 客人自己填的三個欄位——統編、手機條碼載具、愛心碼——填錯的後果完全一樣：
 * 光貿拒收整張發票，而開票失敗「不會」擋金流。錢收了、發票沒有、
 * 錯誤只寫進備註欄的一行字，沒有人會去看那一行。
 *
 * 所以拒收之後降級重開一次：把這三個欄位全部拿掉，開一張寄到 Email 的
 * 普通雲端發票。客人一定拿得到發票，站長收到信再決定要不要補做什麼。
 *
 * 只在「光貿有回應且回應是拒絕」時降級。連線逾時或回應解不開時不重試——
 * 那種情況我們根本不知道對方到底開了沒有，重試會變成開出第二張。
 */
function shouldRescue(hasOptional: boolean, answered: boolean): boolean {
  return answered && hasOptional;
}

/*
 * 開立贊助發票。B2C：預設雲端發票寄 Email；可帶手機條碼載具（3J0002）或愛心碼捐贈。
 * B2B：打統編，依文件公式分拆 5% 稅額。
 * 被拒收時自動降級重開一次（見 shouldRescue）。
 */
export async function issueSponsorInvoice(inp: SponsorInvoiceInput): Promise<IssueResult> {
  const fail = (error: string): IssueResult => ({ no: "", degraded: false, dropped: "", error });
  /* 發票品名寫「交易標的」而不是「付款動機」：與使用條款第六條的定性
     （非以有形媒介提供之數位內容及線上服務、買受人取得對價）互相佐證 */
  const item = inp.itemDesc || INVOICE_ITEM;
  const d = inp.invoiceData || {};
  const isB2B = inp.invoiceType === "b2b" && (d.taxId || "").trim().length === 8;
  const carrierIsMobile = !isB2B && (d.carrierType || "").includes("手機") && (d.carrierNo || "").trim().startsWith("/");
  const donate = !isB2B && Boolean((d.npoban || "").trim());

  /* 降級時要告訴站長「被拿掉的是什麼」，這裡先組好人話 */
  const droppedBits: string[] = [];
  if (isB2B) droppedBits.push(`統一編號 ${(d.taxId || "").trim()}`);
  if (carrierIsMobile) droppedBits.push(`手機條碼載具 ${(d.carrierNo || "").trim()}`);
  if (donate) droppedBits.push(`捐贈碼 ${(d.npoban || "").trim()}`);
  const dropped = droppedBits.join("、");

  const build = (degrade: boolean) => {
    const b2b = isB2B && !degrade;
    const carrier = carrierIsMobile && !degrade;
    const npo = donate && !degrade;
    let salesAmount = inp.amount;
    let taxAmount = 0;
    if (b2b) {
      /* 含稅金額分拆：TaxAmount = S - Round(S/1.05)，SalesAmount = S - TaxAmount */
      taxAmount = salesAmount - Math.round(salesAmount / 1.05);
      salesAmount = salesAmount - taxAmount;
    }
    return {
      OrderId: inp.orderId,
      BuyerIdentifier: b2b ? (d.taxId || "").trim() : "0000000000",
      BuyerName: b2b ? ((d.company || "").trim() || (d.taxId || "").trim()) : (inp.displayName || "個人"),
      BuyerEmailAddress: inp.email,
      MainRemark: "",
      CarrierType: carrier ? "3J0002" : "",
      CarrierId1: carrier ? (d.carrierNo || "").trim() : "",
      CarrierId2: carrier ? (d.carrierNo || "").trim() : "",
      NPOBAN: npo ? (d.npoban || "").trim() : "",
      ProductItem: [
        { Description: item, Quantity: 1, Unit: "式", UnitPrice: b2b ? salesAmount : inp.amount, Amount: b2b ? salesAmount : inp.amount, Remark: "", TaxType: 1 },
      ],
      SalesAmount: salesAmount,
      FreeTaxSalesAmount: 0,
      ZeroTaxSalesAmount: 0,
      TaxType: 1,
      TaxRate: "0.05",
      TaxAmount: taxAmount,
      TotalAmount: inp.amount,
      ...(b2b ? { DetailVat: 0 } : {}),
    };
  };

  let firstError = "";
  try {
    const r = (await callAmego("/json/f0401", build(false))) as { code: number; msg: string; invoice_number?: string };
    if (r.code === 0 && r.invoice_number) return { no: r.invoice_number, degraded: false, dropped: "", error: "" };
    firstError = `${r.code} ${r.msg}`;
    console.error("[amego] 開立失敗", inp.orderId, r.code, r.msg);
  } catch (e) {
    /* 對方沒回應：不知道開了沒有，不能重試 */
    console.error("[amego] 開立異常", inp.orderId, e);
    return fail(e instanceof Error ? e.message : "unknown");
  }

  if (!shouldRescue(Boolean(isB2B || carrierIsMobile || donate), true)) return fail(firstError);

  try {
    /* OrderId 刻意不變：萬一第一次其實已經開成了（我們只是沒認出來），
       光貿會以「重複」拒絕第二次，而不是真的開出第二張。 */
    const r2 = (await callAmego("/json/f0401", build(true))) as { code: number; msg: string; invoice_number?: string };
    if (r2.code === 0 && r2.invoice_number) return { no: r2.invoice_number, degraded: true, dropped, error: firstError };
    console.error("[amego] 降級補開也失敗", inp.orderId, r2.code, r2.msg);
    return fail(`${firstError}；改開也失敗：${r2.code} ${r2.msg}`);
  } catch (e) {
    console.error("[amego] 降級補開異常", inp.orderId, e);
    return fail(`${firstError}；改開異常`);
  }
}

/* 作廢發票（退款用；同月作廢） */
export async function voidInvoice(invoiceNumber: string): Promise<boolean> {
  try {
    const r = await callAmego("/json/f0501", [{ CancelInvoiceNumber: invoiceNumber }]);
    if (r.code === 0) return true;
    console.error("[amego] 作廢失敗", invoiceNumber, r.code, r.msg);
    return false;
  } catch (e) {
    console.error("[amego] 作廢異常", invoiceNumber, e);
    return false;
  }
}

/*
 * 幫商店訂單開發票（TapPay 金流用：PayUni 會自己開，TapPay 不會，所以由光貿開）。
 * B2C 多品項：商品逐列＋運費一列＋加購支持一列（品名沿用「數位內容服務」定性），
 *   可帶手機條碼載具；預設雲端發票寄 Email。
 * B2B（統編）：品項彙總一列、以未稅金額開立（DetailVat=0，同贊助發票公式），
 *   避免多列含稅金額與未稅 SalesAmount 對不上。
 * 發票號碼寫回 orders.invoice_no，後台訂單頁看得到。
 */
export async function invoiceForOrder(orderId: number): Promise<void> {
  const o = db
    .prepare("SELECT id,order_no,name,email,items,shipping,total,addon_amount,invoice_no,invoice_type,invoice_data FROM orders WHERE id=?")
    .get(orderId) as {
      id: number; order_no: string; name: string; email: string;
      items: string; shipping: number; total: number; addon_amount: number; invoice_no: string;
      invoice_type: string; invoice_data: string;
    } | undefined;
  if (!o || o.invoice_no) return; // 開過就不重複開

  /*
   * 條件式搶佔：上面那行只是先讀，真正的防線在這裡。
   * 「查有沒有開過」與「去光貿開」中間隔著一次 HTTP，對帳每 15 分鐘跑一次，
   * 前一次的回應還沒回來時 invoice_no 仍是空的，第二輪就會再開一張。
   * 搶不到鎖代表另一條路徑正在開，直接讓出。鎖逾時可重取，避免中途當機鎖死。
   */
  const LOCK_MS = 10 * 60 * 1000;
  const claim = db
    .prepare(
      `UPDATE orders SET invoice_lock_at=? WHERE id=? AND COALESCE(invoice_no,'')=''
       AND (COALESCE(invoice_lock_at,'')='' OR invoice_lock_at < ?)`
    )
    .run(new Date().toISOString(), o.id, new Date(Date.now() - LOCK_MS).toISOString());
  if (claim.changes === 0) return;
  /* 沒開成就把鎖放掉，否則要等十分鐘才能重試 */
  const releaseLock = () => {
    try {
      db.prepare("UPDATE orders SET invoice_lock_at='' WHERE id=?").run(o.id);
    } catch (e) {
      console.error("[amego] 釋放開票鎖失敗", o.order_no, e);
    }
  };

  try {
    let items: { name: string; choice: string | null; price: number; qty: number }[] = [];
    try { items = JSON.parse(o.items) || []; } catch { items = []; }
    const products = items.map((li) => ({
      Description: (li.choice ? `${li.name}（${li.choice}）` : li.name).slice(0, 256),
      Quantity: li.qty,
      Unit: "件",
      UnitPrice: li.price,
      Amount: li.price * li.qty,
      Remark: "",
      TaxType: 1,
    }));
    if (o.shipping > 0) products.push({ Description: "運費", Quantity: 1, Unit: "式", UnitPrice: o.shipping, Amount: o.shipping, Remark: "", TaxType: 1 });
    if (o.addon_amount > 0) products.push({ Description: INVOICE_ITEM, Quantity: 1, Unit: "式", UnitPrice: o.addon_amount, Amount: o.addon_amount, Remark: "", TaxType: 1 });
    /* 折扣後品項小計可能≠total：光貿要求各列 Amount 加總＝TotalAmount，
       有折扣時以負項一列沖平（電子發票常見做法） */
    const lineSum = products.reduce((s, p) => s + p.Amount, 0);
    if (lineSum !== o.total) {
      const diff = o.total - lineSum;
      products.push({ Description: diff < 0 ? "折扣" : "調整", Quantity: 1, Unit: "式", UnitPrice: diff, Amount: diff, Remark: "", TaxType: 1 });
    }

    /* 結帳時選的發票方式：統編（三聯、分拆稅額）／手機條碼載具／預設雲端寄 Email */
    let d: { carrierType?: string; carrierNo?: string; taxId?: string; company?: string; npoban?: string } = {};
    try { d = JSON.parse(o.invoice_data || "{}"); } catch { d = {}; }
    const isB2B = o.invoice_type === "b2b" && /^\d{8}$/.test((d.taxId || "").trim());
    const carrierIsMobile = !isB2B && (d.carrierNo || "").trim().startsWith("/");
    /* 捐贈與統編互斥：開給公司報帳的發票不能捐出去 */
    const donate = !isB2B && Boolean((d.npoban || "").trim());

    /* 降級補開時要告訴站長被拿掉的是什麼 */
    const droppedBits: string[] = [];
    if (isB2B) droppedBits.push(`統一編號 ${(d.taxId || "").trim()}`);
    if (carrierIsMobile) droppedBits.push(`手機條碼載具 ${(d.carrierNo || "").trim().toUpperCase()}`);
    if (donate) droppedBits.push(`捐贈碼 ${(d.npoban || "").trim()}`);
    const dropped = droppedBits.join("、");

    const build = (degrade: boolean) => {
      const b2b = isB2B && !degrade;
      const carrier = carrierIsMobile && !degrade;
      const npo = donate && !degrade;
      let salesAmount = o.total;
      let taxAmount = 0;
      if (b2b) {
        /* 含稅金額分拆：TaxAmount = S - Round(S/1.05)（同贊助發票的公式） */
        taxAmount = salesAmount - Math.round(salesAmount / 1.05);
        salesAmount = salesAmount - taxAmount;
      }
      /* B2B 品項彙總一列（未稅），列細目會跟未稅 SalesAmount 對不上 */
      const b2bItems = [{
        Description: (items.map((li) => li.name).join("、") || "商品貨款").slice(0, 256),
        Quantity: 1, Unit: "式", UnitPrice: salesAmount, Amount: salesAmount, Remark: "", TaxType: 1,
      }];
      return {
        OrderId: o.order_no,
        BuyerIdentifier: b2b ? (d.taxId || "").trim() : "0000000000",
        BuyerName: b2b ? ((d.company || "").trim() || (d.taxId || "").trim()) : (o.name || "個人"),
        BuyerEmailAddress: o.email,
        MainRemark: "",
        CarrierType: carrier ? "3J0002" : "",
        CarrierId1: carrier ? (d.carrierNo || "").trim().toUpperCase() : "",
        CarrierId2: carrier ? (d.carrierNo || "").trim().toUpperCase() : "",
        NPOBAN: npo ? (d.npoban || "").trim() : "",
        ProductItem: b2b ? b2bItems : products,
        SalesAmount: salesAmount,
        FreeTaxSalesAmount: 0,
        ZeroTaxSalesAmount: 0,
        TaxType: 1,
        TaxRate: "0.05",
        TaxAmount: taxAmount,
        TotalAmount: o.total,
        ...(b2b ? { DetailVat: 0 } : {}),
      };
    };

    const env = amegoConfig().live ? "" : "（光貿測試環境）";
    const note = (msg: string) =>
      /* COALESCE：SQLite 的 || 只要有一邊是 NULL，整串就變成 NULL，
         失敗原因會直接消失，後台反而看不到任何線索 */
      db.prepare("UPDATE orders SET pay_note=trim(COALESCE(pay_note,'') || ' ' || ?) WHERE id=?").run(msg, o.id);

    const r = (await callAmego("/json/f0401", build(false))) as { code: number; msg: string; invoice_number?: string };
    if (r.code === 0 && r.invoice_number) {
      db.prepare("UPDATE orders SET invoice_no=?, invoice_lock_at='' WHERE id=?").run(r.invoice_number, o.id);
      return;
    }
    console.error("[amego] 訂單發票開立失敗", o.order_no, r.code, r.msg);
    const firstError = `${r.code} ${r.msg}`;

    /*
     * 客人自己填的統編或載具被光貿拒收時，把那些欄位拿掉重開一張寄 Email 的
     * 雲端發票。開票失敗不擋金流，所以「不補救」的實際結果是：錢收了、
     * 發票沒有、只有備註欄一行沒人看的字，等客人來問才發現。
     *
     * OrderId 刻意不變：萬一第一次其實已經開成了（只是我們沒認出來），
     * 光貿會用「重複」擋掉第二次，而不是真的開出第二張。
     */
    if (isB2B || carrierIsMobile || donate) {
      try {
        const r2 = (await callAmego("/json/f0401", build(true))) as { code: number; msg: string; invoice_number?: string };
        if (r2.code === 0 && r2.invoice_number) {
          db.prepare("UPDATE orders SET invoice_no=?, invoice_lock_at='' WHERE id=?").run(r2.invoice_number, o.id);
          note(`客人選的${dropped}光貿不接受（${firstError}${env}），已改開寄 Email 的雲端發票 ${r2.invoice_number}`);
          void notifyInvoiceFailure({
            kind: "order", ref: o.order_no, amount: o.total, buyerEmail: o.email,
            reason: firstError + env, rescuedNo: r2.invoice_number, dropped,
            adminPath: `/admin/orders/${o.id}`,
          });
          return;
        }
        console.error("[amego] 訂單降級補開也失敗", o.order_no, r2.code, r2.msg);
        releaseLock();
        note(`發票開立失敗：${firstError}；改開也失敗：${r2.code} ${r2.msg}${env}`);
        void notifyInvoiceFailure({
          kind: "order", ref: o.order_no, amount: o.total, buyerEmail: o.email,
          reason: `${firstError}；改開也失敗：${r2.code} ${r2.msg}${env}`, adminPath: `/admin/orders/${o.id}`,
        });
        return;
      } catch (e2) {
        console.error("[amego] 訂單降級補開異常", o.order_no, e2);
        releaseLock();
        note(`發票開立失敗：${firstError}；改開異常${env}`);
        void notifyInvoiceFailure({
          kind: "order", ref: o.order_no, amount: o.total, buyerEmail: o.email,
          reason: `${firstError}；改開異常${env}`, adminPath: `/admin/orders/${o.id}`,
        });
        return;
      }
    }

    releaseLock();
    note(`發票開立失敗：${firstError}${env}`);
    void notifyInvoiceFailure({
      kind: "order", ref: o.order_no, amount: o.total, buyerEmail: o.email,
      reason: firstError + env, adminPath: `/admin/orders/${o.id}`,
    });
  } catch (e) {
    /* 對方沒回應：不知道開了沒有，不重試（重試會變成第二張），交給對帳排程 */
    console.error("[amego] 訂單發票開立異常", o.order_no, e);
    releaseLock();
    db.prepare("UPDATE orders SET pay_note=trim(COALESCE(pay_note,'') || ' ' || ?) WHERE id=?").run("發票開立異常，請至光貿後台補開", o.id);
    void notifyInvoiceFailure({
      kind: "order", ref: o.order_no, amount: o.total, buyerEmail: o.email,
      reason: e instanceof Error ? e.message : "連線異常", adminPath: `/admin/orders/${o.id}`,
    });
  }
}

/* 幫贊助紀錄開發票並回寫發票號碼（chargeId 給定期定額的單期扣款用） */
export async function invoiceForSponsorship(sponsorshipId: number, orderId: string, amount: number, chargeId?: number): Promise<void> {
  const sp = db
    .prepare("SELECT id,display_name,email,invoice_type,invoice_data FROM sponsorships WHERE id=?")
    .get(sponsorshipId) as { id: number; display_name: string; email: string; invoice_type: string; invoice_data: string } | undefined;
  if (!sp) return;
  let data: SponsorInvoiceInput["invoiceData"] = {};
  try { data = JSON.parse(sp.invoice_data || "{}"); } catch { data = {}; }
  const res = await issueSponsorInvoice({
    orderId,
    amount,
    email: sp.email,
    displayName: sp.display_name,
    invoiceType: sp.invoice_type,
    invoiceData: data,
    itemDesc: INVOICE_ITEM,
  });
  const env = amegoConfig().live ? "" : "（目前為光貿測試環境，請確認 Zeabur 已設 AMEGO_TAX_ID／AMEGO_APP_KEY）";
  if (!res.no) {
    db.prepare("UPDATE sponsorships SET last_charge_note=? WHERE id=?").run(
      `發票開立失敗：${res.error || "未知錯誤"}${env}`,
      sponsorshipId
    );
    void notifyInvoiceFailure({
      kind: "sponsor", ref: String(sponsorshipId), amount, buyerEmail: sp.email,
      reason: (res.error || "未知錯誤") + env, adminPath: "/admin/sponsors",
    });
    return;
  }
  if (res.degraded) {
    /* 開出來了，但客人要的方式沒成立。備註留痕，站長另外收到信 */
    db.prepare("UPDATE sponsorships SET last_charge_note=? WHERE id=?").run(
      `客人選的${res.dropped}光貿不接受（${res.error}${env}），已改開寄 Email 的雲端發票 ${res.no}`,
      sponsorshipId
    );
    void notifyInvoiceFailure({
      kind: "sponsor", ref: String(sponsorshipId), amount, buyerEmail: sp.email,
      reason: res.error + env, rescuedNo: res.no, dropped: res.dropped, adminPath: "/admin/sponsors",
    });
  }
  if (chargeId) db.prepare("UPDATE sponsor_charges SET invoice_no=? WHERE id=?").run(res.no, chargeId);
  else db.prepare("UPDATE sponsorships SET invoice_no=? WHERE id=?").run(res.no, sponsorshipId);
}
