import crypto from "crypto";
import { getSetting, setSetting } from "./db";
import { setPayMethodOff } from "./pay-off";

/*
 * LINE Pay Online API v3：單筆贊助。
 * 環境變數：LINEPAY_CHANNEL_ID / LINEPAY_CHANNEL_SECRET；
 * LINEPAY_SANDBOX=1 時打 sandbox。簽章：HMAC-SHA256(secret, secret + uri + body + nonce)。
 */

export function linepayConfig() {
  const enabled = Boolean(process.env.LINEPAY_CHANNEL_ID && process.env.LINEPAY_CHANNEL_SECRET);
  return {
    enabled,
    channelId: process.env.LINEPAY_CHANNEL_ID || "",
    secret: process.env.LINEPAY_CHANNEL_SECRET || "",
    base: process.env.LINEPAY_SANDBOX === "1" ? "https://sandbox-api-pay.line.me" : "https://api-pay.line.me",
  };
}

export function linepayEnabled(): boolean {
  return linepayConfig().enabled;
}

async function callLinePay(uri: string, payload: unknown): Promise<{ returnCode: string; returnMessage: string; info?: Record<string, unknown> }> {
  const { channelId, secret, base } = linepayConfig();
  const body = JSON.stringify(payload);
  const nonce = crypto.randomUUID();
  const sig = crypto.createHmac("sha256", secret).update(secret + uri + body + nonce).digest("base64");
  const res = await fetch(base + uri, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-LINE-ChannelId": channelId,
      "X-LINE-Authorization-Nonce": nonce,
      "X-LINE-Authorization": sig,
    },
    body,
    signal: AbortSignal.timeout(30_000),
  });
  /* 先取文字再解析：對方回 5xx 時 body 可能是 HTML，直接 json() 會拋
     SyntaxError，錯誤訊息與付款無關，事後完全查不出發生什麼事 */
  const text = await res.text();
  try {
    return JSON.parse(text) as { returnCode: string; returnMessage: string; info?: Record<string, unknown> };
  } catch {
    throw new Error(`LINE Pay 回應無法解析（HTTP ${res.status}）：${text.slice(0, 200)}`);
  }
}

/* 建立付款請求，回傳跳轉網址（web）；orderId 需唯一 */
export async function linepayRequest(opts: {
  orderId: string;
  amount: number;
  productName: string;
  confirmUrl: string;
  cancelUrl: string;
}): Promise<{ ok: boolean; paymentUrl?: string; transactionId?: string; msg: string }> {
  const r = await callLinePay("/v3/payments/request", {
    amount: opts.amount,
    currency: "TWD",
    orderId: opts.orderId,
    packages: [
      {
        id: "sponsor",
        amount: opts.amount,
        products: [{ name: opts.productName, quantity: 1, price: opts.amount }],
      },
    ],
    redirectUrls: { confirmUrl: opts.confirmUrl, cancelUrl: opts.cancelUrl },
  });
  if (r.returnCode === "0000" && r.info) {
    const info = r.info as { paymentUrl?: { web?: string }; transactionId?: number | string };
    return { ok: true, paymentUrl: info.paymentUrl?.web, transactionId: String(info.transactionId || ""), msg: "" };
  }
  console.error("[linepay] request 失敗", r.returnCode, r.returnMessage);
  void onLinePayFailure(r.returnCode, r.returnMessage).catch((e) => console.error("[linepay] 失敗處理", e));
  return { ok: false, msg: `${r.returnCode} ${r.returnMessage}` };
}

/*
 * 金鑰層級的錯誤（不是這一筆的問題，是每一筆都會失敗）：
 *   1101 商家未授權、1102 商家交易被拒、1104 找不到商家（金鑰或環境對不上）、1106 表頭資訊錯誤。
 * 實際發生過（2026-09-03）：正式站回 1104 Merchant not found，客人選 LINE Pay 一律失敗，
 * 站長是從客人的截圖才知道。所以這裡三件事：記下最後一次錯誤給後台看、自動把 LINE Pay 從
 * 兩邊的付款方式暫停（免得下一位客人再撞）、寄信給站長（一天最多一封）。
 * 站長修好金鑰後到網站設定重新打開就好。
 */
