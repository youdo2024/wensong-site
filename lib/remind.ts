/*
 * 通知整合引擎（docs/notify-spec.md）。商品訂單與贊助共用同一套規則：
 *   從下單（或換方式那一輪起算點）起 10 分、12 小時、24 小時各提醒一次，48 小時判失敗。
 *   企業付款連結訂單維持 3 天／10 天，逾期照保留天數。
 *   有綁 LINE：信＋LINE；沒綁：信＋簡訊；每次都發。每則都給「繼續付款」與「重選付款方式」（簡訊只給前者）。
 *   晚上 10 點到早上 8 點：LINE 與簡訊排進 notify_queue 等早上 8 點；信照寄。
 *   全站暫停（notify_pause）、dry run（notify_dry_run：只記錄不寄，不推進序號）。
 *   每一次寄送都寫 notify_log，提醒中心靠它顯示。
 */
import db, { getSetting } from "./db";
import { sendMail, mailEnabled, mailBlocked, noticeMailHtml, siteUrl, itemRows, esc } from "./mail";
import { money } from "./format";
import { sendSms, smsReady } from "./sms";
import { findLineBinding, pushLine, composeLine, lineNotifyOn, lineInviteSmsLine } from "./line";
import { copyOf, renderCopy, type CopyEvent, type CopyVars } from "./notify-copy";
import { orderSupersededBy } from "./order-superseded";
import { emailLooksWrong } from "./email-typo";
import { isPayMethodOff } from "./shop";
import { payLinkByToken } from "./pay-link";
import { normalizePhone } from "./phone";
import { shortUrl, type ShortChannel } from "./short-link";

export type Kind = "order" | "sponsor";
export const STEP_OFFSETS_MIN = [10, 12 * 60, 24 * 60];   /* 三次提醒：下單後 10 分、12 時、24 時 */
export const FAIL_AFTER_MIN = 48 * 60;                     /* 48 小時判失敗（ATM 帳號效期同步 2 天） */
export const LINK_STEP_OFFSETS_MIN = [3 * 24 * 60, 10 * 24 * 60];
export const MAX_ROUNDS = 1;                               /* 換付款方式最多重算一次 */

export function notifyPaused(): boolean { return getSetting("notify_pause", "0") === "1"; }
export function notifyDryRun(): boolean { return getSetting("notify_dry_run", "0") === "1"; }
export function notifyLaunchAt(): string { return getSetting("notify_launch_at", ""); }

/* 台北時間的小時（0–23） */
function taipeiHour(d = new Date()): number { return (d.getUTCHours() + 8) % 24; }
/* 深夜（22:00–08:00）→ 回下一個台北 08:00 的 ISO；白天回空字串 */
export function quietUntil(d = new Date()): string {
  const h = taipeiHour(d);
  if (h >= 8 && h < 22) return "";
  const t = new Date(d.getTime() + 8 * 3600_000);
  const day = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate()));
  if (h >= 22) day.setUTCDate(day.getUTCDate() + 1);
  return new Date(day.getTime() + 8 * 3600_000 - 8 * 3600_000).toISOString(); /* 08:00 台北＝ 00:00 UTC */
}

export type Target = {
  kind: Kind; id: number; no: string; name: string; email: string; phone: string; total: number;
  created_at: string; round_started_at: string; remind_seq: number; remind_round: number; remind_stop: number;
  pay_method: string; pay_note: string; token: string; pay_link?: string; status: string;
  items?: string; address?: string; provider?: string; mode?: string;
  atm_bank?: string; atm_vaccount?: string; atm_expire?: string;
};

