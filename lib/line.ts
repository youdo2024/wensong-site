import crypto from "crypto";
import db, { getSetting, setSetting } from "./db";
import { shortUrl } from "./short-link";

/*
 * LINE 官方帳號推播（Messaging API）。規格在 docs/line-notify-spec.md。
 *
 * 跟簡訊同一套原則：
 *   · 不假裝成功。金鑰沒設、額度用完、測試模式擋下、對方封鎖，都回明確的 reason 並記進 line_log。
 *   · 呼叫端拿到「不是 sent」就走原本的 Email 與簡訊，通知不會因為 LINE 而消失。
 *   · 每一則推播都留紀錄：推播要算額度，客人說沒收到時要查得出來。
 *
 * 綁定：一個 LINE userId 對一組手機加 email（line_bindings）。訂單要推播時先比手機再比 email。
 * userId 跟 LINE Developers 的 Provider 走，Messaging API 與 LINE Login 必須在同一個 Provider（已確認）。
 */

const SITE = () => (process.env.SITE_URL || "https://www.wensong.tw").replace(/\/$/, "");
/* LINE 文字訊息上限 5000 字，但通知沒必要長；比簡訊寬鬆就好 */
export const LINE_MAX_LEN = 600;

export function lineToken(): string { return (process.env.LINE_MESSAGING_ACCESS_TOKEN || "").trim(); }
export function lineSecret(): string { return (process.env.LINE_MESSAGING_CHANNEL_SECRET || "").trim(); }
/* 官方帳號 ID（@ 開頭），加好友連結用 */
export function lineOaId(): string { return (process.env.LINE_OA_ID || "").trim(); }
export function lineEnabled(): boolean { return Boolean(lineToken() && lineSecret()); }
/*
 * 總開關（站長 2026-09-03）：金鑰設好只代表「能」推，要不要對客人開放由後台網站設定決定。
 * 關著的時候：結帳勾選、感謝頁綁定區、信件與簡訊的邀請、會員中心 LINE 區、登入時加好友、所有推播都不做，
 * 通知維持 Email 加簡訊。webhook 照常收（有人自己加好友也不會壞），串接測完再打開。
 */
export function lineNotifyOn(): boolean { return lineEnabled() && getSetting("line_notify_on", "0") === "1"; }
/* LINE 登入時順便要 Email（站長 2026-09-03，預設開）。關掉就不要 email scope，也不在登入後追問 */
export function lineCollectEmail(): boolean { return getSetting("line_collect_email", "1") === "1"; }

