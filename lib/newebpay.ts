import crypto from "crypto";

/*
 * 藍新金流（NewebPay）幕前支付 MPG，介接手冊 Version 2.0。
 *
 * 環境變數：NEWEBPAY_MERCHANT_ID／NEWEBPAY_HASH_KEY（32 碼）／NEWEBPAY_HASH_IV（16 碼）／
 * NEWEBPAY_TEST（1＝測試站）。三把金鑰缺一律視為未啟用，安靜不動：
 * 藍新沒有像綠界那樣公開給大家用的測試特店，沒有金鑰就是沒有金鑰，不虛構一組能用的假設定。
 *
 * 加密／簽章那幾支（encryptTradeInfo／decryptTradeInfo／tradeSha／verifyTradeSha）
 * 一律把 HashKey／HashIV 當參數傳進來，不在函式內部讀 newebpayConfig() 或環境變數，
 * 也完全不 import db。這樣 tests/smoke.ts 才能直接餵一組測試用的 32/16 碼字串做加解密的
 * 來回測試，不需要真的設定環境變數，也不需要先把資料庫開起來。
 */

export function newebpayConfig() {
  const merchantId = process.env.NEWEBPAY_MERCHANT_ID || "";
  const hashKey = process.env.NEWEBPAY_HASH_KEY || "";
  const hashIV = process.env.NEWEBPAY_HASH_IV || "";
  const test = process.env.NEWEBPAY_TEST === "1";
  return {
    merchantId,
    hashKey,
    hashIV,
    test,
    gatewayUrl: test ? "https://ccore.newebpay.com/MPG/mpg_gateway" : "https://core.newebpay.com/MPG/mpg_gateway",
    queryUrl: test ? "https://ccore.newebpay.com/API/QueryTradeInfo" : "https://core.newebpay.com/API/QueryTradeInfo",
  };
}

/* 商店與贊助共用這一組金鑰。三把都要有才算啟用，沒設定時全站藍新相關程式一律不動作 */
export function newebpayEnabled(): boolean {
  const c = newebpayConfig();
  return Boolean(c.merchantId && c.hashKey && c.hashIV);
}

/* ── 純加密函式：AES-256-CBC + PKCS7（Node 預設 padding），不吃任何全域狀態 ── */

function aesEncryptHex(plain: string, hashKey: string, hashIV: string): string {
  const cipher = crypto.createCipheriv("aes-256-cbc", Buffer.from(hashKey, "utf8"), Buffer.from(hashIV, "utf8"));
  return Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]).toString("hex").toLowerCase();
}
function aesDecryptHex(hex: string, hashKey: string, hashIV: string): string {
  const decipher = crypto.createDecipheriv("aes-256-cbc", Buffer.from(hashKey, "utf8"), Buffer.from(hashIV, "utf8"));
  return Buffer.concat([decipher.update(Buffer.from(hex, "hex")), decipher.final()]).toString("utf8");
}

/* TradeInfo＝把參數組成 URL query string（URLSearchParams 編碼）之後加密，轉小寫 hex */
export function encryptTradeInfo(params: Record<string, string | number>, hashKey: string, hashIV: string): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) qs.set(k, String(v));
  return aesEncryptHex(qs.toString(), hashKey, hashIV);
}

/* 解密回原始明文字串。TradeInfo 送出時是 query string，藍新回傳時是 JSON 字串，
   兩種明文格式都一樣先解密成字串，要不要再 JSON.parse 由呼叫端決定（parseNotify 會做） */
export function decryptTradeInfo(hex: string, hashKey: string, hashIV: string): string {
  return aesDecryptHex(hex, hashKey, hashIV);
}

/* TradeSha＝SHA256(`HashKey=...&TradeInfo&HashIV=...`)，轉大寫 hex */
export function tradeSha(tradeInfoHex: string, hashKey: string, hashIV: string): string {
  const raw = `HashKey=${hashKey}&${tradeInfoHex}&HashIV=${hashIV}`;
  return crypto.createHash("sha256").update(raw).digest("hex").toUpperCase();
}

