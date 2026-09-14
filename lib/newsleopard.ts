import crypto from "crypto";
/*
 * 電子豹 SureNotify API v1（郵件與簡訊）。
 * 文件：https://newsleopard.com/surenotify/api/v1/
 *
 * 認證：header `x-api-key`。金鑰只從環境變數讀，程式碼與 git 裡永遠沒有它。
 *
 * ── 這支 API 做得到什麼、做不到什麼（實際讀完文件後的結論）──
 *
 * 做得到：寄信、寄簡訊、webhook 事件（到達／開信／點擊／退信／抱怨）、
 *         事件查詢（最近 30 天、單次最多 50 筆）、寄件網域驗證。
 *
 * 做不到：
 *   · 附件。/v1/messages 的欄位只有 subject／fromName／fromAddress／content／
 *     unsubscribedLink／recipients，沒有附件。所以每日備份那封（帶資料庫壓縮檔）
 *     一定要走 SMTP，不能改走這裡。
 *   · 電子報。這是交易信 API，不是 EDM。名單、分批、退訂連結、成效統計
 *     都得自己做，而且每次請求最多 100 個收件人。
 */

const BASE = "https://mail.surenotifyapi.com";

export function newsleopardKey(): string {
  return (process.env.NEWSLEOPARD_API_KEY || "").trim();
}

/* 寄件人。網域必須先在電子豹完成驗證，否則送達率會很差（Gmail 多半進垃圾桶） */
export function newsleopardFrom(): { address: string; name: string } {
  return {
    address: (process.env.NEWSLEOPARD_FROM || "").trim(),
    name: (process.env.NEWSLEOPARD_FROM_NAME || "問爽的 WenSong").trim(),
  };
}

/* 金鑰與寄件人都設好才算可用。少一個就退回 SMTP，不要半殘地寄出去 */
export function newsleopardEnabled(): boolean {
  return Boolean(newsleopardKey() && newsleopardFrom().address);
}

async function call(path: string, init: RequestInit = {}): Promise<{ ok: boolean; status: number; data: unknown }> {
  const res = await fetch(BASE + path, {
    ...init,
    headers: {
      "x-api-key": newsleopardKey(),
      Accept: "application/json",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(init.headers || {}),
    },
    /* 沒有逾時的話，對方慢的時候整個請求會一直掛著，而寄信多半發生在
       付款完成之後的關鍵路徑上 */
    signal: AbortSignal.timeout(30_000),
  });
  const text = await res.text();
  let data: unknown = text;
  try { data = JSON.parse(text); } catch { /* 對方回非 JSON（例如 502 的 HTML）就保留原文 */ }
  return { ok: res.ok, status: res.status, data };
}

export type SendResult = { ok: boolean; error: string };

/*
 * 寄一封信。
 *
 * 為什麼要看 failure 而不是只看 HTTP 狀態：這支 API 對「整批收下了，
 * 但其中某些收件人有問題」一樣回 200，錯誤放在 body 的 failure 物件裡。
 * 只看 200 的話，信箱格式錯誤會被當成寄成功，然後就再也沒有人知道。
 */
export async function sendEmail(inp: {
  to: string;
  toName?: string;
  subject: string;
  html: string;
  unsubscribeUrl?: string;
}): Promise<SendResult> {
  const from = newsleopardFrom();
  try {
    const r = await call("/v1/messages", {
      method: "POST",
      body: JSON.stringify({
        subject: inp.subject,
        fromName: from.name,
        fromAddress: from.address,
        content: inp.html,
        ...(inp.unsubscribeUrl ? { unsubscribedLink: inp.unsubscribeUrl } : {}),
        recipients: [{ name: inp.toName || inp.to, address: inp.to }],
      }),
    });
    if (!r.ok) {
      const d = r.data as { errors?: string; message?: string };
      return { ok: false, error: `HTTP ${r.status} ${d?.errors || d?.message || ""}`.trim() };
    }
    const d = r.data as { success?: unknown[]; failure?: Record<string, string> };
    const fail = d?.failure && Object.keys(d.failure).length ? d.failure : null;
    if (fail) return { ok: false, error: Object.entries(fail).map(([a, m]) => `${a}: ${m}`).join("; ") };
    if (!d?.success?.length) return { ok: false, error: "對方回應沒有成功名單" };
    return { ok: true, error: "" };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "unknown" };
  }
}

/* 一次請求的收件人上限，文件明訂 */
export const BATCH_MAX = 100;

/*
 * 批次寄送（電子報用）。一次最多 100 個收件人，這是文件寫死的上限。
 *
 * 回傳逐一收件人的結果，因為這支 API 會「整批收下、個別失敗」：
 * HTTP 200 但 failure 裡列著哪幾個沒寄成。呼叫端要能逐筆記錄，
 * 否則失敗的那幾位會被當成寄成功，永遠不會補寄。
 */