/* webhook 簽章：HMAC-SHA256(channel secret, 原始 body) 的 base64，跟 X-Line-Signature 比對 */
export function verifyLineSignature(rawBody: string, signature: string, secret = lineSecret()): boolean {
  if (!secret || !signature) return false;
  const mac = crypto.createHmac("sha256", secret).update(rawBody).digest("base64");
  const a = Buffer.from(mac);
  const b = Buffer.from(signature);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/* ── 模板 ── */

export const LINE_KINDS = [
  { key: "atm", label: "繳費資訊（ATM／超商取號）" },
  { key: "paid", label: "付款完成" },
  { key: "shipped", label: "已出貨" },
  { key: "pending", label: "待付款提醒" },
  { key: "failed", label: "付款失敗" },
  { key: "sub_received", label: "收到投稿" },
  { key: "sub_accepted", label: "投稿採用" },
  { key: "bound", label: "綁定成功回覆" },
  { key: "bind_fail", label: "綁定失敗回覆" },
  { key: "noreply", label: "收到非訂單編號訊息的自動回覆" },
  { key: "bind_cap", label: "綁定次數達每日上限的回覆" },
  { key: "bind_taken", label: "訂單已被別的 LINE 綁走的回覆" },
] as const;
export type LineKind = (typeof LINE_KINDS)[number]["key"];

export const LINE_VARS = "{name} 收件人姓名｜{order} 訂單編號｜{total} 金額｜{info} 繳費資訊或出貨說明｜{title} 投稿標題";

const TPL_DEFAULT: Record<LineKind, string> = {
  atm: "{name} 你好，訂單 {order} 的繳費資訊：\n{info}\n應付金額 NT${total}。完成轉帳後訂單會自動變成已付款。",
  paid: "{name} 你好，訂單 {order} 已付款完成（NT${total}），謝謝你。出貨當天會再通知你。",
  shipped: "{name} 你好，訂單 {order} 已出貨。{info}",
  pending: "{name} 你好，訂單 {order}（NT${total}）還沒完成付款，點下面的連結可以直接接續，不用重填資料。",
  failed: "{name} 你好，訂單 {order} 的付款沒有成功，多半是發卡行擋下。點下面的連結可以換一種方式再試一次。",
  sub_received: "{name} 你好，收到你的投稿〈{title}〉了，謝謝。每一篇都會親自看過，適合的話會再聯絡你。",
  sub_accepted: "{name} 你好，你的投稿〈{title}〉已採用。稿費與後續細節已寄到你的 Email，請查收。",
  bound: "綁定完成。之後訂單 {order} 的付款與出貨進度會直接在這裡通知你。",
  bind_fail: "找不到這張訂單。請確認編號是 YD 開頭、跟確認信上的一樣；也可以到 {url} 查詢。",
  noreply: "這個帳號沒辦法一一回覆訊息，有問題請寫信到 hi@wensong.tw。\n要在 LINE 收訂單進度，傳訂單編號（YD 開頭）給我就可以綁定。",
  bind_cap: "今天綁定的訂單已達上限，明天再試，或寫信給我們。",
  bind_taken: "這張訂單已經綁定其他 LINE 帳號。如果那不是你，請寫信到 hi@wensong.tw。",
};

export function lineTemplate(kind: LineKind): string {
  return getSetting(`line_tpl_${kind}`, "").trim() || TPL_DEFAULT[kind];
}
export function lineTemplateDefault(kind: LineKind): string { return TPL_DEFAULT[kind]; }

/* 代入變數；找不到的換成空字串，不把 {name} 這種東西推給客人看 */
export function renderLine(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? "");
}

/* 組訊息：內文（開頭是對方名字）→ 連結。不加署名，官方帳號名稱聊天室本來就顯示 */
export function composeLine(body: string, url = ""): string {
  const tail = url ? `\n${url}` : "";
  const room = LINE_MAX_LEN - tail.length;
  const text = body.trim();
  const cut = text.length > room ? text.slice(0, Math.max(0, room - 1)) + "…" : text;
  return `${cut}${tail}`;
}

/* ── 連結 ── */

export function bindUrlFor(orderNo: string, token: string): string {
  return `${SITE()}/line/bind?no=${encodeURIComponent(orderNo)}&t=${encodeURIComponent(token)}`;
}
/* 贊助的綁定入口：用贊助編號＋付款權杖，同一條 /line/bind */
export function sponsorBindUrlFor(id: number, token: string): string {
  return `${SITE()}/line/bind?sp=${id}&t=${encodeURIComponent(token)}`;
}
/*
 * 簡訊用的短網址（268 字限制）。
 *
 * 舊制是 /l/<24 碼訂單權杖>，那條路照樣通（客人手機裡的舊簡訊還躺著），
 * 但新發的一律走 8 碼短網址，直接指到 /line/bind：
 * 少 16 個字元，也少一次轉址。拿不到訂單編號時退回舊制，不讓它變成錯誤。
 */
export function shortBindUrl(token: string, orderNo = ""): string {
  if (orderNo) return shortUrl(`${bindUrlFor(orderNo, token)}&src=sms`, "sms");
  return `${SITE()}/l/${encodeURIComponent(token)}`;
}
export function addFriendUrl(): string {
  return lineOaId() ? `https://line.me/R/ti/p/${encodeURIComponent(lineOaId())}` : "";
}
/* 客人在聊天室傳來的文字裡找訂單編號（YD 一般單、YG 贈品單） */
export function orderNoFromText(text: string): string {
  const m = /\bY[DG]\d{6,14}\b/i.exec(String(text || "").toUpperCase());
  return m ? m[0] : "";
}