/* 驗簽：定時比較，不因為提早不相等而洩漏時間差（比照 lib/ecpay.ts verifyEcpayCallback） */
export function verifyTradeSha(tradeInfoHex: string, sha: string, hashKey: string, hashIV: string): boolean {
  const expect = tradeSha(tradeInfoHex, hashKey, hashIV);
  const given = String(sha || "").toUpperCase();
  const a = Buffer.from(expect);
  const b = Buffer.from(given);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/* ── MerchantOrderNo：訂單與贊助各自的編碼／還原規則 ── */

/*
 * 訂單：WO ＋ 訂單編號（去掉非英數字元，理論上訂單編號本身就是純英數，這裡是保險）。
 * 藍新不接受重複的 MerchantOrderNo（比照綠界），刷卡失敗要再試一次時不能沿用原號，
 * 所以重試時在後面接一段 R＋時間碼；回呼再把它剝掉還原訂單編號。
 * 訂單編號固定是 YD＋數字，不含字母 R，剝除很安全（比照 lib/ecpay.ts retryTradeNo／orderNoFromMtn）。
 */
export function newebpayOrderMtn(orderNo: string, retry = false): string {
  const base = `WO${String(orderNo || "").replace(/[^0-9A-Za-z]/g, "")}`;
  const withRetry = retry ? `${base}R${Date.now().toString(36).toUpperCase()}` : base;
  return withRetry.slice(0, 30);
}
export function orderNoFromNewebpayMtn(mtn: string): string {
  return String(mtn || "").replace(/^WO/, "").replace(/R[0-9A-Za-z]*$/, "");
}
export function isNewebpayOrderMtn(mtn: string): boolean {
  return /^WO[0-9A-Za-z]+$/.test(String(mtn || ""));
}

/*
 * 贊助：WS ＋ 贊助編號 ＋ X ＋ 時間戳尾 6 碼（每次進付款頁都可能重生，避免撞號）。
 * 跟綠界那套（trade_no 只有一欄、需要另一張歷史表才找得回身分）不同：
 * 這裡的編號本身就帶著贊助 id，還原不需要查資料庫，晚到的付款一樣認得回來，
 * 也因此 lib/newebpay.ts 不需要 import db。
 * 中間夾一個固定的 X：時間戳是 36 進位，可能剛好以數字開頭，
 * 沒有這個分隔字元的話「id 後面幾碼」會被貪婪的 \d+ 一起吃進去，還原出錯的 id。
 */
export function newebpaySponsorMtn(id: number): string {
  const ts = Date.now().toString(36).toUpperCase().slice(-6);
  return `WS${id}X${ts}`.slice(0, 30);
}
export function sponsorIdFromNewebpayMtn(mtn: string): number {
  const m = /^WS(\d+)X/.exec(String(mtn || ""));
  return m ? Number(m[1]) : 0;
}
export function isNewebpaySponsorMtn(mtn: string): boolean {
  return /^WS\d+X/.test(String(mtn || ""));
}

/* PaymentType 轉成後台看得懂的付款方式名稱（比照 lib/ecpay.ts ecpayPayLabel） */
export function newebpayPayLabel(paymentType: string): string {
  const t = String(paymentType || "");
  if (t === "CREDIT") return "信用卡";
  if (t === "VACC") return "ATM 轉帳";
  return t || "藍新";
}

/* 台北時間往後 N 天，回 YYYYMMDD（ExpireDate 格式） */
function taipeiExpireDate(daysAhead: number): string {
  const d = new Date(Date.now() + 8 * 3600_000 + daysAhead * 86400_000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}`;
}

export type NewebpayMethod = "credit" | "atm";

/*
 * 組出送往藍新 MPG 的完整表單欄位（MerchantID／TradeInfo／TradeSha／Version），
 * 由付款頁自動 POST 過去。回傳同時附上這次用的 MerchantOrderNo，
 * 呼叫端要把它存進訂單／贊助的 trade_no，之後對帳查詢與回呼比對都靠這一個值，
 * 不能自己再重算一次（時間戳只要重算就會跟送出去的那組不一樣）。
 */
export function buildMpgForm(opts: {
  orderNo: string; /* kind=order 時是訂單編號；kind=sponsor 時是贊助 id（字串） */
  amount: number;
  itemDesc: string;
  email: string;
  method: NewebpayMethod;
  kind: "order" | "sponsor";
  retry?: boolean;
}): { action: string; fields: Record<string, string>; merchantOrderNo: string } {
  const cfg = newebpayConfig();
  const site = (process.env.SITE_URL || "https://www.wensong.tw").replace(/\/$/, "");
  const mtn =
    opts.kind === "sponsor" ? newebpaySponsorMtn(Number(opts.orderNo) || 0) : newebpayOrderMtn(opts.orderNo, opts.retry);
  const p: Record<string, string | number> = {
    MerchantID: cfg.merchantId,
    RespondType: "JSON",
    TimeStamp: Math.floor(Date.now() / 1000),
    Version: "2.0",
    MerchantOrderNo: mtn,
    Amt: Math.round(opts.amount),
    ItemDesc: String(opts.itemDesc || "").slice(0, 50) || "商店訂單",
    Email: opts.email,
    LoginType: 0,
    ReturnURL: `${site}/api/newebpay/return`,
    NotifyURL: `${site}/api/newebpay/notify`,
    CustomerURL: `${site}/api/newebpay/atm`,
  };
  if (opts.method === "atm") {
    p.VACC = 1;
    /* ATM 繳費期限：假設給 3 天，跟綠界跳轉頁常見的「3 天繳費期」說明一致，
       比對帳判定 ATM 逾期的 4 天窗（lib/reconcile.ts FAIL_AFTER_HOURS_ATM）短，留有緩衝。
       文件沒有寫死天數，這是本次串接的假設值，見 docs/newebpay-spec.md。 */
    p.ExpireDate = taipeiExpireDate(3);
  } else {
    p.CREDIT = 1;
  }
  const tradeInfo = encryptTradeInfo(p, cfg.hashKey, cfg.hashIV);
  const sha = tradeSha(tradeInfo, cfg.hashKey, cfg.hashIV);
  return {
    action: cfg.gatewayUrl,
    fields: { MerchantID: cfg.merchantId, TradeInfo: tradeInfo, TradeSha: sha, Version: "2.0" },
    merchantOrderNo: mtn,
  };
}

export type NewebpayAtmInfo = { bankCode: string; codeNo: string; expireDate: string; expireTime: string };
export type NewebpayNotifyResult = {
  ok: boolean; /* Status === "SUCCESS" */
  status: string;
  message: string;
  merchantOrderNo: string;
  tradeNo: string;
  amt: number;
  paymentType: string; /* "CREDIT" | "VACC" | 其他 */
  payTime: string; /* 有值才是真的入帳；ATM 取號成功但未繳費時是空字串 */
  atm?: NewebpayAtmInfo;
};

/*
 * 解析 NotifyURL／ReturnURL／CustomerURL 收到的 POST 表單（Status、MerchantID、
 * TradeInfo、TradeSha、Version）。先驗簽再解密，任何一步不過就回 null，
 * 呼叫端一律當作「這筆不可信」處理，不猜測、不記錄成任何交易結果。
 */
export function parseNotify(body: Record<string, string>): NewebpayNotifyResult | null {
  if (!newebpayEnabled()) return null;
  const cfg = newebpayConfig();
  const tradeInfoHex = body.TradeInfo || "";
  const sha = body.TradeSha || "";
  if (!tradeInfoHex || !sha) return null;
  if (!verifyTradeSha(tradeInfoHex, sha, cfg.hashKey, cfg.hashIV)) return null;
  let json: { Status?: string; Message?: string; Result?: Record<string, unknown> };
  try {
    json = JSON.parse(decryptTradeInfo(tradeInfoHex, cfg.hashKey, cfg.hashIV));
  } catch {
    return null;
  }
  const status = String(json.Status || "");
  const result = (json.Result || {}) as Record<string, unknown>;
  const paymentType = String(result.PaymentType || "");
  return {
    ok: status === "SUCCESS",
    status,
    message: String(json.Message || ""),
    merchantOrderNo: String(result.MerchantOrderNo || ""),
    tradeNo: String(result.TradeNo || ""),
    amt: Number(result.Amt || 0),
    paymentType,
    payTime: String(result.PayTime || ""),
    atm:
      paymentType === "VACC"
        ? {
            bankCode: String(result.BankCode || ""),
            codeNo: String(result.CodeNo || ""),
            expireDate: String(result.ExpireDate || ""),
            expireTime: String(result.ExpireTime || ""),
          }
        : undefined,
  };
}

export type NewebpayQueryResult = { ok: boolean; paid: boolean; raw?: Record<string, unknown>; error?: string };

/*
 * 交易查詢 API（Version 1.3，非 MPG 的 2.0）。對帳用：主動去問一筆待付款訂單／贊助
 * 到底有沒有真的付款成功。TradeStatus "1" 才是已付款，其餘一律當未付款處理，
 * 不主動猜測失敗（跟 lib/ecpay.ts queryTradeInfo 的態度一致）。
 */
export async function queryTrade(merchantOrderNo: string, amount: number): Promise<NewebpayQueryResult> {
  if (!newebpayEnabled()) return { ok: false, paid: false, error: "newebpay 未啟用" };
  const cfg = newebpayConfig();
  const amt = Math.round(amount);
  const checkValue = crypto
    .createHash("sha256")
    .update(`IV=${cfg.hashIV}&Amt=${amt}&MerchantID=${cfg.merchantId}&MerchantOrderNo=${merchantOrderNo}&Key=${cfg.hashKey}`)
    .digest("hex")
    .toUpperCase();
  const body = new URLSearchParams({
    MerchantID: cfg.merchantId,
    Version: "1.3",
    RespondType: "JSON",
    CheckValue: checkValue,
    TimeStamp: String(Math.floor(Date.now() / 1000)),
    MerchantOrderNo: merchantOrderNo,
    Amt: String(amt),
  });
  try {
    const res = await fetch(cfg.queryUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
      signal: AbortSignal.timeout(20_000),
    });
    const j = (await res.json().catch(() => null)) as { Status?: string; Message?: string; Result?: Record<string, unknown> } | null;
    if (!j) return { ok: false, paid: false, error: `HTTP ${res.status}` };
    const ok = j.Status === "SUCCESS";
    const tradeStatus = String((j.Result || {}).TradeStatus ?? "");
    return { ok, paid: ok && tradeStatus === "1", raw: j.Result, error: ok ? "" : j.Message || j.Status || "查詢失敗" };
  } catch (e) {
    return { ok: false, paid: false, error: e instanceof Error ? e.message : String(e) };
  }
}
