import db, { getSetting } from "./db";
import { sendSms as nlSendSms, SMS_MAX_LEN, newsleopardKey } from "./newsleopard";
import { shortUrl, type ShortChannel } from "./short-link";

/*
 * 簡訊。
 *
 * ── 兩條 NCC 規定，違反就是「寄不出去」，不是「寄了被擋」──
 *
 *   1. 內容必須清楚標示實名制身份（開頭或結尾加公司、品牌或活動名稱），
 *      而且那個名稱要先在電子豹申請並通過電信商審核（6~7 個工作天）。
 *   2. 內容若含網址，該網域要先申請白名單，同樣要電信商審核。
 *
 * 所以「送出付款連結」這種簡訊，在白名單通過之前一定寄不出去。
 * 這裡不假裝它會成功：smsReady() 沒過就直接回失敗並說明原因，
 * 讓後台看得到「還在等審核」而不是一直看到不明的錯誤。
 *
 * ── 長度 ──
 * 上限 268 字元，網址本身也算。組完一定要量，超過就截斷內文而不是截斷網址——
 * 半條網址等於整封簡訊白寄。
 */

export const SMS_LIMIT = SMS_MAX_LEN;

/* 實名制身份。要跟電子豹後台申請通過的那一個字串對得上 */
export function smsBrand(): string {
  return getSetting("sms_brand", "問爽的").trim();
}

/*
 * 署名，放在簡訊「最後一行」（站長指示 2026-09-01）。
 *
 * NCC 的規定原文是「可於開頭或結尾加註公司、品牌或活動名稱」，所以放結尾合規。
 * 但這一行就是實名制標示本身，空白等於整則不合規、會被電信商擋下，
 * 所以留空時退回用 smsBrand()，不讓它變成沒有標示的簡訊。
 */
export function smsSignature(): string {
  return getSetting("sms_signature", "問爽的 WenSong").trim() || smsBrand();
}

/* 可在後台改的內容模板。{變數} 由 renderSms 代入 */
export const SMS_VARS = "{name} 收件人姓名｜{order} 訂單編號｜{total} 金額｜{url} 連結";

/*
 * 待繳費提醒分三輪，語氣一輪比一輪明確。
 *
 * 站長 2026-09-07 指示：照他自己在「待提醒」手動傳的那套寫。那套的重點是
 * 第二次會說「再提醒一次」、第三次講明會自動取消而且不會扣到錢，
 * 而不是三次都寄同一句話——同一句話寄三次，看起來像機器人在盧，
 * 而講清楚「不會有任何費用」才是真正讓人願意回頭把單處理掉的那句。
 * 短網址讓內文空間從 58 字變成 121 字，這些話現在塞得下了。
 */
const TPL_DEFAULT: Record<string, string> = {
  pending: "{name} 你好，你的訂單 {order}（NT${total}）還沒完成付款。點下面的連結可以直接接續，資料不用重填。",
  pending2: "{name} 你好，再提醒一次，你的訂單 {order}（NT${total}）還沒完成付款。點下面的連結可以接續，或是換一種付款方式，資料都不用重填。",
  pending3: "最後一次提醒：{name} 你好，訂單 {order}（NT${total}）還沒完成付款，再過一陣子會自動取消，不會有任何費用。想完成的話點下面的連結，資料不用重填。",
  failed: "{name} 你好，訂單 {order} 的付款沒有成功，多半是發卡行擋下，這筆沒有扣款。點下面的連結可以換一種方式再試一次，資料不用重填。",
};

/* 第幾次提醒對到哪一個模板。第三次以後一律用最後一次的語氣 */
export function pendingTplKey(remindCount: number): "pending" | "pending2" | "pending3" {
  return remindCount <= 0 ? "pending" : remindCount === 1 ? "pending2" : "pending3";
}

export type SmsTplKind = "pending" | "pending2" | "pending3" | "failed";

export function smsTemplate(kind: SmsTplKind): string {
  return getSetting(`sms_tpl_${kind}`, "").trim() || TPL_DEFAULT[kind];
}

export function smsTemplateDefault(kind: SmsTplKind): string {
  return TPL_DEFAULT[kind];
}

/* 代入變數。找不到的變數換成空字串，不要把 {name} 這種東西寄出去給客人看 */
export function renderSms(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? "");
}