/* 感謝頁（有權杖才看得到金額與繳費資訊）：付款完成與出貨通知的連結指這裡 */
export function orderStatusUrl(orderNo: string, token: string): string {
  return `${SITE()}/shop/thanks?no=${encodeURIComponent(orderNo)}&k=${encodeURIComponent(token)}`;
}

export type LineOrderLike = { order_no: string; name?: string; phone?: string; email?: string; total?: number; token?: string };

/* 簡訊補一行短網址邀請綁定：只給「沒綁過」的人，封鎖的人不要再推 */
export function lineInviteSmsLine(reason: LineReason, token?: string, orderNo = ""): string {
  if (!lineNotifyOn() || reason !== "not_bound" || !token) return "";
  return `\n用LINE收通知 ${shortBindUrl(token, orderNo)}`;
}

/* 信件裡的「用 LINE 收通知」按鈕：沒綁的人才顯示。用訂單編號查手機，email 只是備援 */
export function lineInviteHtml(o: { order_no: string; token?: string; email?: string }): string {
  if (!lineNotifyOn() || !o.token) return "";
  const row = db.prepare("SELECT phone FROM orders WHERE order_no=?").get(o.order_no) as { phone: string } | undefined;
  const b = findLineBinding({ phone: row?.phone, email: o.email });
  if (b && b.status === "bound") return "";
  const url = `${bindUrlFor(o.order_no, o.token)}&src=mail`;
  return `<div style="margin:22px 0 4px;padding:14px 16px;border:2px dashed #E3D3AC;text-align:center;">
    <p style="font-size:14px;line-height:1.9;margin:0 0 10px;">付款與出貨進度想直接在 LINE 收到？按一下就好，不用打字。</p>
    <a href="${url}" style="display:inline-block;padding:11px 24px;font-size:14.5px;letter-spacing:.06em;border:2px solid #06C755;background:#06C755;color:#fff;text-decoration:none;">用 LINE 收通知</a>
    <p style="font-size:12px;color:#7C7060;line-height:1.8;margin:10px 0 0;">綁定即同意用 LINE 接收訂單通知，封鎖官方帳號即取消。</p>
  </div>`;
}

/* ── 綁定 ──*/

export type LineBinding = {
  id: number; line_user_id: string; phone: string; email: string; user_id: number | null;
  status: string; source: string; order_no: string; created_at: string; updated_at: string; blocked_at: string;
};
const normPhone = (p?: string) => String(p || "").replace(/\D/g, "");
const normEmail = (e?: string) => String(e || "").trim().toLowerCase();

/* 訂單或會員要推播時用：先比手機、再比 email、再比會員 id。已綁定的優先 */
export function findLineBinding(q: { phone?: string; email?: string; userId?: number | null }): LineBinding | undefined {
  const phone = normPhone(q.phone), email = normEmail(q.email), uid = q.userId || 0;
  if (!phone && !email && !uid) return undefined;
  return db
    .prepare(
      `SELECT * FROM line_bindings
       WHERE (?<>'' AND phone=?) OR (?<>'' AND email=?) OR (?>0 AND user_id=?)
       ORDER BY (status='bound') DESC, updated_at DESC LIMIT 1`
    )
    .get(phone, phone, email, email, uid, uid) as LineBinding | undefined;
}

export function lineBindingByUser(lineUserId: string): LineBinding | undefined {
  return db.prepare("SELECT * FROM line_bindings WHERE line_user_id=?").get(lineUserId) as LineBinding | undefined;
}

/*
 * 寫入或更新綁定。同一個 userId 只有一列：新的手機、email、會員 id 有值就補上，
 * 狀態一律回到 bound（人家主動綁就是要收）。
 */