const CREDENTIAL_CODES = new Set(["1101", "1102", "1104", "1106"]);
async function onLinePayFailure(code: string, message: string): Promise<void> {
  const now = new Date();
  const stamp = now.toLocaleString("zh-TW", { timeZone: "Asia/Taipei", hour12: false });
  setSetting("linepay_last_error", `${stamp}｜${code} ${message}`);
  if (!CREDENTIAL_CODES.has(code)) return;
  setPayMethodOff("linepay", "shop", true);
  setPayMethodOff("linepay", "support", true);
  const day = now.toISOString().slice(0, 10);
  if (getSetting("linepay_fail_alerted", "") === day) return;
  setSetting("linepay_fail_alerted", day);
  try {
    const { sendMail, wrapOwnerMail } = await import("./mail");
    const to = getSetting("owner_notify_emails", "").split(/[,，;\s]+/).map((s) => s.trim()).filter((s) => s.includes("@"));
    if (to.length === 0) return;
    const sandbox = process.env.LINEPAY_SANDBOX === "1";
    const html = wrapOwnerMail(
      "LINE Pay 付款建立失敗，已自動暫停",
      `<p style="font-size:15px;line-height:2;">LINE Pay 回了 <b>${code} ${message}</b>（${stamp}）。這不是單一訂單的問題，是金鑰對不到商家，每一位選 LINE Pay 的客人都會失敗。</p>
       <p style="font-size:15px;line-height:2;">系統已經把 LINE Pay 從商店與贊助的付款方式暫停，客人現在只會看到 ATM 與信用卡。</p>
       <p style="font-size:13.5px;color:#8A7A6E;line-height:2;">要檢查的三件事：<br>
         1. Zeabur 的 LINEPAY_CHANNEL_ID／LINEPAY_CHANNEL_SECRET 是不是 LINE Pay 商家中心（pay.line.me）發的那組，不是 LINE Login 或 Messaging API 的。<br>
         2. 目前打的是<b>${sandbox ? "沙箱" : "正式"}</b>環境。沙箱金鑰只能配 LINEPAY_SANDBOX=1，正式金鑰不能設這個變數。<br>
         3. LINE Pay 商家申請是否已審核通過。審核中的商家在正式環境會回 1104。<br>
         修好之後到後台「網站設定」把 LINE Pay 重新勾回來。</p>`
    );
    for (const t of to) await sendMail(t, `LINE Pay 付款建立失敗（${code}），已自動暫停｜問爽的後台`, html, undefined, { kind: "owner" });
  } catch (e) {
    console.error("[linepay] 失敗通知信寄送失敗", e);
  }
}

/*
 * 連線探測：用目前的金鑰查一筆不存在的訂單。
 * 金鑰對的話 LINE 回 1150（查無交易），金鑰或環境錯回 1101／1102／1104／1106。
 * 不建立交易、不扣款，站長換完金鑰可以先按這個確認，不用真的下單去試。
 */
export type LinePayProbe = {
  ok: boolean; code: string; message: string; sandbox: boolean; enabled: boolean;
  /* 不洩密的格式線索：複製貼上夾到空白或換行、貼錯格，都在這裡看得出來 */
  shape: { idLen: number; idDigitsOnly: boolean; secretLen: number; hasWhitespace: boolean; base: string };
};
export async function linepayProbe(): Promise<LinePayProbe> {
  const raw = { id: process.env.LINEPAY_CHANNEL_ID || "", secret: process.env.LINEPAY_CHANNEL_SECRET || "" };
  const { base } = linepayConfig();
  const sandbox = process.env.LINEPAY_SANDBOX === "1";
  const shape = {
    idLen: raw.id.length, idDigitsOnly: /^\d+$/.test(raw.id), secretLen: raw.secret.length,
    hasWhitespace: /\s/.test(raw.id) || /\s/.test(raw.secret), base,
  };
  if (!linepayEnabled()) return { ok: false, code: "", message: "LINEPAY_CHANNEL_ID／LINEPAY_CHANNEL_SECRET 未設定", sandbox, enabled: false, shape };
  try {
    const r = await getLinePay("/v3/payments", `orderId=PROBE${Date.now().toString(36).toUpperCase()}`);
    const ok = r.returnCode === "0000" || r.returnCode === "1150";
    return { ok, code: r.returnCode, message: r.returnMessage, sandbox, enabled: true, shape };
  } catch (e) {
    return { ok: false, code: "", message: e instanceof Error ? e.message : String(e), sandbox, enabled: true, shape };
  }
}