export async function sendEmailBatch(inp: {
  subject: string;
  html: string;
  recipients: { address: string; name?: string; variables?: Record<string, string> }[];
  unsubscribeUrl?: string;
}): Promise<{ ok: boolean; error: string; failed: Record<string, string> }> {
  const from = newsleopardFrom();
  if (inp.recipients.length === 0) return { ok: true, error: "", failed: {} };
  if (inp.recipients.length > BATCH_MAX)
    return { ok: false, error: `一次最多 ${BATCH_MAX} 位，這批有 ${inp.recipients.length} 位`, failed: {} };
  try {
    const r = await call("/v1/messages", {
      method: "POST",
      body: JSON.stringify({
        subject: inp.subject,
        fromName: from.name,
        fromAddress: from.address,
        content: inp.html,
        ...(inp.unsubscribeUrl ? { unsubscribedLink: inp.unsubscribeUrl } : {}),
        recipients: inp.recipients.map((x) => ({
          name: x.name || x.address,
          address: x.address,
          ...(x.variables ? { variables: x.variables } : {}),
        })),
      }),
    });
    if (!r.ok) {
      const d = r.data as { errors?: string; message?: string };
      return { ok: false, error: `HTTP ${r.status} ${d?.errors || d?.message || ""}`.trim(), failed: {} };
    }
    const d = r.data as { success?: unknown[]; failure?: Record<string, string> };
    return { ok: true, error: "", failed: d?.failure || {} };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "unknown", failed: {} };
  }
}

/*
 * 寄簡訊。
 *
 * 兩條 NCC 的規定寫在文件裡，違反就是寄不出去，所以記在這裡：
 *   1. 內容要清楚標示實名制身份（開頭或結尾加公司、品牌或活動名稱）
 *   2. 內容若含網址，要先向電信業者申請網域白名單
 * 另外內容上限 268 字元（超過對方會回 content length ... exceeds the limit 268）。
 */
export const SMS_MAX_LEN = 268;

export async function sendSms(inp: {
  to: string;               // 純數字，例如 0912345678
  content: string;
  countryCode?: string;     // 預設台灣
  aliveMins?: number;       // 5~480，重試期限
}): Promise<SendResult> {
  const to = inp.to.replace(/\D/g, "");
  if (!to) return { ok: false, error: "電話格式不符" };
  if (inp.content.length > SMS_MAX_LEN)
    return { ok: false, error: `簡訊內容 ${inp.content.length} 字，超過上限 ${SMS_MAX_LEN}` };
  try {
    const r = await call("/v1/sms/messages", {
      method: "POST",
      body: JSON.stringify({
        content: inp.content,
        ...(inp.aliveMins ? { alive_mins: Math.min(480, Math.max(5, inp.aliveMins)) } : {}),
        recipients: [{ address: to, country_code: inp.countryCode || "886" }],
      }),
    });
    if (!r.ok) {
      const d = r.data as { errors?: string; message?: string };
      return { ok: false, error: `HTTP ${r.status} ${d?.errors || d?.message || ""}`.trim() };
    }
    const d = r.data as { success?: unknown[]; failure?: Record<string, string> };
    const fail = d?.failure && Object.keys(d.failure).length ? d.failure : null;
    if (fail) return { ok: false, error: Object.entries(fail).map(([a, m]) => `${a}: ${m}`).join("; ") };
    if (!d?.success?.length) return { ok: false, error: "對方回應沒有成功名單" };
    return { ok: true, error: "" };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "unknown" };
  }
}

/* 寄件網域驗證：先 POST 拿 DNS 記錄去設，設好之後 PUT 驗證 */
export async function domainRecords(domain: string) {
  return call(`/v1/domains/${encodeURIComponent(domain)}`, { method: "POST" });
}
export async function verifyDomain(domain: string) {
  return call(`/v1/domains/${encodeURIComponent(domain)}`, { method: "PUT" });
}

/* ── Webhook ──
 * 事件代碼（郵件）：delivery 3、open 4、click 5、bounce 6、complaint 7
 * 事件代碼（簡訊）：delivery 3、bounce 6
 */
export const NL_EVENT = { delivery: 3, open: 4, click: 5, bounce: 6, complaint: 7 } as const;

/*
 * 驗簽。文件的步驟：把 body 的 id 與 event 串起來，
 * 以 API key 當金鑰做 HmacSHA256，跟 header 的 x-surenotify-signature 比對。
 *
 * 為什麼一定要驗：這個端點誰都能打，不驗的話任何人送一包
 * {"event":"bounce","to":"某個顧客"} 就能把那個人的信箱標記成寄不到，
 * 之後他再也收不到訂單通知——而且沒有人會發現。
 */
export function verifyWebhookSignature(id: string, event: string, signature: string): boolean {
  const key = newsleopardKey();
  if (!key || !signature) return false;
  const mac = crypto.createHmac("sha256", key).update(`${id}${event}`).digest("hex");
  /* 長度不同直接判否，再逐字比較（timingSafeEqual 要求等長） */
  const a = Buffer.from(mac);
  const b = Buffer.from(signature.toLowerCase());
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/* 註冊 webhook。同一個 type 重複註冊會覆蓋原本的網址（文件明講） */
export async function registerWebhook(type: number, url: string, sms = false) {
  return call(sms ? "/v1/sms/webhooks" : "/v1/webhooks", {
    method: "POST",
    body: JSON.stringify({ type, url }),
  });
}
export async function listWebhooks(sms = false) {
  return call(sms ? "/v1/sms/webhooks" : "/v1/webhooks");
}