export function loadOrderTarget(id: number): Target | undefined {
  const o = db.prepare("SELECT * FROM orders WHERE id=?").get(id) as Record<string, unknown> | undefined;
  if (!o) return undefined;
  return {
    kind: "order", id, no: String(o.order_no), name: String(o.name || ""), email: String(o.email || ""), phone: String(o.phone || ""),
    total: Number(o.total || 0), created_at: String(o.created_at || ""), round_started_at: String(o.round_started_at || ""),
    remind_seq: Number(o.remind_seq || 0), remind_round: Number(o.remind_round || 0), remind_stop: Number(o.remind_stop || 0),
    pay_method: String(o.pay_method || ""), pay_note: String(o.pay_note || ""), token: String(o.token || ""), pay_link: String(o.pay_link || ""),
    status: String(o.status || ""), items: String(o.items || "[]"), address: String(o.address || ""),
  };
}
export function loadSponsorTarget(id: number): Target | undefined {
  const s = db.prepare("SELECT * FROM sponsorships WHERE id=?").get(id) as Record<string, unknown> | undefined;
  if (!s) return undefined;
  return {
    kind: "sponsor", id, no: `SP${id}`, name: String(s.display_name || ""), email: String(s.email || ""), phone: String(s.phone || ""),
    total: Number(s.amount || 0), created_at: String(s.created_at || ""), round_started_at: String(s.round_started_at || ""),
    remind_seq: Number(s.remind_seq || 0), remind_round: Number(s.remind_round || 0), remind_stop: Number(s.remind_stop || 0),
    pay_method: String(s.pay_method || ""), pay_note: String(s.last_charge_note || ""), token: String(s.pay_token || ""),
    status: String(s.status || ""), provider: String(s.provider || ""), mode: String(s.mode || ""),
    atm_bank: String(s.atm_bank || ""), atm_vaccount: String(s.atm_vaccount || ""), atm_expire: String(s.atm_expire || ""),
  };
}

/* 起算點：換過方式就從那一輪開始；舊單從上線那一刻開始（不追溯） */
export function baseTime(t: Target): number {
  const b = t.round_started_at ? Date.parse(t.round_started_at) : Date.parse(t.created_at);
  const launch = Date.parse(notifyLaunchAt() || "") || 0;
  return Math.max(b || 0, launch);
}
export function stepOffsets(t: Target): number[] { return t.kind === "order" && t.pay_link ? LINK_STEP_OFFSETS_MIN : STEP_OFFSETS_MIN; }
export function failAfterMin(t: Target): number {
  if (t.kind === "order" && t.pay_link) { const l = payLinkByToken(t.pay_link); return l ? Math.max(1, l.hold_days) * 24 * 60 : FAIL_AFTER_MIN; }
  return FAIL_AFTER_MIN;
}
/* 下一次自動提醒時間（ISO），沒有就空字串 */
export function nextRemindAt(t: Target): string {
  if (t.remind_stop || t.status !== "pending") return "";
  const offs = stepOffsets(t);
  if (t.remind_seq >= offs.length) return "";
  return new Date(baseTime(t) + offs[t.remind_seq] * 60_000).toISOString();
}
export function failAt(t: Target): string { return t.status === "pending" ? new Date(baseTime(t) + failAfterMin(t) * 60_000).toISOString() : ""; }

/* 同一人後來已付款成功：Email 或手機任一相同；商品看商品、贊助看贊助 */
export function supersededBy(t: Target): string {
  if (t.kind === "order") return orderSupersededBy({ id: t.id, email: t.email, name: t.name, phone: t.phone, pay_method: t.pay_method, pay_note: t.pay_note });
  const email = t.email.trim().toLowerCase();
  const phone = normalizePhone(t.phone);
  if (!email && !phone) return "";
  /*
   * 電話的清洗規則兩邊必須一樣。舊寫法 SQL 只拿掉 `-`、JS 這邊拿掉所有非數字，
   * 於是資料庫裡存成「0912 345 678」或「(02)2700-1234」的那些人永遠比不中：
   * 同一個人後來已經贊助成功了，系統照樣對他寄「你的支持還沒完成付款」，
   * 48 小時後再寄一封「付款失敗」。
   * SQL 沒辦法照 normalizePhone 清（全形數字、+886、分機都要處理），
   * 所以只用 email 那一路在 SQL 篩，電話那一路撈出候選在 JS 裡用同一支函式比對。
   * 範圍是「這筆成立之後才成功的贊助」，量很小；id 由大到小排，取到的是最新那筆。
   */
  const rows = db.prepare(
    `SELECT id, LOWER(TRIM(COALESCE(email,''))) email, COALESCE(phone,'') phone FROM sponsorships
     WHERE id<>? AND status IN ('paid','active') AND created_at>? ORDER BY id DESC LIMIT 500`
  ).all(t.id, t.created_at) as { id: number; email: string; phone: string }[];
  const hit = rows.find((r) => (email !== "" && r.email === email) || (phone !== "" && normalizePhone(r.phone) === phone));
  return hit ? `SP${hit.id}` : "";
}