/* 站長在後台確認白名單已通過才打開。程式無從得知電信商審過了沒 */
export function smsWhitelistOk(): boolean {
  return getSetting("sms_whitelist_ok", "0") === "1";
}

export function smsReady(): { ok: boolean; why: string } {
  if (!newsleopardKey()) return { ok: false, why: "電子豹金鑰未設定" };
  if (!smsBrand()) return { ok: false, why: "還沒設定實名制身份" };
  if (!smsWhitelistOk())
    return { ok: false, why: "簡訊白名單尚未通過（後台網站設定確認通過後才會開啟）" };
  return { ok: true, why: "" };
}

/*
 * 組簡訊。順序是站長定的：內文（開頭是對方名字）→ 連結 → 署名。
 *
 * 署名固定加在最後一行，站長不用在模板裡自己打——忘記打的那一則
 * 就是不合規的那一則，而那件事要等電信商擋下來才會發現。
 *
 * 超過長度時截的是內文，網址與署名完整保留：
 * 半條網址等於整則白寄，沒有署名等於整則被擋，兩個都照樣扣錢。
 */
export function composeSms(body: string, url = ""): string {
  const sign = `\n${smsSignature()}`;
  const tail = url ? `\n${url}` : "";
  const room = SMS_LIMIT - sign.length - tail.length;
  const text = body.trim();
  const cut = text.length > room ? text.slice(0, Math.max(0, room - 1)) + "…" : text;
  return `${cut}${tail}${sign}`;
}

export type SmsLog = {
  id: number; phone: string; content: string; kind: string;
  status: string; error: string; created_at: string;
};

/*
 * 寄一則並留紀錄。
 *
 * 為什麼一定要記：簡訊是要錢的，而且看不到「寄件備份」。
 * 沒有紀錄的話，客人說沒收到，你連自己有沒有寄過都查不出來。
 */
export async function sendSms(inp: {
  phone: string;
  body: string;
  url?: string;
  kind?: string;      // pending / failed / manual
}): Promise<{ ok: boolean; error: string }> {
  const phone = String(inp.phone || "").replace(/\D/g, "");
  const content = composeSms(inp.body, inp.url);
  const now = new Date().toISOString();
  const log = (status: string, error: string) =>
    db.prepare("INSERT INTO sms_log (phone,content,kind,status,error,created_at) VALUES (?,?,?,?,?,?)")
      .run(phone, content, inp.kind || "manual", status, error.slice(0, 300), now);

  if (!/^09\d{8}$/.test(phone)) {
    log("failed", "手機號碼格式不對");
    return { ok: false, error: "手機號碼格式不對（09 開頭 10 碼）" };
  }
  const ready = smsReady();
  if (!ready.ok) {
    log("blocked", ready.why);
    return { ok: false, error: ready.why };
  }

  const r = await nlSendSms({ to: phone, content, aliveMins: 60 });
  log(r.ok ? "sent" : "failed", r.error);
  return r;
}

/* ── 模板 ── */

const SITE = () => (process.env.SITE_URL || "https://www.wensong.tw").replace(/\/$/, "");

export function payUrlFor(orderNo: string, token: string): string {
  return `${SITE()}/api/orders/pay?no=${encodeURIComponent(orderNo)}&t=${encodeURIComponent(token)}`;
}

/*
 * 同一條付款連結的短網址版。
 *
 * 為什麼不直接改 payUrlFor：那支是「這張單的付款網址」的唯一定義，
 * 後台的預覽、按鈕、複製欄都拿它；短網址是「要送進訊息裡」時才需要的東西，
 * 而且要記管道（誰點的算誰的）。兩件事分開，縮不成的時候也只是退回長網址。
 */
export function payShortUrl(orderNo: string, token: string, channel: ShortChannel = "sms"): string {
  return shortUrl(payUrlFor(orderNo, token), channel);
}

/* 待繳費提醒 */
export function pendingSms(o: { order_no: string; total: number; name?: string; remind_count?: number }): string {
  return renderSms(smsTemplate(pendingTplKey(o.remind_count ?? 0)), {
    name: (o.name || "").trim(),
    order: o.order_no,
    total: String(o.total),
  });
}

/* 付款失敗 */
export function failedSms(o: { order_no: string; name?: string }): string {
  return renderSms(smsTemplate("failed"), { name: (o.name || "").trim(), order: o.order_no });
}
