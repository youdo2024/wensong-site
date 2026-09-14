/*
 * 綠界「非信用卡幕後取號」：後端直接拿 ATM 虛擬帳號，客人完全不經過綠界頁面。
 * 文件：developers.ecpay.com.tw/28005（虛擬帳號）、28030（加密）。
 *
 * 跟全方位金流（AioCheckOut）是兩套：這套是 JSON POST，Data 欄位先 URL encode 再 AES-128-CBC（PKCS7）
 * 再 base64，Key/IV 就是 HashKey/HashIV。回應的 Data 反向解開。
 * 2026-09-03 已用官方測試特店在測試環境實測成功（RtnCode 1，拿到 822／013 的虛擬帳號）。
 * 正式特店有沒有開這個服務，要用正式金鑰探測一次才知道，見 ecpayGenPayProbe()。
 */
import crypto from "crypto";
import { ecpayConfig } from "./ecpay";
import db, { getSetting, setSetting } from "./db";
import { applyEcpayOrderAtmInfo } from "./payment-sync";
import { sendSponsorAtmMail } from "./mail";
import { payItemName } from "./item-name";
import { rememberSponsorTradeNo } from "./sponsor-trade-no";
import { findLineBinding, pushLine, composeLine, lineNotifyOn } from "./line";

const ENDPOINT = (live: boolean) =>
  live ? "https://ecpayment.ecpay.com.tw/1.0.0/Cashier/GenPaymentCode" : "https://ecpayment-stage.ecpay.com.tw/1.0.0/Cashier/GenPaymentCode";

export function genpayEncrypt(obj: unknown, key: string, iv: string): string {
  const c = crypto.createCipheriv("aes-128-cbc", Buffer.from(key), Buffer.from(iv));
  const plain = encodeURIComponent(JSON.stringify(obj));
  return Buffer.concat([c.update(plain, "utf8"), c.final()]).toString("base64");
}
export function genpayDecrypt<T = unknown>(b64: string, key: string, iv: string): T {
  const d = crypto.createDecipheriv("aes-128-cbc", Buffer.from(key), Buffer.from(iv));
  const plain = Buffer.concat([d.update(Buffer.from(b64, "base64")), d.final()]).toString("utf8");
  return JSON.parse(decodeURIComponent(plain)) as T;
}