/*
 * 兩條路：繼續付款（同一張單同一方式）、重選付款方式（感謝頁的換方式狀態）。
 *
 * channel 給了就換成站內短網址（lib/short-link.ts）。
 * 為什麼要分管道：同一條目的地，簡訊、Email、LINE 各拿一組碼，
 * 點擊數才分得出「這個人是從哪一則點進來的」，站長才判斷得出哪個管道有效。
 * 縮不成的時候 shortUrl 會原封不動回長網址，訊息照樣寄得出去。
 */
export function linksFor(t: Target, channel?: ShortChannel): { cont: string; choose: string } {
  const site = siteUrl();
  const wrap = (u: string) => (channel ? shortUrl(u, channel) : u);
  if (t.kind === "order") {
    return {
      cont: wrap(`${site}/api/orders/pay?no=${encodeURIComponent(t.no)}&t=${encodeURIComponent(t.token)}`),
      choose: wrap(`${site}/shop/thanks?no=${encodeURIComponent(t.no)}&k=${encodeURIComponent(t.token)}&pay=choose`),
    };
  }
  const cont = t.provider === "linepay"
    ? `${site}/api/linepay/request?sp=${t.id}&t=${encodeURIComponent(t.token)}`
    : t.provider === "ecpay" ? `${site}/support/pay/${t.id}?t=${encodeURIComponent(t.token)}` : `${site}/support`;
  return { cont: wrap(cont), choose: wrap(`${site}/support/thanks?mode=${t.mode || "once"}&pay=choose&sid=${t.id}&t=${encodeURIComponent(t.token)}`) };
}

function atmOf(t: Target): { bank: string; acct: string; expire: string } {
  if (t.kind === "sponsor") return { bank: t.atm_bank || "", acct: t.atm_vaccount || "", expire: t.atm_expire || "" };
  const m = /ATM 轉帳：(\S+)\s+(\d+)（([^）]*?) 前完成）/.exec(t.pay_note || "");
  return m ? { bank: m[1], acct: m[2], expire: m[3] } : { bank: "", acct: "", expire: "" };
}
function varsOf(t: Target): CopyVars {
  const a = atmOf(t);
  return { 姓名: t.name, 訂單編號: t.no, 金額: t.total, 期限: a.expire, 付款方式: t.pay_method, 帳號: a.acct, 銀行代碼: a.bank };
}

export type ChannelState = { mail: { ok: boolean; why: string }; line: { ok: boolean; why: string; uid?: string }; sms: { ok: boolean; why: string } };
export function channelsOf(t: Target): ChannelState {
  const mail = !t.email ? { ok: false, why: "沒留信箱" } : mailBlocked(t.email) ? { ok: false, why: "信箱已標記寄不到" }
    : emailLooksWrong(t.email) ? { ok: false, why: "信箱網域看起來打錯" } : !mailEnabled() ? { ok: false, why: "沒設定 SMTP" } : { ok: true, why: "" };
  const b = findLineBinding({ phone: t.phone, email: t.email });
  const line = !lineNotifyOn() ? { ok: false, why: "LINE 通知關著" } : !b ? { ok: false, why: "沒綁 LINE" }
    : b.status !== "bound" ? { ok: false, why: b.status === "blocked" ? "封鎖了官方帳號" : "沒加好友" } : { ok: true, why: "", uid: b.line_user_id };
  const phone = t.phone.replace(/\D/g, "");
  const ready = smsReady();
  const sms = !phone ? { ok: false, why: "沒留電話" } : !/^09\d{8}$/.test(phone) ? { ok: false, why: "不是手機號碼" } : !ready.ok ? { ok: false, why: ready.why } : { ok: true, why: "" };
  return { mail, line, sms };
}