export function bindLine(inp: {
  lineUserId: string; phone?: string; email?: string; userId?: number | null; source: string; orderNo?: string;
}): LineBinding {
  const now = new Date().toISOString();
  const phone = normPhone(inp.phone), email = normEmail(inp.email);
  const cur = lineBindingByUser(inp.lineUserId);
  if (cur) {
    db.prepare(
      `UPDATE line_bindings SET phone=CASE WHEN ?<>'' THEN ? ELSE phone END,
         email=CASE WHEN ?<>'' THEN ? ELSE email END,
         user_id=COALESCE(?, user_id), status='bound', blocked_at='',
         order_no=CASE WHEN order_no='' THEN ? ELSE order_no END, updated_at=? WHERE id=?`
    ).run(phone, phone, email, email, inp.userId ?? null, inp.orderNo || "", now, cur.id);
  } else {
    db.prepare(
      "INSERT INTO line_bindings (line_user_id,phone,email,user_id,status,source,order_no,created_at,updated_at) VALUES (?,?,?,?,'bound',?,?,?,?)"
    ).run(inp.lineUserId, phone, email, inp.userId ?? null, inp.source, inp.orderNo || "", now, now);
  }
  return lineBindingByUser(inp.lineUserId)!;
}

/* 封鎖：webhook 收到 unfollow、或推播被拒。之後這個人直接走簡訊與 Email */
export function setLineBlocked(lineUserId: string, blocked: boolean): void {
  const now = new Date().toISOString();
  db.prepare("UPDATE line_bindings SET status=?, blocked_at=?, updated_at=? WHERE line_user_id=?")
    .run(blocked ? "blocked" : "bound", blocked ? now : "", now, lineUserId);
}

/*
 * ── 在聊天室打訂單編號綁定：三道保險（站長 2026-09-05 決定）──
 *
 * 風險：訂單編號是 YD ＋ 6 位日期 ＋ 4 位流水號，猜得到。
 * 原本 webhook 收到編號就直接 bindLine，沒有任何「這張單是不是你的」檢查，
 * 而 findLineBinding 是「已綁定的優先、updated_at 新的優先」，所以後綁的人會蓋掉先綁的人：
 * 攻擊者打別人的訂單編號，就能安靜地接收人家的付款、ATM、出貨通知，本人反而收不到。
 *
 * 站長 2026-09-05 決定：不加驗證碼，「打編號就綁」的方便一步都不能少。
 * 改成三道正常客人不會踩到的保險：
 *   1. 同一個 LINE 帳號每天（台北時間）最多綁 5 張，超過就請他明天再試或寫信。
 *   2. 這張訂單的手機或 email 已經對到「別的」LINE 帳號且狀態是 bound 時，一律不覆蓋。
 *   3. 每次成功綁定都寄一封信給訂單上的 email，本人沒操作就會知道並回信給我們解除。
 *
 * 殘留風險（明講，別以為補完了）：全新的 LINE 帳號每天仍可認領最多 5 張「還沒人綁」的訂單，
 * 只是每一張都會寄信通知本人，而且再也偷不走已經綁好的人。要真的堵死只能加驗證碼，站長不要。
 */

/* 每個 LINE 帳號每天可以用「打編號」綁幾張單 */
export const LINE_OA_BIND_DAILY_CAP = 5;

/* 台北當天 00:00 換算成 UTC 的 ISO 字串（line_log.created_at 存的是 UTC，要比就得換算） */
export function taipeiDayStartIso(nowMs: number = Date.now()): string {
  const tw = new Date(nowMs + 8 * 3600_000);
  return new Date(Date.UTC(tw.getUTCFullYear(), tw.getUTCMonth(), tw.getUTCDate()) - 8 * 3600_000).toISOString();
}

/*
 * 判斷這次「打編號」該怎麼處理。純函式，方便冒煙測試：
 *   existing = findLineBinding({ 訂單的手機, 訂單的 email }) 查到的那一列。
 *   · taken   別人已經綁走且狀態 bound → 不覆蓋
 *   · already 就是他自己且已經 bound → 什麼都不用做，回原本的「綁定完成」，也不計入每日上限、不再寄信
 *   · bind    其餘（沒人綁過、或他自己之前被封鎖要恢復）→ 照綁
 */
