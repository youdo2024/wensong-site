import crypto from "crypto";
import { TRADE_DESC } from "./item-name";
import { getSetting } from "./db";

/*
 * ATM 指定銀行（站長 2026-09-03）：AioCheckOut 帶 ChooseSubPayment 就直接產該行虛擬帳號，
 * 客人在綠界頁不用再選銀行。清單照綠界「付款方式一覽表」只列目前有提供的；
 * 台新、玉山、富邦、大眾標「暫不提供」，凱基「即將開放」，先不放。
 */
export const ECPAY_ATM_BANKS: { key: string; label: string }[] = [
  { key: "CHINATRUST", label: "中國信託" },
  { key: "CATHAY", label: "國泰世華" },
  { key: "FIRST", label: "第一銀行" },
  { key: "BOT", label: "台灣銀行" },
  { key: "LAND", label: "土地銀行" },
  { key: "PANHSIN", label: "板信銀行" },
];
export function ecpayAtmBank(): string {
  const v = getSetting("ecpay_atm_bank", "");
  return ECPAY_ATM_BANKS.some((b) => b.key === v) ? v : "";
}

/*
 * 綠界科技（ECPay）全方位金流 AIO：站內贊助收款。
 * 環境變數：ECPAY_MERCHANT_ID / ECPAY_HASH_KEY / ECPAY_HASH_IV，
 * 沒設時使用官方測試特店（3002607），送到測試環境。
 * 簽章：CheckMacValue（SHA256）依官方規則：參數排序 → 前後加 HashKey/HashIV →
 * .NET 式 URL encode → 轉小寫 → SHA256 → 轉大寫。
 */

const TEST = { merchantId: "3002607", hashKey: "pwFHCqoQZGmho4w6", hashIV: "EkRm7iFT261dpevs" };

export function ecpayConfig() {
  const live = Boolean(process.env.ECPAY_MERCHANT_ID && process.env.ECPAY_HASH_KEY && process.env.ECPAY_HASH_IV);
  return {
    live,
    merchantId: process.env.ECPAY_MERCHANT_ID || TEST.merchantId,
    hashKey: process.env.ECPAY_HASH_KEY || TEST.hashKey,
    hashIV: process.env.ECPAY_HASH_IV || TEST.hashIV,
    checkoutUrl: live
      ? "https://payment.ecpay.com.tw/Cashier/AioCheckOut/V5"
      : "https://payment-stage.ecpay.com.tw/Cashier/AioCheckOut/V5",
    periodActionUrl: live
      ? "https://payment.ecpay.com.tw/Cashier/CreditCardPeriodAction"
      : "https://payment-stage.ecpay.com.tw/Cashier/CreditCardPeriodAction",
  };
}

/* 站內贊助（綠界）是否可用：後台切到 API 模式且填了正式金鑰，或明確開啟測試 */
export function ecpayEnabled(): boolean {
  return ecpayConfig().live || process.env.ECPAY_TEST === "1";
}