function log(t: Target, event: string, channel: string, status: string, detail = ""): void {
  db.prepare("INSERT INTO notify_log (kind,ref_id,ref_no,event,channel,status,detail,created_at) VALUES (?,?,?,?,?,?,?,?)")
    .run(t.kind, t.id, t.no, event, channel, status, detail.slice(0, 300), new Date().toISOString());
}
function dryLogged(t: Target, event: string, channel: string): boolean {
  return Boolean(db.prepare("SELECT 1 FROM notify_log WHERE kind=? AND ref_id=? AND event=? AND channel=? AND status='dry' LIMIT 1").get(t.kind, t.id, event, channel));
}

function copyEvent(t: Target, event: string): CopyEvent {
  const p = t.kind === "order" ? "order_" : "sp_";
  return (p + event) as CopyEvent;
}

/*
 * 寄一則（remind1／remind2／remind3／failed／charge_fail／charge_pause／manual）。
 * channels 不給就照規則：信一定；有綁 LINE 推 LINE，否則簡訊。custom 給了就用站長自己的字。
 * 回每個管道的結果；dry run 只記錄。
 */
export type NoticeStatus = "sent" | "failed" | "skipped" | "dry" | "deferred";
export type NoticeResult = Record<string, { ok: boolean; why: string; status: NoticeStatus }>;

/*
 * 「這一輪每一個管道都是 skipped」。
 * skipped 與 failed 差在會不會變：failed 是這次沒寄成（SMTP 掛了、LINE 回錯），
 * 下一輪可能就通；skipped 是結構性的（信箱被標記寄不到、沒留手機、SMTP 根本沒設），
 * 下一輪一定還是 skipped。分不清楚這兩種的話，呼叫端會一直退回序號重試，
 * 每 5 分鐘替同一筆寫三列 notify_log，48 小時就是上千列。
 */
export function allSkipped(res: Record<string, { ok?: boolean; why?: string; status?: string }>): boolean {
  const v = Object.values(res);
  return v.length > 0 && v.every((x) => x.status === "skipped");
}
/* 至少一個管道真的送出去了（含 dry run 記錄與排進深夜佇列） */
export function anySent(res: Record<string, { ok?: boolean; why?: string; status?: string }>): boolean {
  return Object.values(res).some((x) => x.ok === true);
}