export type OaBindDecision = "bind" | "already" | "taken";
export function oaBindDecision(
  existing: { line_user_id: string; status: string } | undefined,
  lineUserId: string
): OaBindDecision {
  if (!existing || existing.status !== "bound") return "bind";
  return existing.line_user_id === lineUserId ? "already" : "taken";
}

/*
 * 每日上限用 line_log 數，不另外開欄位或 settings key：
 * line_bindings 同一個 userId 只有一列（bindLine 是 UPDATE），數不出「今天綁了幾張」；
 * settings 用 line_oa_bind_<uid>_<日期> 當 key 會在 settings 表留下永遠不會被清掉的垃圾列。
 * line_log 本來就是「這個 LINE 帳號做過什麼」的流水帳，後台看得到，也有既有的清理機制。
 * status 用 info，不會被 lineSentThisMonth（只數 status='sent'）算進推播額度。
 */
export function logOaBindAttempt(lineUserId: string, orderNo: string, outcome: "bound" | "taken"): void {
  log({
    lineUserId, orderNo, kind: "oa_bind", status: "info",
    content: outcome === "bound" ? `打編號綁定 ${orderNo}` : `打編號綁定被擋（已綁其他帳號）${orderNo}`,
  });
}

/* 今天（台北）這個 LINE 帳號用打編號綁過幾次。被擋下的也算，免得拿來當試單機器 */
export function oaBindCountToday(lineUserId: string, nowMs: number = Date.now()): number {
  return (db
    .prepare("SELECT COUNT(*) c FROM line_log WHERE kind='oa_bind' AND line_user_id=? AND created_at>=?")
    .get(lineUserId, taipeiDayStartIso(nowMs)) as { c: number }).c;
}

/* ── 紀錄、額度、測試模式 ── */

export type LineLog = {
  id: number; line_user_id: string; order_no: string; kind: string; content: string;
  status: string; error: string; created_at: string;
};

function log(row: { lineUserId: string; orderNo?: string; kind: string; content: string; status: string; error?: string }) {
  db.prepare("INSERT INTO line_log (line_user_id,order_no,kind,content,status,error,created_at) VALUES (?,?,?,?,?,?,?)")
    .run(row.lineUserId, row.orderNo || "", row.kind, row.content.slice(0, 1000), row.status, (row.error || "").slice(0, 300), new Date().toISOString());
}

/* webhook 事件紀錄（加好友、封鎖）：status=info 不算額度，讓後台看得到誰來了、userId 是什麼 */
export function lineEvent(lineUserId: string, kind: "follow" | "unfollow"): void {
  log({ lineUserId, kind, content: kind === "follow" ? "加好友" : "封鎖或刪除好友", status: "info" });
}

/* 站長在 LINE 官方帳號買的方案額度，系統看不到，由站長在網站設定維護 */
export function lineQuota(): number {
  return Math.max(0, Number(getSetting("line_quota_monthly", "200")) || 0);
}

/* 本月（台北時間）已推成功的則數。LINE 算的是「收件人數」，我們一則一人所以直接數 */
export function lineSentThisMonth(): number {
  const now = new Date();
  const tw = new Date(now.getTime() + 8 * 3600_000);
  const monthStartTw = new Date(Date.UTC(tw.getUTCFullYear(), tw.getUTCMonth(), 1) - 8 * 3600_000).toISOString();
  return (db.prepare("SELECT COUNT(*) c FROM line_log WHERE status='sent' AND created_at>=?").get(monthStartTw) as { c: number }).c;
}
export function lineQuotaLeft(): number { return Math.max(0, lineQuota() - lineSentThisMonth()); }

export function lineTestUserIds(): string[] {
  return getSetting("line_test_user_ids", "").split(/[\s,，]+/).map((s) => s.trim()).filter(Boolean);
}
export function lineTestMode(): boolean { return lineTestUserIds().length > 0; }