/* GET 版簽章：HMAC-SHA256(secret, secret + uri + queryString + nonce)，queryString 不含問號 */
async function getLinePay(uri: string, query: string): Promise<{ returnCode: string; returnMessage: string; info?: unknown }> {
  const { channelId, secret, base } = linepayConfig();
  const nonce = crypto.randomUUID();
  const sig = crypto.createHmac("sha256", secret).update(secret + uri + query + nonce).digest("base64");
  const res = await fetch(`${base}${uri}?${query}`, {
    headers: {
      "X-LINE-ChannelId": channelId,
      "X-LINE-Authorization-Nonce": nonce,
      "X-LINE-Authorization": sig,
    },
    signal: AbortSignal.timeout(30_000),
  });
  const text = await res.text();
  try {
    return JSON.parse(text) as { returnCode: string; returnMessage: string; info?: unknown };
  } catch {
    throw new Error(`LINE Pay 回應無法解析（HTTP ${res.status}）：${text.slice(0, 200)}`);
  }
}

/*
 * 對帳用：依商店訂單編號查詢「已請款」的交易。
 * LINE Pay 的錢是 confirm 才真正扣走，所以查得到＝錢確實收到了。
 * 查不到（1150）代表顧客沒完成授權，或授權後我們沒請款成功、金額已自動失效。
 *
 * ── 一個尚未驗證的假設，刻意保留現狀 ──
 * 這裡把「查得到任何一筆」直接當成已付款，沒有檢查該筆交易的狀態。
 * 已退款的交易是否仍會出現在這個列表、退款又以哪個欄位表示，
 * 我在官方文件裡找不到明確定義，因此不做推論：憑猜測寫判斷比不判斷更危險，
 * TapPay 的 record_status 就是這樣出過事（把「非 0」一律當失敗，
 * 差點在顧客還在 3D 驗證時就取消他的訂單）。
 * 已知影響：已退款的贊助在對帳時可能被視為已付款。
 * 要修正得先向 LINE Pay 取得 /v3/payments 回傳項目的完整欄位定義。
 */
export async function linepayQueryByOrderId(orderId: string): Promise<{ found: boolean; transactionId: string; msg: string }> {
  try {
    const r = await getLinePay("/v3/payments", `orderId=${encodeURIComponent(orderId)}`);
    const list = Array.isArray(r.info) ? (r.info as { transactionId?: number | string }[]) : [];
    if (r.returnCode === "0000" && list.length > 0) {
      return { found: true, transactionId: String(list[0].transactionId || ""), msg: "" };
    }
    return { found: false, transactionId: "", msg: `${r.returnCode} ${r.returnMessage}` };
  } catch (e) {
    console.error("[linepay] 查詢失敗", orderId, e);
    return { found: false, transactionId: "", msg: e instanceof Error ? e.message : "unknown" };
  }
}

/*
 * 對帳用：查詢「付款請求」還能不能請款。
 * returnCode 0000 代表顧客已在 LINE 授權完成、但我們還沒請款——
 * 這種情況錢還在，補一次 confirm 就能收到（顧客授權完卻沒導回我們網站時會發生）。
 */
export async function linepayCheckRequest(transactionId: string): Promise<{ confirmable: boolean; msg: string }> {
  try {
    const r = await getLinePay(`/v3/payments/requests/${transactionId}/check`, "");
    return { confirmable: r.returnCode === "0000", msg: `${r.returnCode} ${r.returnMessage}` };
  } catch (e) {
    console.error("[linepay] check 失敗", transactionId, e);
    return { confirmable: false, msg: e instanceof Error ? e.message : "unknown" };
  }
}

/* 使用者在 LINE 完成授權後的請款確認 */
export async function linepayConfirm(transactionId: string, amount: number): Promise<{ ok: boolean; msg: string }> {
  const r = await callLinePay(`/v3/payments/${transactionId}/confirm`, { amount, currency: "TWD" });
  if (r.returnCode === "0000") return { ok: true, msg: "" };
  console.error("[linepay] confirm 失敗", transactionId, r.returnCode, r.returnMessage);
  return { ok: false, msg: `${r.returnCode} ${r.returnMessage}` };
}