export async function sendNotice(
  t: Target, event: string,
  opt: { channels?: { mail?: boolean; line?: boolean; sms?: boolean }; custom?: { subject?: string; body?: string }; force?: boolean } = {}
): Promise<NoticeResult> {
  const ch = channelsOf(t);
  const want = opt.channels || { mail: true, line: ch.line.ok, sms: !ch.line.ok };
  const ev = copyEvent(t, event === "manual" ? "remind1" : event);
  const c = copyOf(ev);
  const v = varsOf(t);
  /* 每個管道各自拿一組短網址（點擊數要歸得了管道），所以這裡不再共用同一份連結 */
  const out: NoticeResult = {};
  const dry = notifyDryRun() && !opt.force;
  const subject = opt.custom?.subject?.trim() || renderCopy(c.subject, v);
  const p1 = opt.custom?.body?.trim() || renderCopy(c.p1, v);

  if (want.mail) {
    if (!ch.mail.ok) { out.mail = { ok: false, why: ch.mail.why, status: "skipped" }; log(t, event, "mail", "skipped", ch.mail.why); }
    else if (dry) { out.mail = { ok: true, why: "dry", status: "dry" }; if (!dryLogged(t, event, "mail")) log(t, event, "mail", "dry", subject); }
    else {
      const a = atmOf(t);
      const extra = a.acct
        ? `<p style="font-size:16px;line-height:2.2;border-left:3px solid #A87F2E;padding-left:14px;">銀行代碼 <b style="font-family:monospace">${esc(a.bank)}</b><br>帳號 <b style="font-family:monospace">${esc(a.acct)}</b><br>應付 <b>${money(t.total)}</b>${a.expire ? `<br>請於 ${esc(a.expire)} 前完成` : ""}</p>`
        : `<p style="font-size:14px;color:#7C7060;margin-top:6px;">${t.kind === "order" ? "訂單編號" : "支持編號"}　<b style="color:#B8402C;font-family:monospace;font-size:16px;">${esc(t.no)}</b>　金額　<b>${money(t.total)}</b></p>` +
          (t.kind === "order" && t.items ? `<table width="100%" style="border-top:2px solid #3A3226;margin-top:8px;">${itemRows(t.items)}</table>` : "");
      const buttons: { href: string; label: string; primary?: boolean }[] = [];
      const { cont, choose } = linksFor(t, "mail");
      const isCharge = event.startsWith("charge");
      if (isCharge) buttons.push({ href: `${siteUrl()}/support?mode=monthly`, label: c.btn || "重新設定每月支持", primary: true });
      else {
        if (c.btn) buttons.push({ href: cont, label: c.btn, primary: true });
        if (c.btn2) buttons.push({ href: choose, label: c.btn2 });
      }
      const html = noticeMailHtml({ title: subject.replace(/｜.*$/, ""), p1, buttons, extraHtml: extra });
      let ok = false;
      try { ok = await sendMail(t.email, subject, html, undefined, { kind: "remind", refNo: t.no }); } catch (e) { console.error("[notify] mail", t.no, e); }
      out.mail = { ok, why: ok ? "" : "寄信失敗", status: ok ? "sent" : "failed" };
      log(t, event, "mail", ok ? "sent" : "failed", subject);
    }
  }

  const pushText = (kind: "line" | "sms") => {
    const base = opt.custom?.body?.trim() || renderCopy(kind === "line" ? c.line : c.sms, v);
    if (event.startsWith("charge")) return { text: base, url: `${siteUrl()}/support?mode=monthly` };
    const { cont, choose } = linksFor(t, kind);
    if (kind === "line") return { text: `${base}\n繼續付款：${cont}\n重選付款方式：${choose}`, url: "" };
    return { text: base, url: cont };
  };
  const quiet = quietUntil();

  if (want.line) {
    if (!ch.line.ok) { out.line = { ok: false, why: ch.line.why, status: "skipped" }; log(t, event, "line", "skipped", ch.line.why); }
    else if (dry) { out.line = { ok: true, why: "dry", status: "dry" }; if (!dryLogged(t, event, "line")) log(t, event, "line", "dry", ""); }
    else if (quiet && !opt.force) { queue(t, event, "line", { text: pushText("line").text }, quiet); out.line = { ok: true, why: `延到早上 8 點`, status: "deferred" }; log(t, event, "line", "deferred", quiet); }
    else {
      const { text } = pushText("line");
      const r = await pushLine({ lineUserId: ch.line.uid!, text: composeLine(text), kind: event, orderNo: t.no });
      out.line = { ok: r.ok, why: r.ok ? "" : r.error || r.reason, status: r.ok ? "sent" : "failed" };
      log(t, event, "line", r.ok ? "sent" : "failed", r.ok ? "" : r.error || r.reason);
    }
  }
  if (want.sms) {
    if (!ch.sms.ok) { out.sms = { ok: false, why: ch.sms.why, status: "skipped" }; log(t, event, "sms", "skipped", ch.sms.why); }
    else if (dry) { out.sms = { ok: true, why: "dry", status: "dry" }; if (!dryLogged(t, event, "sms")) log(t, event, "sms", "dry", ""); }
    else if (quiet && !opt.force) { const p = pushText("sms"); queue(t, event, "sms", { text: p.text + (t.kind === "order" ? lineInviteSmsLine("not_bound", t.token, t.no) : ""), url: p.url }, quiet); out.sms = { ok: true, why: "延到早上 8 點", status: "deferred" }; log(t, event, "sms", "deferred", quiet); }
    else {
      const p = pushText("sms");
      const r = await sendSms({ phone: t.phone, body: p.text + (t.kind === "order" ? lineInviteSmsLine("not_bound", t.token, t.no) : ""), url: p.url, kind: event });
      out.sms = { ok: r.ok, why: r.ok ? "" : r.error, status: r.ok ? "sent" : "failed" };
      log(t, event, "sms", r.ok ? "sent" : "failed", r.ok ? "" : r.error);
    }
  }
  return out;
}