/* .NET HttpUtility.UrlEncode 行為：空白→+、保留 -_.!*()，其餘百分比編碼後轉小寫 */
function dotNetUrlEncode(s: string): string {
  return encodeURIComponent(s)
    .replace(/~/g, "%7e")
    .replace(/'/g, "%27")
    .replace(/%20/g, "+")
    .toLowerCase()
    .replace(/%2d/g, "-").replace(/%5f/g, "_").replace(/%2e/g, ".")
    .replace(/%21/g, "!").replace(/%2a/g, "*").replace(/%28/g, "(").replace(/%29/g, ")");
}

export function checkMacValue(params: Record<string, string | number>): string {
  const { hashKey, hashIV } = ecpayConfig();
  /*
   * 綠界要的是「不分大小寫的字元序」排序（官方 PHP 範例用 uksort 搭配 strcasecmp）。
   * 原本用 localeCompare，那是 locale-aware 的排序，行為取決於 Node 的 ICU 資料
   * 與容器語系，例如某些 collation 會把數字當成數值來比。目前參數名剛好都是英文
   * 所以碰巧一致，但這是「環境一變就全部交易驗簽失敗」的地雷。
   * 改用純字元比較，等同 strcasecmp，與執行環境無關。
   */
  const sorted = Object.keys(params)
    .filter((k) => k !== "CheckMacValue")
    .sort((a, b) => {
      const x = a.toLowerCase();
      const y = b.toLowerCase();
      return x < y ? -1 : x > y ? 1 : 0;
    })
    .map((k) => `${k}=${params[k]}`)
    .join("&");
  const raw = `HashKey=${hashKey}&${sorted}&HashIV=${hashIV}`;
  const encoded = dotNetUrlEncode(raw);
  return crypto.createHash("sha256").update(encoded).digest("hex").toUpperCase();
}

/* 驗證綠界回呼（付款結果、取號、定期定額授權）的簽章 */
export function verifyEcpayCallback(body: Record<string, string>): boolean {
  const mac = body.CheckMacValue || "";
  if (!mac) return false;
  const params: Record<string, string> = {};
  for (const [k, v] of Object.entries(body)) if (k !== "CheckMacValue") params[k] = v;
  /* 定時比較，不因提早不相等而洩漏時間差 */
  const a = Buffer.from(checkMacValue(params));
  const b = Buffer.from(mac.toUpperCase());
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function tradeDate(): string {
  /* 綠界要台北時間 yyyy/MM/dd HH:mm:ss。不用 toLocaleString（伺服器語系資料不一定齊全，
     格式會漂移），台北固定 UTC+8 無夏令，直接位移後手工組字串 */
  const d = new Date(Date.now() + 8 * 3600 * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}/${p(d.getUTCMonth() + 1)}/${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
}

export type EcpayMethod = "credit" | "credit_period" | "applepay" | "atm" | "twqr";

const CHOOSE: Record<EcpayMethod, string> = {
  credit: "Credit",
  credit_period: "Credit",
  applepay: "ApplePay",
  atm: "ATM",
  twqr: "TWQR",
};

/*
 * 把綠界回傳的 PaymentType 轉成後台看得懂的付款方式名稱。
 * 綠界回的是 Credit_CreditCard、ATM_TAISHIN、TWQR_OPAY、ApplePay 這種帶通路的字串，
 * 直接存進 orders.pay_method 的話，後台訂單列表會出現一堆看不懂的英文代碼。
 */
/*
 * 綠界的 MerchantTradeNo 不接受重複：同一筆訂單刷失敗要再刷一次，
 * 不能拿原本的訂單編號重送，否則綠界直接擋（10100050 訂單重複）。
 * 所以重試時在訂單編號後面接一段 R+時間碼，回呼再把它剝掉還原訂單編號。
 * 訂單編號是 YD + 12 位數字，本身不含 R，剝除很安全。
 */
export function retryTradeNo(orderNo: string): string {
  return `${orderNo}R${Math.floor(Date.now() / 1000).toString(36).toUpperCase()}`.slice(0, 20);
}
export function orderNoFromMtn(mtn: string): string {
  return mtn.replace(/R[0-9A-Za-z]*$/, "");
}

export function ecpayPayLabel(paymentType: string): string {
  const t = String(paymentType || "");
  if (/^ApplePay/i.test(t)) return "Apple Pay";
  if (/^Credit/i.test(t)) return "信用卡";
  if (/^ATM/i.test(t)) return "ATM 轉帳";
  if (/^TWQR/i.test(t)) return "多元支付";
  if (/^WebATM/i.test(t)) return "網路 ATM";
  if (/^BARCODE|^CVS/i.test(t)) return "超商代碼";
  return t || "綠界";
}

/* 組出送往綠界結帳的完整欄位（含 CheckMacValue），由付款頁自動 POST */
export function buildCheckoutFields(opts: {
  merchantTradeNo: string;
  amount: number;
  method: EcpayMethod;
  itemName: string;
  clientBackUrl: string;
}): { action: string; fields: Record<string, string> } {
  const cfg = ecpayConfig();
  const site = (process.env.SITE_URL || "https://www.wensong.tw").replace(/\/$/, "");
  const p: Record<string, string | number> = {
    MerchantID: cfg.merchantId,
    MerchantTradeNo: opts.merchantTradeNo,
    MerchantTradeDate: tradeDate(),
    PaymentType: "aio",
    TotalAmount: opts.amount,
    TradeDesc: TRADE_DESC,
    ItemName: opts.itemName,
    ReturnURL: `${site}/api/ecpay/return`,
    ChoosePayment: CHOOSE[opts.method],
    EncryptType: 1,
    ClientBackURL: opts.clientBackUrl,
    NeedExtraPaidInfo: "N",
  };
  if (opts.method === "credit_period") {
    p.PeriodAmount = opts.amount;
    p.PeriodType = "M";
    p.Frequency = 1;
    p.ExecTimes = 99;
    p.PeriodReturnURL = `${site}/api/ecpay/period`;
  }
  if (opts.method === "atm") {
    p.ExpireDate = 2; /* 通知整合：帳號效期 2 天，跟 48 小時判失敗對齊 */
    p.PaymentInfoURL = `${site}/api/ecpay/atm`;
    const bank = ecpayAtmBank();
    if (bank) p.ChooseSubPayment = bank;
  } else {
    /* 即時付款方式：付款完成自動跳回感謝頁（不用等顧客手動按「返回商店」），
       GA 的 sponsor_complete 轉換才記得到 */
    p.OrderResultURL = `${site}/api/ecpay/result`;
  }
  p.CheckMacValue = checkMacValue(p);
  const fields: Record<string, string> = {};
  for (const [k, v] of Object.entries(p)) fields[k] = String(v);
  return { action: cfg.checkoutUrl, fields };
}

/*
 * ── 對帳用的查詢 API ──
 * 顧客中途放棄或刷卡失敗時，綠界不會主動通知（信用卡只有授權成功才回呼），
 * 紀錄就永遠停在「待付款」。這兩支是反過來由我們主動去問綠界的結果。
 */

function queryUrl(path: string): string {
  const live = ecpayConfig().live;
  return `https://payment${live ? "" : "-stage"}.ecpay.com.tw/Cashier/${path}`;
}

async function postForm(url: string, p: Record<string, string | number>): Promise<string | null> {
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(p)) body.set(k, String(v));
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
      /* 對帳查詢在排程裡跑，沒有 timeout 會讓整輪對帳卡住 */
      signal: AbortSignal.timeout(30_000),
    });
    return await res.text();
  } catch (e) {
    console.error("[ecpay query] 連線失敗", url, e);
    return null;
  }
}