function tradeDate(): string {
  const now = new Date(Date.now() + 8 * 3600_000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${now.getUTCFullYear()}/${p(now.getUTCMonth() + 1)}/${p(now.getUTCDate())} ${p(now.getUTCHours())}:${p(now.getUTCMinutes())}:${p(now.getUTCSeconds())}`;
}

export type GenPayAtmResult = {
  ok: boolean;
  transCode?: number; transMsg?: string;
  rtnCode?: number; rtnMsg?: string;
  vAccount?: string; bankCode?: string; expireDate?: string; tradeNo?: string;
  error?: string;
  live: boolean;
};

/* 取一組 ATM 虛擬帳號。bank 是銀行代碼（822 中信、013 國泰、007 第一、118 板信、004 台銀、005 土銀） */
export async function genPaymentCodeAtm(inp: {
  merchantTradeNo: string; amount: number; itemName: string; tradeDesc?: string; bank: string; expireDays?: number; returnUrl: string;
}): Promise<GenPayAtmResult> {
  const cfg = ecpayConfig();
  const data = {
    MerchantID: cfg.merchantId,
    ChoosePayment: "ATM",
    OrderInfo: {
      MerchantTradeNo: inp.merchantTradeNo.slice(0, 20),
      MerchantTradeDate: tradeDate(),
      TotalAmount: Math.round(inp.amount),
      ReturnURL: inp.returnUrl,
      TradeDesc: (inp.tradeDesc || "wensong").slice(0, 200),
      ItemName: inp.itemName.slice(0, 400),
    },
    ATMInfo: { ExpireDate: Math.min(60, Math.max(1, inp.expireDays ?? 3)), ATMBankCode: inp.bank },
  };
  try {
    const r = await fetch(ENDPOINT(cfg.live), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ MerchantID: cfg.merchantId, RqHeader: { Timestamp: Math.floor(Date.now() / 1000) }, Data: genpayEncrypt(data, cfg.hashKey, cfg.hashIV) }),
      signal: AbortSignal.timeout(20_000),
    });
    const j = (await r.json()) as { TransCode?: number; TransMsg?: string; Data?: string };
    if (!j.Data) return { ok: false, live: cfg.live, transCode: j.TransCode, transMsg: j.TransMsg, error: `HTTP ${r.status} ${j.TransMsg || ""}`.trim() };
    const d = genpayDecrypt<{ RtnCode: number; RtnMsg: string; OrderInfo?: { TradeNo?: string }; ATMInfo?: { vAccount?: string; BankCode?: string; ExpireDate?: string } }>(j.Data, cfg.hashKey, cfg.hashIV);
    return {
      ok: d.RtnCode === 1, live: cfg.live, transCode: j.TransCode, transMsg: j.TransMsg, rtnCode: d.RtnCode, rtnMsg: d.RtnMsg,
      vAccount: d.ATMInfo?.vAccount, bankCode: d.ATMInfo?.BankCode, expireDate: d.ATMInfo?.ExpireDate, tradeNo: d.OrderInfo?.TradeNo,
    };
  } catch (e) {
    return { ok: false, live: cfg.live, error: e instanceof Error ? e.message : String(e) };
  }
}

/*
 * 探測正式特店有沒有開幕後取號：真的取一組 100 元、1 天到期的虛擬帳號（沒人會去繳，隔天自動作廢；
 * 取號本身綠界不收費，ATM 手續費是繳款成功才算）。結果存 settings 給後台看。
 */
export async function ecpayGenPayProbe(bank = "822"): Promise<GenPayAtmResult> {
  const site = (process.env.SITE_URL || "https://www.wensong.tw").replace(/\/$/, "");
  const r = await genPaymentCodeAtm({
    merchantTradeNo: `PROBE${Date.now().toString(36).toUpperCase()}`,
    amount: 100, itemName: "幕後取號探測（請勿繳費）", tradeDesc: "probe", bank, expireDays: 1,
    returnUrl: `${site}/api/ecpay/return`,
  });
  const summary = r.ok
    ? `成功：${r.live ? "正式" : "測試"}特店可用幕後取號（銀行 ${r.bankCode}，帳號末四碼 ${String(r.vAccount || "").slice(-4)}，${r.expireDate} 到期）`
    : `失敗：${[r.transMsg, r.rtnCode !== undefined ? `RtnCode ${r.rtnCode}` : "", r.rtnMsg, r.error].filter(Boolean).join("，")}`;
  setSetting("ecpay_genpay_last", `${new Date().toISOString().slice(0, 16).replace("T", " ")} ${summary}`);
  return r;
}

/* ── 接進結帳 ── */

/* 開關：後台網站設定「ATM 改走幕後取號」。關著就照舊跳綠界頁 */
export function ecpayBackstageAtmOn(): boolean {
  return getSetting("ecpay_atm_backstage", "0") === "1";
}

/* 後台選的 ChooseSubPayment 代號 → 幕後取號要的銀行代碼。沒選就用中國信託 */
const BANK_CODE: Record<string, string> = { CHINATRUST: "822", CATHAY: "013", FIRST: "007", BOT: "004", LAND: "005", PANHSIN: "118" };
export function atmBankCodeForBackstage(): string {
  return BANK_CODE[getSetting("ecpay_atm_bank", "")] || "822";
}

/*
 * 幕後取號的特店交易編號：訂單編號後面接 B（backstage），重取號再接時間碼。
 * 為什麼要有 B：對帳時要知道這筆該去問幕後取號的查詢端點而不是全方位金流的，
 * 兩套系統互相查不到對方的單。訂單編號是 YD＋數字，不含英文，剝除很安全。
 */
export function genpayMtnFor(orderNo: string, retry = false): string {
  return `${orderNo}B${retry ? Date.now().toString(36).toUpperCase() : ""}`.slice(0, 20);
}
/* 商店 YD／YG、贊助 YO，都是前綴＋數字＋B */
export function isGenpayMtn(mtn: string): boolean { return /^Y[DGO]\d+B[0-9A-Z]*$/.test(mtn || ""); }
export function orderNoFromGenpayMtn(mtn: string): string { return mtn.replace(/B[0-9A-Za-z]*$/, ""); }

/* 查一筆幕後取號的訂單（對帳用）。TradeStatus "1" 才是已付款 */
export async function queryGenPayTrade(mtn: string): Promise<{ ok: boolean; tradeStatus?: string; tradeNo?: string; tradeAmt?: number; paymentType?: string; paymentDate?: string; error?: string }> {
  const cfg = ecpayConfig();
  const url = cfg.live ? "https://ecpayment.ecpay.com.tw/1.0.0/Cashier/QueryTrade" : "https://ecpayment-stage.ecpay.com.tw/1.0.0/Cashier/QueryTrade";
  try {
    const r = await fetch(url, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ MerchantID: cfg.merchantId, RqHeader: { Timestamp: Math.floor(Date.now() / 1000) }, Data: genpayEncrypt({ MerchantID: cfg.merchantId, MerchantTradeNo: mtn }, cfg.hashKey, cfg.hashIV) }),
      signal: AbortSignal.timeout(20_000),
    });
    const j = (await r.json()) as { TransCode?: number; TransMsg?: string; Data?: string };
    if (!j.Data) return { ok: false, error: `HTTP ${r.status} ${j.TransMsg || ""}`.trim() };
    const d = genpayDecrypt<{ RtnCode: number; RtnMsg: string; TradeStatus?: string; TradeNo?: string; TradeAmt?: number; PaymentType?: string; PaymentDate?: string; OrderInfo?: { TradeStatus?: string; TradeNo?: string; TradeAmt?: number; PaymentType?: string; PaymentDate?: string } }>(j.Data, cfg.hashKey, cfg.hashIV);
    /* 文件範例把欄位放最外層，取號回應則包在 OrderInfo；兩種都接 */
    const o = d.OrderInfo || d;
    return { ok: d.RtnCode === 1, tradeStatus: String(o.TradeStatus ?? ""), tradeNo: o.TradeNo, tradeAmt: o.TradeAmt, paymentType: o.PaymentType, paymentDate: o.PaymentDate, error: d.RtnCode === 1 ? "" : d.RtnMsg };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/*
 * 幫一張待付款訂單取 ATM 虛擬帳號並寫進訂單（pay_note、trade_no），寄繳費信、推 LINE。
 * 成功回 true；失敗回 false 由呼叫端退回原本的綠界跳轉頁，客人不會卡住。
 * 已經取過號且還沒到期的直接回 true（同一組帳號繼續用，不重取）。
 */
export async function takeAtmNumberForOrder(orderNo: string): Promise<{ ok: boolean; reused?: boolean; error?: string }> {
  const o = db.prepare("SELECT id,order_no,total,items,status,pay_note,trade_no FROM orders WHERE order_no=?").get(orderNo) as
    | { id: number; order_no: string; total: number; items: string; status: string; pay_note: string; trade_no: string } | undefined;
  if (!o || o.status !== "pending") return { ok: false, error: "不是待付款訂單" };
  const note = o.pay_note || "";
  if (isGenpayMtn(o.trade_no || "") && note.includes("ATM 轉帳：")) {
    const m = /（(\d{4})\/(\d{2})\/(\d{2}) 前完成）/.exec(note);
    const notExpired = m ? new Date(`${m[1]}-${m[2]}-${m[3]}T23:59:59+08:00`).getTime() >= Date.now() : false;
    if (notExpired) return { ok: true, reused: true };
  }
  const retry = Boolean(o.trade_no) && o.trade_no !== o.order_no;
  const mtn = genpayMtnFor(o.order_no, retry);
  let itemName = "問爽的訂單"; /* 品名組不出來時的備援，不寫死某一樣商品 */
  try {
    const items = JSON.parse(o.items || "[]") as { name: string; qty: number }[];
    if (items.length) itemName = items.map((i) => `${i.name}x${i.qty}`).join("#").slice(0, 400);
  } catch { /* 品名組不出來就用預設 */ }
  const site = (process.env.SITE_URL || "https://www.wensong.tw").replace(/\/$/, "");
  const r = await genPaymentCodeAtm({ merchantTradeNo: mtn, amount: o.total, itemName, tradeDesc: "wensong", bank: atmBankCodeForBackstage(), expireDays: 2, returnUrl: `${site}/api/ecpay/genpay-return` });
  if (!r.ok || !r.vAccount) {
    console.error("[genpay] 取號失敗", o.order_no, r.transMsg, r.rtnCode, r.rtnMsg, r.error);
    return { ok: false, error: r.rtnMsg || r.transMsg || r.error || "取號失敗" };
  }
  db.prepare("UPDATE orders SET trade_no=?, pay_note='' WHERE id=? AND status='pending'").run(mtn, o.id);
  applyEcpayOrderAtmInfo(o.order_no, r.bankCode || "", r.vAccount, r.expireDate || "");
  return { ok: true };
}

/* 贊助的幕後取號交易編號：YO＋贊助編號＋B＋時間碼（贊助那邊每次進付款頁本來就重生單號） */
export function genpaySponsorMtn(id: number): string {
  return `YO${id}B${Date.now().toString(36).toUpperCase()}`.slice(0, 20);
}
export function sponsorIdFromGenpayMtn(mtn: string): number {
  const m = /^YO(\d+)B/.exec(mtn || "");
  return m ? Number(m[1]) : 0;
}

/*
 * 幫一筆待付款的單筆贊助取 ATM 虛擬帳號：寫 atm_bank／atm_vaccount／atm_expire／trade_no，寄繳費信。
 * 已取過號且沒到期就沿用。失敗回 false，付款頁退回綠界跳轉。
 */
export async function takeAtmNumberForSponsorship(id: number): Promise<{ ok: boolean; reused?: boolean; error?: string }> {
  const sp = db.prepare("SELECT id,mode,amount,display_name,email,COALESCE(phone,'') phone,status,trade_no,COALESCE(pay_token,'') pay_token,COALESCE(atm_vaccount,'') atm_vaccount,COALESCE(atm_expire,'') atm_expire FROM sponsorships WHERE id=?").get(id) as
    | { id: number; mode: string; amount: number; display_name: string; email: string; phone: string; status: string; trade_no: string; pay_token: string; atm_vaccount: string; atm_expire: string } | undefined;
  if (!sp || sp.status !== "pending" || sp.mode !== "once") return { ok: false, error: "不是待付款的單筆贊助" };
  if (isGenpayMtn(sp.trade_no || "") && sp.atm_vaccount) {
    const m = /^(\d{4})\/(\d{2})\/(\d{2})/.exec(sp.atm_expire);
    if (m && new Date(`${m[1]}-${m[2]}-${m[3]}T23:59:59+08:00`).getTime() >= Date.now()) return { ok: true, reused: true };
  }
  const mtn = genpaySponsorMtn(sp.id);
  const site = (process.env.SITE_URL || "https://www.wensong.tw").replace(/\/$/, "");
  const r = await genPaymentCodeAtm({ merchantTradeNo: mtn, amount: sp.amount, itemName: payItemName(sp.mode), tradeDesc: "wensong", bank: atmBankCodeForBackstage(), expireDays: 2, returnUrl: `${site}/api/ecpay/genpay-return` });
  if (!r.ok || !r.vAccount) {
    console.error("[genpay] 贊助取號失敗", sp.id, r.transMsg, r.rtnCode, r.rtnMsg, r.error);
    return { ok: false, error: r.rtnMsg || r.transMsg || r.error || "取號失敗" };
  }
  /* 這組單號連著一個真的能收錢的虛擬帳號。之後客人若改刷卡，trade_no 會被覆寫，
     但這個帳號在綠界那邊還活著，所以一定要記進歷史，晚到的轉帳才對得回這筆贊助。
     跟入帳寫在同一個 transaction：寫了帳號卻沒記歷史，等於這筆又回到會漏帳的狀態。 */
  db.transaction(() => {
    db.prepare("UPDATE sponsorships SET trade_no=?, provider='ecpay', pay_method='ATM 轉帳', atm_bank=?, atm_vaccount=?, atm_expire=?, last_charge_note=? WHERE id=? AND status='pending'")
      .run(mtn, r.bankCode || "", r.vAccount, r.expireDate || "", `ATM 已取號（幕後），繳費期限 ${r.expireDate || ""}`, sp.id);
    rememberSponsorTradeNo(sp.id, mtn);
  })();
  void sendSponsorAtmMail({ id: sp.id, amount: sp.amount, display_name: sp.display_name, email: sp.email, bank: r.bankCode || "", vaccount: r.vAccount, expire: r.expireDate || "", token: sp.pay_token, mode: sp.mode });
  /* 已經綁 LINE 的贊助人：取號當下也推一則繳費資訊（站長 2026-09-04）。沒綁的，綁定當下 callback 會補推 */
  if (lineNotifyOn()) {
    const b = findLineBinding({ phone: sp.phone, email: sp.email });
    if (b && b.status === "bound") {
      void pushLine({
        lineUserId: b.line_user_id,
        text: composeLine(`你的支持 NT$${sp.amount} 繳費資訊：\n銀行代碼 ${r.bankCode || ""}　帳號 ${r.vAccount}\n請於 ${r.expireDate || ""} 前完成。入帳後會在這裡通知你。`),
        kind: "atm", orderNo: `SP${sp.id}`,
      }).catch((e) => console.error("[line] sponsor atm take", e));
    }
  }
  return { ok: true };
}