function queue(t: Target, event: string, channel: string, payload: unknown, dueAt: string): void {
  db.prepare("INSERT INTO notify_queue (kind,ref_id,event,channel,payload,due_at) VALUES (?,?,?,?,?,?)")
    .run(t.kind, t.id, event, channel, JSON.stringify(payload), dueAt);
}

/* 早上 8 點之後把深夜排進來的 LINE／簡訊送出去；那筆已經付了或取消了就丟掉 */
export async function flushQueue(): Promise<number> {
  if (notifyPaused()) return 0;
  const rows = db.prepare("SELECT * FROM notify_queue WHERE sent_at='' AND due_at<=? ORDER BY id LIMIT 50").all(new Date().toISOString()) as
    { id: number; kind: Kind; ref_id: number; event: string; channel: string; payload: string }[];
  let n = 0;
  for (const q of rows) {
    db.prepare("UPDATE notify_queue SET sent_at=? WHERE id=?").run(new Date().toISOString(), q.id);
    const t = q.kind === "order" ? loadOrderTarget(q.ref_id) : loadSponsorTarget(q.ref_id);
    if (!t) continue;
    const stillOwed = t.status === "pending" || q.event === "failed" || q.event.startsWith("charge");
    if (!stillOwed || t.remind_stop) { log(t, q.event, q.channel, "skipped", "早上要送時已經不需要了"); continue; }
    /*
     * payload 壞掉不能把整批沖掉。sent_at 在上面已經寫進去了，
     * 這裡一拋例外就直接離開整個 for，後面排隊的 LINE 與簡訊全部沒送，
     * 而且它們的 sent_at 還沒寫，下一輪又從這一筆壞的開始，等於永遠卡住。
     * 記一筆失敗、跳過這一列就好。
     */
    let p: { text?: string; url?: string } = {};
    try { p = JSON.parse(q.payload || "{}") as { text?: string; url?: string }; }
    catch (e) { console.error("[notify] queue payload 壞掉", q.id, e); log(t, q.event, q.channel, "failed", "佇列內容壞掉，已跳過"); continue; }
    const ch = channelsOf(t);
    try {
      if (q.channel === "line" && ch.line.ok) {
        const r = await pushLine({ lineUserId: ch.line.uid!, text: composeLine(p.text || ""), kind: q.event, orderNo: t.no });
        log(t, q.event, "line", r.ok ? "sent" : "failed", r.ok ? "早上補送" : r.error || r.reason);
      } else if (q.channel === "sms" && ch.sms.ok) {
        const r = await sendSms({ phone: t.phone, body: p.text || "", url: p.url, kind: q.event });
        log(t, q.event, "sms", r.ok ? "sent" : "failed", r.ok ? "早上補送" : r.error);
      } else log(t, q.event, q.channel, "skipped", "早上要送時管道不通");
      n++;
    } catch (e) { console.error("[notify] queue", q.id, e); }
  }
  return n;
}

/*
 * 自動提醒的一步：該寄第幾次就寄，寄了序號＋1。回 true 表示這一輪有寄（或 dry run 記錄了）。
 * 先搶佔序號再寄，對帳與手動同時跑不會寄兩次；真的寄失敗才退回序號，下一輪再試
 * （管道結構性不通的那種不退，否則每 5 分鐘重跑一次同一則）。
 */