export function lineReady(): { ok: boolean; why: string } {
  if (!lineEnabled()) return { ok: false, why: "LINE Messaging API 金鑰未設定（LINE_MESSAGING_ACCESS_TOKEN／LINE_MESSAGING_CHANNEL_SECRET）" };
  if (lineQuotaLeft() <= 0) return { ok: false, why: `本月 LINE 額度已用完（${lineSentThisMonth()}／${lineQuota()}），已自動改走簡訊與 Email` };
  return { ok: true, why: "" };
}

/* ── 推播 ── */

export type LineReason = "sent" | "disabled" | "not_bound" | "blocked" | "test_mode" | "quota" | "failed";
export type LinePushResult = { ok: boolean; reason: LineReason; error: string };

async function api(path: string, body: unknown): Promise<{ ok: boolean; status: number; error: string }> {
  try {
    const r = await fetch(`https://api.line.me/v2/bot/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${lineToken()}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    if (r.ok) return { ok: true, status: r.status, error: "" };
    let msg = "";
    try { const d = (await r.json()) as { message?: string; details?: { message?: string }[] }; msg = [d.message, ...(d.details || []).map((x) => x.message)].filter(Boolean).join("; "); } catch { /* 沒有 JSON 就算了 */ }
    return { ok: false, status: r.status, error: `HTTP ${r.status} ${msg}`.trim() };
  } catch (e) {
    return { ok: false, status: 0, error: e instanceof Error ? e.message : String(e) };
  }
}

/* 額度跨過 75% 那天寄一封信給站長，一個月只寄一次 */
async function warnQuotaIfNeeded(): Promise<void> {
  const sent = lineSentThisMonth(), quota = lineQuota();
  if (quota <= 0 || sent < Math.ceil(quota * 0.75)) return;
  const tw = new Date(Date.now() + 8 * 3600_000);
  const key = `line_quota_warned_${tw.getUTCFullYear()}${String(tw.getUTCMonth() + 1).padStart(2, "0")}`;
  if (getSetting(key, "") === "1") return;
  setSetting(key, "1");
  try {
    const { sendMail, wrapOwnerMail } = await import("./mail");
    const to = getSetting("owner_notify_emails", "").split(/[,，;\s]+/).map((s) => s.trim()).filter((s) => s.includes("@"));
    if (to.length === 0) return;
    const html = wrapOwnerMail(
      "LINE 推播額度快用完了",
      `<p style="font-size:15px;line-height:2;">本月 LINE 已推 <b>${sent}</b> 則，方案額度 <b>${quota}</b> 則。</p>
       <p style="font-size:13.5px;color:#7C7060;line-height:2;">到達額度後系統會自動改走簡訊與 Email，通知不會消失，但簡訊要錢。
       要升級的話去 LINE 官方帳號後台改方案，改完到網站設定把「LINE 每月額度」改成新的數字。</p>`
    );
    for (const t of to) await sendMail(t, "LINE 推播額度快用完了｜問爽的後台", html, undefined, { kind: "owner" });
  } catch (e) {
    console.error("[line] 額度提醒信寄送失敗", e);
  }
}

/*
 * 推一則文字給一個人。回傳 reason 讓呼叫端決定要不要退回簡訊：
 * 只有 sent 代表對方收到了，其他一律當作沒送到。
 */
export async function pushLine(inp: { lineUserId: string; text: string; kind: string; orderNo?: string }): Promise<LinePushResult> {
  const base = { lineUserId: inp.lineUserId, orderNo: inp.orderNo, kind: inp.kind, content: inp.text };
  if (!lineEnabled()) {
    log({ ...base, status: "blocked", error: "金鑰未設定" });
    return { ok: false, reason: "disabled", error: "LINE 金鑰未設定" };
  }
  if (!lineNotifyOn()) {
    log({ ...base, status: "blocked", error: "LINE 通知總開關關閉" });
    return { ok: false, reason: "disabled", error: "LINE 通知總開關關閉（網站設定）" };
  }
  if (lineTestMode() && !lineTestUserIds().includes(inp.lineUserId)) {
    log({ ...base, status: "blocked", error: "測試模式：不在白名單" });
    return { ok: false, reason: "test_mode", error: "測試模式中，只推給白名單" };
  }
  if (lineQuotaLeft() <= 0) {
    log({ ...base, status: "blocked", error: "本月額度已用完" });
    return { ok: false, reason: "quota", error: "本月 LINE 額度已用完" };
  }
  const r = await api("message/push", { to: inp.lineUserId, messages: [{ type: "text", text: inp.text }] });
  if (r.ok) {
    log({ ...base, status: "sent" });
    void warnQuotaIfNeeded();
    return { ok: true, reason: "sent", error: "" };
  }
  /* 對方封鎖或根本沒加好友：標起來，之後直接走簡訊，不要每次都先失敗一次 */
  const blocked = r.status === 403 || /friend|block/i.test(r.error);
  if (blocked) setLineBlocked(inp.lineUserId, true);
  log({ ...base, status: "failed", error: r.error });
  return { ok: false, reason: blocked ? "blocked" : "failed", error: r.error };
}

/* 回覆訊息（webhook 事件內，免費、不算額度） */
export async function replyLine(replyToken: string, text: string): Promise<boolean> {
  if (!lineEnabled()) return false;
  const r = await api("message/reply", { replyToken, messages: [{ type: "text", text }] });
  if (!r.ok) console.error("[line] reply 失敗", r.error);
  return r.ok;
}

/*
 * 訂單事件的推播入口。找得到綁定且狀態是 bound 才推；回傳 reason 給呼叫端決定簡訊。
 * o 只要有訂單編號、姓名、手機、email、金額；info 是繳費資訊或出貨說明；url 放在最後一行。
 */
export async function notifyOrderLine(
  kind: LineKind,
  o: { order_no: string; name?: string; phone?: string; email?: string; total?: number },
  extra: { info?: string; url?: string } = {}
): Promise<LinePushResult & { binding?: LineBinding }> {
  if (!lineNotifyOn()) return { ok: false, reason: "disabled", error: "" };
  const b = findLineBinding({ phone: o.phone, email: o.email });
  if (!b) return { ok: false, reason: "not_bound", error: "" };
  if (b.status !== "bound") return { ok: false, reason: "blocked", error: "", binding: b };
  const text = composeLine(
    renderLine(lineTemplate(kind), {
      name: (o.name || "").trim(),
      order: o.order_no,
      total: String(o.total ?? ""),
      info: extra.info || "",
      url: extra.url || "",
      title: "",
    }),
    extra.url || ""
  );
  const r = await pushLine({ lineUserId: b.line_user_id, text, kind, orderNo: o.order_no });
  return { ...r, binding: b };
}

/* 投稿事件：投稿人是會員，用 email 或會員 id 對綁定 */
export async function notifySubmissionLine(
  kind: "sub_received" | "sub_accepted",
  s: { name: string; email: string; title: string; userId?: number | null }
): Promise<LinePushResult> {
  if (!lineNotifyOn()) return { ok: false, reason: "disabled", error: "" };
  const b = findLineBinding({ email: s.email, userId: s.userId });
  if (!b) return { ok: false, reason: "not_bound", error: "" };
  if (b.status !== "bound") return { ok: false, reason: "blocked", error: "" };
  const text = composeLine(renderLine(lineTemplate(kind), { name: s.name.trim(), title: s.title, order: "", total: "", info: "", url: "" }));
  return pushLine({ lineUserId: b.line_user_id, text, kind });
}

/* 後台顯示用：某張訂單目前對到誰 */
export function lineStatusForOrder(o: { phone?: string; email?: string }): { label: string; binding?: LineBinding } {
  const b = findLineBinding({ phone: o.phone, email: o.email });
  if (!b) return { label: "未綁定" };
  if (b.status === "blocked") return { label: "已封鎖官方帳號", binding: b };
  if (b.status === "nofriend") return { label: "登入了但沒加好友", binding: b };
  return { label: "已綁定", binding: b };
}
