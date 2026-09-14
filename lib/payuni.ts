import crypto from "crypto";
import { taipeiYMD } from "./month";

/*
 * PayUni 統一金流串接核心
 * 加密規格對照官方 PHP SDK（github.com/payuni/PHP_SDK）：
 *  - EncryptInfo = hex( base64(AES-256-GCM密文) + ":::" + base64(authTag) )
 *  - HashInfo    = UPPERCASE( SHA256( HashKey + EncryptInfo + HashIV ) )
 *  - 明文為 query string（http_build_query 格式）
 */

export const PAYUNI = {
  merId: process.env.PAYUNI_MERID || "",
  key: (process.env.PAYUNI_HASH_KEY || "").trim(),
  iv: (process.env.PAYUNI_HASH_IV || "").trim(),
  env: process.env.PAYUNI_ENV === "sandbox" ? "sandbox" : "prod",
};

export function payuniEnabled(): boolean {
  return Boolean(PAYUNI.merId && PAYUNI.key.length === 32 && PAYUNI.iv.length === 16);
}

export function apiBase(): string {
  return PAYUNI.env === "sandbox"
    ? "https://sandbox-api.payuni.com.tw/api/"
    : "https://api.payuni.com.tw/api/";
}

export function siteUrl(): string {
  return (process.env.SITE_URL || "https://www.wensong.tw").replace(/\/$/, "");
}

/* PHP http_build_query：空白編成 +，物件轉 query string */
function buildQuery(params: Record<string, string | number>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) sp.append(k, String(v));
  return sp.toString();
}

export function encryptInfo(params: Record<string, string | number>): string {
  const cipher = crypto.createCipheriv("aes-256-gcm", Buffer.from(PAYUNI.key, "utf8"), Buffer.from(PAYUNI.iv, "utf8"));
  const b64 = cipher.update(buildQuery(params), "utf8", "base64") + cipher.final("base64");
  const tag = cipher.getAuthTag().toString("base64");
  return Buffer.from(`${b64}:::${tag}`, "utf8").toString("hex");
}

export function decryptInfo(encHex: string): Record<string, string> {
  const raw = Buffer.from(encHex, "hex").toString("utf8");
  const idx = raw.indexOf(":::");
  if (idx < 0) throw new Error("EncryptInfo 格式錯誤");
  const b64Cipher = raw.slice(0, idx);
  const tag = Buffer.from(raw.slice(idx + 3), "base64");
  const decipher = crypto.createDecipheriv("aes-256-gcm", Buffer.from(PAYUNI.key, "utf8"), Buffer.from(PAYUNI.iv, "utf8"));
  decipher.setAuthTag(tag);
  const plain = decipher.update(b64Cipher, "base64", "utf8") + decipher.final("utf8");
  const out: Record<string, string> = {};
  for (const [k, v] of new URLSearchParams(plain)) out[k] = v;
  return out;
}

export function hashInfo(encHex: string): string {
  return crypto.createHash("sha256").update(PAYUNI.key + encHex + PAYUNI.iv).digest("hex").toUpperCase();
}

/* 驗簽一律用這個比，不要用 !==：長度先比、再走定時比較，不因提早不相等而洩漏時間差 */
export function hashEquals(a: string, b: string): boolean {
  const ba = Buffer.from(String(a || ""), "utf8");
  const bb = Buffer.from(String(b || ""), "utf8");
  if (ba.length === 0 || ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

/* 產生 UPP（整合式支付頁）表單欄位，前端自動送出跳轉 */
export function buildUppFields(params: Record<string, string | number>): {
  action: string;
  fields: Record<string, string>;
} {
  const enc = encryptInfo(params);
  return {
    action: apiBase() + "upp",
    fields: {
      MerID: PAYUNI.merId,
      Version: "1.0",
      EncryptInfo: enc,
      HashInfo: hashInfo(enc),
    },
  };
}

/* 幕後 API（信用卡 token 扣款、交易查詢等） */
export async function callPayuni(
  path: string,
  params: Record<string, string | number>,
  version = "1.0"
): Promise<{ status: string; data: Record<string, string> }> {
  const enc = encryptInfo(params);
  const body = new URLSearchParams({
    MerID: PAYUNI.merId,
    Version: version,
    EncryptInfo: enc,
    HashInfo: hashInfo(enc),
  });
  const res = await fetch(apiBase() + path, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
    signal: AbortSignal.timeout(30_000),
  });
  const json = (await res.json().catch(() => null)) as
    | { Status?: string; EncryptInfo?: string; HashInfo?: string; Message?: string }
    | null;
  if (!json?.Status) throw new Error("PayUni 無回應");
  if (json.Status === "ERROR" || !json.EncryptInfo) {
    return { status: json.Status, data: { Message: json.Message || "" } };
  }
  if (!hashEquals(hashInfo(json.EncryptInfo), json.HashInfo || "")) throw new Error("PayUni 回傳 Hash 驗證失敗");
  return { status: json.Status, data: decryptInfo(json.EncryptInfo) };
}

/* 對帳用：把付款方式代碼轉中文 */
export const PAY_TYPE_NAME: Record<string, string> = {
  "1": "信用卡",
  "2": "ATM 轉帳",
  "3": "超商代碼",
  "7": "AFTEE",
  "9": "LINE Pay",
};

/* 前台選擇的付款方式 → UPP 開關參數 */
export function payMethodParams(method: string): Record<string, string> {
  switch (method) {
    case "信用卡":
      return { Credit: "1" };
    case "LINE Pay":
      return { LinePay: "1" };
    case "Apple Pay":
      return { ApplePay: "1" };
    case "Samsung Pay":
      return { SamsungPay: "1" };
    case "ATM 轉帳":
    case "銀行轉帳": {
      /* 繳費期限要用台灣日期。toISOString() 取的是 UTC，台灣時間 00:00–08:00 之間下單時
         UTC 還停在前一天，繳費期限會少一天。taipeiYMD 已處理時區換算。 */
      return { ATM: "1", ExpireDate: taipeiYMD(3 * 86400000).iso };
    }
    default:
      return {};
  }
}