export async function autoRemindStep(t: Target): Promise<boolean> {
  if (notifyPaused() || t.remind_stop || t.status !== "pending") return false;
  if (supersededBy(t)) return false;
  const offs = stepOffsets(t);
  const seq = t.remind_seq;
  if (seq >= offs.length) return false;
  if (Date.now() < baseTime(t) + offs[seq] * 60_000) return false;
  const event = `remind${seq + 1}`;
  if (notifyDryRun()) { await sendNotice(t, event); return true; }
  const table = t.kind === "order" ? "orders" : "sponsorships";
  const win = db.prepare(`UPDATE ${table} SET remind_seq=?, remind_at=?, remind_count=COALESCE(remind_count,0)+1 WHERE id=? AND status='pending' AND remind_seq=?`)
    .run(seq + 1, new Date().toISOString(), t.id, seq);
  if (win.changes === 0) return false;
  const r = await sendNotice({ ...t, remind_seq: seq + 1 }, event);
  if (anySent(r)) return true;
  if (allSkipped(r)) {
    /*
     * 每一個管道都是「本來就不會通」（信箱被標記寄不到又沒留手機、SMTP 沒設）。
     * 這種不能退回序號：對帳每 5 分鐘跑一次，退回去下一輪又走一次同樣的路，
     * 三個管道各記一列 notify_log，48 小時累積上千列，提醒中心整個被洗掉，
     * 而且不管重試幾次結果都一樣。序號照推、記一次就好。
     * 回 false 是誠實的：一則都沒寄出去，呼叫端不該報告「已寄出提醒」。
     */
    console.warn(`[notify] ${t.kind} ${t.no} 沒有任何可用管道，這一則只記錄不重試`);
    return false;
  }
  /* 真的試著寄但失敗（SMTP 掛了、LINE 回錯）：退回序號，下一輪再試 */
  db.prepare(`UPDATE ${table} SET remind_seq=?, remind_count=MAX(0,COALESCE(remind_count,0)-1) WHERE id=? AND remind_seq=?`).run(seq, t.id, seq + 1);
  return false;
}

/*
 * 逾期判定的單一時鐘（純算式，好測）。
 * 起算點一律是 baseTime：換過付款方式就從那一輪算起。
 * 對帳那邊以前另外用 created_at 算了一個 age 並聯，第 30 小時換方式的人
 * 會在新一輪走到一半、新的 ATM 帳號還活著的時候被取消，所以現在只留這一個。
 */
export function isStaleAt(baseMs: number, failMin: number, nowMs: number): boolean {
  return nowMs >= baseMs + failMin * 60_000;
}
/* 到了 48 小時（或付款連結的保留天數）沒付：回 true 讓呼叫端去取消／標失敗 */
export function shouldFail(t: Target): boolean {
  if (t.status !== "pending") return false;
  return isStaleAt(baseTime(t), failAfterMin(t), Date.now());
}

/* 換付款方式：重算一輪（最多一次）。手動提醒：算一次並重新計時 */
export function resetRound(kind: Kind, id: number): boolean {
  const table = kind === "order" ? "orders" : "sponsorships";
  const r = db.prepare(`UPDATE ${table} SET remind_round=remind_round+1, remind_seq=0, round_started_at=? WHERE id=? AND status='pending' AND remind_round<?`)
    .run(new Date().toISOString(), id, MAX_ROUNDS);
  return r.changes > 0;
}
export function countManualRemind(kind: Kind, id: number): void {
  const table = kind === "order" ? "orders" : "sponsorships";
  const t = kind === "order" ? loadOrderTarget(id) : loadSponsorTarget(id);
  if (!t) return;
  const offs = stepOffsets(t);
  const seq = Math.min(offs.length, t.remind_seq + 1);
  /* 下一次自動從現在起算：把起算點往回推到「現在減去這一步的位移」 */
  const base = seq >= offs.length ? Date.now() : Date.now() - offs[seq - 1] * 60_000;
  db.prepare(`UPDATE ${table} SET remind_seq=?, remind_count=COALESCE(remind_count,0)+1, remind_at=?, round_started_at=? WHERE id=?`)
    .run(seq, new Date().toISOString(), new Date(base).toISOString(), id);
}
export function setRemindStop(kind: Kind, id: number, stop: boolean): void {
  db.prepare(`UPDATE ${kind === "order" ? "orders" : "sponsorships"} SET remind_stop=? WHERE id=?`).run(stop ? 1 : 0, id);
}
export function setContacted(kind: Kind, id: number, on: boolean): void {
  db.prepare(`UPDATE ${kind === "order" ? "orders" : "sponsorships"} SET contacted_at=? WHERE id=?`).run(on ? new Date().toISOString() : "", id);
}

