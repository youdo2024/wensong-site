import db, { getSetting } from "./db";
import { createHash } from "crypto";

/*
 * 寄件紀錄。
 *
 * 站長 2026-09-05 從後台「發送」頁寄了一封手寫信，問「我該在哪裡看到寄件資訊」，
 * 答案是哪裡都看不到：系統只記今天用了幾封 SMTP 額度，iCloud 的 SMTP 也不會把信留在寄件備份。
 * 所以全站信件出口（lib/mail.ts sendMail）每寄一封就往這裡記一筆，發送頁下面列出來，
 * 訂單頁「通知客人」區下面列該客人最近幾封。
 *
 * 五個種類的分法是給人看的，不是給程式用的：
 *   manual  手寫信（發送頁）——只有它存內容，回頭想看自己寫了什麼只有這裡有
 *   routine 客人例行信（訂單成立、付款完成、ATM、出貨、贊助感謝⋯⋯）
 *   remind  提醒引擎寄的（待付款提醒、失敗通知、扣款失敗）
 *   owner   營運通知：寄給站長自己（投稿、發票失敗、備份⋯⋯）或夥伴（出貨逾期提醒）的
 *   test    後台測試信
 * 發送頁預設把 owner 與 test 藏起來，它們本來就在站長信箱裡，混進來只會把客人的信推下去。
 */
export type MailKind = "manual" | "routine" | "remind" | "owner" | "test";
export const MAIL_KIND_LABEL: Record<MailKind, string> = {
  manual: "手寫信",
  routine: "客人例行信",
  remind: "提醒與失敗通知",
  owner: "營運通知",
  test: "測試信",
};
export const MAIL_KINDS = Object.keys(MAIL_KIND_LABEL) as MailKind[];

export type MailLogStatus = "sent" | "failed" | "skipped";
export const MAIL_STATUS_LABEL: Record<MailLogStatus, string> = { sent: "已寄出", failed: "失敗", skipped: "沒寄" };
export const MAIL_ROUTE_LABEL: Record<string, string> = { smtp: "iCloud", newsleopard: "電子豹", "": "" };

export type MailLogRow = {
  id: number; kind: MailKind; route: string; to_addr: string; subject: string;
  status: MailLogStatus; detail: string; ref_no: string; has_body: number; created_at: string;
};
const ROW_COLS = "id,kind,route,to_addr,subject,status,detail,ref_no,(body_hash<>'') has_body,created_at";

/* 留一年。每個程序一天清一次就夠，幾千筆的表不用更勤 */
export const MAIL_LOG_KEEP_DAYS = 365;
let lastPurgeDay = "";
function purgeOld(): void {
  const today = new Date().toISOString().slice(0, 10);
  if (lastPurgeDay === today) return;
  lastPurgeDay = today;
  try {
    const cutoff = new Date(Date.now() - MAIL_LOG_KEEP_DAYS * 86400_000).toISOString();
    db.prepare("DELETE FROM mail_log WHERE created_at < ?").run(cutoff);
    db.prepare("DELETE FROM mail_body WHERE NOT EXISTS (SELECT 1 FROM mail_log WHERE mail_log.body_hash = mail_body.hash)").run();
  } catch { /* 清不掉不影響寄信 */ }
}

export function logMail(r: {
  kind: MailKind; route?: string; to: string; subject: string; status: MailLogStatus;
  detail?: string; refNo?: string; body?: string;
}): number {
  try {
    purgeOld();
    const now = new Date().toISOString();
    /* 內容用 sha1 去重：同一封手寫信寄 60 人只存一份；每日備份夾著整個資料庫，不能讓它一年胖幾十 MB */
    let hash = "";
    if (r.body) {
      hash = createHash("sha1").update(r.body).digest("hex");
      db.prepare("INSERT OR IGNORE INTO mail_body (hash,html,created_at) VALUES (?,?,?)").run(hash, r.body, now);
    }
    /* 信箱存小寫：查詢直接等號比對，索引才用得上 */
    const info = db.prepare(
      "INSERT INTO mail_log (kind,route,to_addr,subject,status,detail,ref_no,body_hash,created_at) VALUES (?,?,?,?,?,?,?,?,?)",
    ).run(r.kind, r.route || "", String(r.to || "").trim().toLowerCase(), r.subject, r.status, r.detail || "", r.refNo || "", hash, now);
    return Number(info.lastInsertRowid);
  } catch (e) {
    /* 紀錄寫失敗只能記 log，絕不能讓信寄不出去 */
    console.error("[mail-log] 寫入失敗", e);
    return 0;
  }
}