/*
 * 查詢單筆訂單（信用卡／Apple Pay／ATM／多元支付）。
 * 回傳的 TradeStatus：0＝已建立但未付款、1＝已付款、10200095＝訂單不存在或取號失敗。
 */
export async function queryTradeInfo(merchantTradeNo: string): Promise<Record<string, string> | null> {
  const cfg = ecpayConfig();
  const p: Record<string, string | number> = {
    MerchantID: cfg.merchantId,
    MerchantTradeNo: merchantTradeNo,
    TimeStamp: Math.floor(Date.now() / 1000),
  };
  p.CheckMacValue = checkMacValue(p);
  const text = await postForm(queryUrl("QueryTradeInfo/V5"), p);
  if (!text) return null;
  const data = Object.fromEntries(new URLSearchParams(text)) as Record<string, string>;
  /* 綠界查不到訂單時會直接回一段錯誤字串而不是查詢字串 */
  if (!data.MerchantTradeNo && !data.TradeStatus) {
    return { _error: text.slice(0, 160) };
  }
  return data;
}

/*
 * 查詢信用卡定期定額的委託狀態。
 * 回傳 JSON，ExecStatus：0＝委託失敗／不存在、1＝委託成功執行中、2＝已終止。
 */
export async function queryPeriodInfo(merchantTradeNo: string): Promise<Record<string, unknown> | null> {
  const cfg = ecpayConfig();
  const p: Record<string, string | number> = {
    MerchantID: cfg.merchantId,
    MerchantTradeNo: merchantTradeNo,
    TimeStamp: Math.floor(Date.now() / 1000),
  };
  p.CheckMacValue = checkMacValue(p);
  const text = await postForm(queryUrl("QueryCreditCardPeriodInfo"), p);
  if (!text) return null;
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return { _error: text.slice(0, 160) };
  }
}

/* 定期定額解約（取消每月授權） */
export async function cancelCreditPeriod(merchantTradeNo: string): Promise<{ ok: boolean; msg: string }> {
  const cfg = ecpayConfig();
  const p: Record<string, string | number> = {
    MerchantID: cfg.merchantId,
    MerchantTradeNo: merchantTradeNo,
    Action: "Cancel",
    TimeStamp: Math.floor(Date.now() / 1000),
  };
  p.CheckMacValue = checkMacValue(p);
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(p)) body.set(k, String(v));
  try {
    const res = await fetch(cfg.periodActionUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
      signal: AbortSignal.timeout(30_000),
    });
    const text = await res.text();
    const data = Object.fromEntries(new URLSearchParams(text));
    const ok = data.RtnCode === "1";
    if (!ok) console.error("[ecpay] 解約失敗", merchantTradeNo, text.slice(0, 200));
    return { ok, msg: data.RtnMsg || text.slice(0, 100) };
  } catch (e) {
    console.error("[ecpay] 解約異常", merchantTradeNo, e);
    return { ok: false, msg: e instanceof Error ? e.message : "unknown" };
  }
}