/* 失敗通知（贊助用；商品那條在 reconcile.mailFailedOrders 也改走 sendNotice） */
export async function notifySponsorFailed(id: number): Promise<boolean> {
  const t = loadSponsorTarget(id);
  if (!t || t.mode === "monthly") return false;
  if (supersededBy(t)) return false;
  if (notifyPaused()) return false;
  if (!notifyDryRun()) {
    const win = db.prepare("UPDATE sponsorships SET fail_mailed=1 WHERE id=? AND fail_mailed=0").run(id);
    if (win.changes === 0) return false;
  }
  const r = await sendNotice(t, "failed");
  return Boolean(r.mail?.ok || r.line?.ok || r.sms?.ok);
}

/* 定期定額扣款失敗：第一次通知，連續兩次暫停並通知；成功時歸零 */
export async function onMonthlyChargeFailed(id: number): Promise<void> {
  const row = db.prepare("SELECT charge_fail_count FROM sponsorships WHERE id=?").get(id) as { charge_fail_count: number } | undefined;
  if (!row) return;
  const n = (row.charge_fail_count || 0) + 1;
  db.prepare("UPDATE sponsorships SET charge_fail_count=? WHERE id=?").run(n, id);
  const t = loadSponsorTarget(id);
  if (!t || notifyPaused()) return;
  if (n >= 2) {
    db.prepare("UPDATE sponsorships SET status='paused', last_charge_note=? WHERE id=? AND status='active'").run(`連續 ${n} 期扣款失敗，已暫停（${new Date().toISOString().slice(0, 10)}）`, id);
    await sendNotice({ ...t, status: "paused" }, "charge_pause", { channels: { mail: true, line: true } });
  } else {
    await sendNotice(t, "charge_fail", { channels: { mail: true, line: true } });
  }
}
export function onMonthlyChargeOk(id: number): void {
  db.prepare("UPDATE sponsorships SET charge_fail_count=0 WHERE id=?").run(id);
}

/* 提醒中心用：最近一次寄送與紀錄 */
export function notifyLogFor(kind: Kind, id: number, limit = 20) {
  return db.prepare("SELECT * FROM notify_log WHERE kind=? AND ref_id=? ORDER BY id DESC LIMIT ?").all(kind, id, limit) as
    { id: number; event: string; channel: string; status: string; detail: string; created_at: string }[];
}

/* 手動用手機訊息 App 傳的簡訊草稿：跟系統會寄的同一則文案＋接續付款連結，不加署名（是站長自己的號碼） */
export function smsDraftFor(t: Target): { phone: string; text: string } {
  const event = t.status === "pending" ? `remind${Math.min(3, t.remind_seq + 1)}` : "failed";
  const c = copyOf(copyEvent(t, event));
  const { cont } = linksFor(t, "sms");
  return { phone: t.phone.replace(/\D/g, ""), text: `${renderCopy(c.sms, varsOf(t))}\n${cont}` };
}
/* 站長按了「用訊息 App」：記一筆、算一次手動提醒 */
export function markSmsApp(kind: Kind, id: number): void {
  const t = kind === "order" ? loadOrderTarget(id) : loadSponsorTarget(id);
  if (!t) return;
  const event = t.status === "pending" ? `remind${Math.min(3, t.remind_seq + 1)}` : "failed";
  log(t, event, "sms-app", "sent", "站長用手機訊息 App 傳");
  if (t.status === "pending") countManualRemind(kind, id);
}