/*
 * 副本設定：網站設定裡一格「副本信箱」加四個種類開關。
 * 信箱留空＝整個不副本；測試信永遠不副本。
 * 純函式，讓 smoke 測試能直接驗「哪種信該不該副本」。
 */
export type CopyPlan = { to: string; kinds: Record<MailKind, boolean> };
export const COPY_KIND_SETTING: Record<Exclude<MailKind, "test">, string> = {
  manual: "mail_copy_manual",
  remind: "mail_copy_remind",
  routine: "mail_copy_routine",
  owner: "mail_copy_owner",
};
export const COPY_KIND_DEFAULT: Record<Exclude<MailKind, "test">, boolean> = { manual: true, remind: true, routine: false, owner: false };

export function copyPlan(): CopyPlan {
  const to = getSetting("mail_copy_to", "").trim();
  const kinds = { test: false } as Record<MailKind, boolean>;
  for (const k of Object.keys(COPY_KIND_SETTING) as (keyof typeof COPY_KIND_SETTING)[]) {
    kinds[k] = getSetting(COPY_KIND_SETTING[k], COPY_KIND_DEFAULT[k] ? "1" : "0") === "1";
  }
  return { to, kinds };
}

/* 這封信要不要副本、副本寄去哪。收件人就是副本信箱時不副本（不然同一封收兩次） */
export function copyTarget(plan: CopyPlan, kind: MailKind, to: string): string {
  const addr = plan.to.trim();
  if (!addr || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addr)) return "";
  if (!plan.kinds[kind]) return "";
  if (addr.toLowerCase() === String(to || "").trim().toLowerCase()) return "";
  return addr;
}

/* 副本信最上面那一行：手寫信一次寄多人只副本一封，這行告訴站長寄給了誰 */
export function recipientsLine(list: string[]): string {
  const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
  const shown = list.slice(0, 60).map(esc).join("、");
  return `<div style="font-family:sans-serif;font-size:12px;line-height:1.8;color:#7C7060;background:#FBF6EA;border:1px solid #E3D3AC;padding:8px 12px;margin:0 0 12px;word-break:break-all;">`
    + `本次寄給：${shown}　共 ${list.length} 人（這一份是副本）</div>`;
}

/* ── 查詢 ── */

/* 分頁用「再看更多」把 limit 加大，不用 offset：三張表併起來排序，offset 會讓同一筆跨頁重複出現 */
export type MailLogQuery = { q?: string; showOwner?: boolean; showTest?: boolean; limit?: number };

/*
 * 發送頁的列表。手動簡訊與手動 LINE 已各自有 sms_log／line_log，這裡只讀不寫，
 * 併進同一張列表用同一種格式顯示，站長不用跑三個分頁找「我剛剛發了什麼」。
 */
export type SentRow = {
  key: string; src: "mail" | "sms" | "line"; id: number; created_at: string;
  kind: MailKind | "manual"; to: string; subject: string; status: "sent" | "failed" | "skipped";
  route: string; detail: string; ref_no: string; has_body: boolean;
};

export function listSent(q: MailLogQuery = {}): { rows: SentRow[]; more: boolean } {
  const limit = Math.max(1, Math.min(500, q.limit || 50));
  const kw = String(q.q || "").trim().toLowerCase();
  const hide: string[] = [];
  if (!q.showOwner) hide.push("owner");
  if (!q.showTest) hide.push("test");
  const where: string[] = [];
  const args: (string | number)[] = [];
  if (hide.length) { where.push(`kind NOT IN (${hide.map(() => "?").join(",")})`); args.push(...hide); }
  if (kw) { where.push("(to_addr LIKE ? OR lower(ref_no) LIKE ? OR lower(subject) LIKE ?)"); args.push(`%${kw}%`, `%${kw}%`, `%${kw}%`); }
  const w = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const mails = db.prepare(
    `SELECT ${ROW_COLS} FROM mail_log ${w} ORDER BY id DESC LIMIT ?`,
  ).all(...args, limit + 1) as MailLogRow[];

  const rows: SentRow[] = mails.map((m) => ({
    key: `m${m.id}`, src: "mail", id: m.id, created_at: m.created_at, kind: m.kind, to: m.to_addr, subject: m.subject,
    status: m.status, route: m.route, detail: m.detail, ref_no: m.ref_no, has_body: Boolean(m.has_body),
  }));

  /* 手動簡訊／LINE：只有搜尋字串對得上（電話、訂單編號）或沒在搜尋時才併進來 */
  try {
    const smsW = kw ? "AND (lower(phone) LIKE ? OR lower(content) LIKE ?)" : "";
    const sms = db.prepare(`SELECT id,phone,content,status,error,created_at FROM sms_log WHERE kind='manual' ${smsW} ORDER BY id DESC LIMIT ?`)
      .all(...(kw ? [`%${kw}%`, `%${kw}%`] : []), limit + 1) as { id: number; phone: string; content: string; status: string; error: string; created_at: string }[];
    for (const s of sms) rows.push({
      key: `s${s.id}`, src: "sms", id: s.id, created_at: s.created_at, kind: "manual", to: s.phone, subject: s.content,
      status: s.status === "sent" ? "sent" : "failed", route: "", detail: s.error || "", ref_no: "", has_body: false,
    });
    const lineW = kw ? "AND (lower(line_user_id) LIKE ? OR lower(order_no) LIKE ? OR lower(content) LIKE ?)" : "";
    const line = db.prepare(`SELECT id,line_user_id,order_no,content,status,error,created_at FROM line_log WHERE kind='manual' ${lineW} ORDER BY id DESC LIMIT ?`)
      .all(...(kw ? [`%${kw}%`, `%${kw}%`, `%${kw}%`] : []), limit + 1) as { id: number; line_user_id: string; order_no: string; content: string; status: string; error: string; created_at: string }[];
    for (const l of line) rows.push({
      key: `l${l.id}`, src: "line", id: l.id, created_at: l.created_at, kind: "manual", to: l.order_no || l.line_user_id, subject: l.content,
      status: l.status === "sent" ? "sent" : "failed", route: "", detail: l.error || "", ref_no: l.order_no || "", has_body: false,
    });
  } catch { /* 舊資料庫沒這兩張表也不能讓寄件紀錄整段消失 */ }

  rows.sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0));
  return { rows: rows.slice(0, limit), more: rows.length > limit };
}

/* 某位客人（信箱或訂單／贊助編號對得上）最近幾封 */
export function mailLogFor(who: { email?: string; refNo?: string }, limit = 10): MailLogRow[] {
  const email = String(who.email || "").trim().toLowerCase();
  const ref = String(who.refNo || "").trim();
  if (!email && !ref) return [];
  return db.prepare(
    `SELECT ${ROW_COLS} FROM mail_log WHERE (to_addr=? AND ?<>'') OR (ref_no=? AND ?<>'') ORDER BY id DESC LIMIT ?`,
  ).all(email, email, ref, ref, limit) as MailLogRow[];
}

export function mailLogById(id: number): (MailLogRow & { body: string }) | undefined {
  return db.prepare(
    `SELECT l.id,l.kind,l.route,l.to_addr,l.subject,l.status,l.detail,l.ref_no,(l.body_hash<>'') has_body,l.created_at,COALESCE(b.html,'') body
     FROM mail_log l LEFT JOIN mail_body b ON b.hash=l.body_hash WHERE l.id=?`,
  ).get(id) as (MailLogRow & { body: string }) | undefined;
}
