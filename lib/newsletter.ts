import crypto from "crypto";
import db, { getSetting, setSetting } from "./db";
import { buildAdminMail } from "./admin-mail";
import { sendEmailBatch, newsleopardEnabled, BATCH_MAX } from "./newsleopard";
import { mailBlocked } from "./mail";

/*
 * 電子報。
 *
 * 為什麼要自己蓋：電子豹的 SureNotify 是交易信 API，沒有電子報／名單／退訂那一套
 * （文件裡只有 messages／webhooks／events／domains 四組端點）。
 * 所以名單快照、分批、退訂連結、寄送紀錄都得在這裡做。
 *
 * 三個設計上的取捨，都是為了「寄一半掛掉不會出事」：
 *
 *   1. 按下寄送時先把收件名單「快照」進 newsletter_sends。
 *      不這樣做的話，寄到一半有人訂閱，他會收到後半段開始的信；
 *      有人退訂，我們卻已經寄給他了。名單必須在按下去那一刻固定。
 *
 *   2. newsletter_sends 有 UNIQUE(newsletter_id, email)。
 *      這是「重跑不會重寄」的關鍵——排程重啟、伺服器重新部署、
 *      站長手滑按兩次，都不會讓同一個人收到第二封。
 *
 *   3. 一次只推一批（100 封，API 上限），推完就結束這一輪。
 *      不在一個請求裡把幾千封寄完：那會逾時，而逾時的當下
 *      我們不知道已經寄到第幾封。
 */

const SITE = () => (process.env.SITE_URL || "https://www.wensong.tw").replace(/\/$/, "");

/* 退訂憑證。用亂數而不是 email：email 可枚舉，任何人都能退掉別人的訂閱 */
export function unsubTokenFor(email: string): string {
  const e = email.trim().toLowerCase();
  const row = db.prepare("SELECT unsub_token FROM subscribers WHERE email=?").get(e) as { unsub_token: string } | undefined;
  if (row?.unsub_token) return row.unsub_token;
  const t = crypto.randomBytes(16).toString("hex");
  db.prepare("UPDATE subscribers SET unsub_token=? WHERE email=?").run(t, e);
  return t;
}

export function unsubUrl(email: string): string {
  return `${SITE()}/unsubscribe?t=${unsubTokenFor(email)}`;
}

/*
 * 這條權杖認不認得（只讀，不改任何東西）。
 *
 * 退訂改成「先問一次再退」之後需要它：GET 進來只負責畫確認畫面，
 * 畫之前得知道要畫「按這裡退訂」還是「這條連結無效」，但那一刻絕對不能動到名單。
 */
export function unsubTokenValid(token: string): boolean {
  const t = String(token || "").trim();
  if (!/^[a-f0-9]{32}$/.test(t)) return false;
  return Boolean(db.prepare("SELECT 1 FROM subscribers WHERE unsub_token=?").get(t));
}

/* 退訂。找不到權杖就當作沒這回事（不告訴對方存不存在） */
export function unsubscribeByToken(token: string): boolean {
  const t = String(token || "").trim();
  if (!/^[a-f0-9]{32}$/.test(t)) return false;
  const r = db
    .prepare("UPDATE subscribers SET unsubscribed_at=? WHERE unsub_token=? AND COALESCE(unsubscribed_at,'')=''")
    .run(new Date().toISOString(), t);
  /* 已經退訂過的也回 true：對使用者來說結果一樣，不要讓他以為失敗又按一次 */
  if (r.changes > 0) return true;
  const exists = db.prepare("SELECT 1 FROM subscribers WHERE unsub_token=?").get(t);
  return Boolean(exists);
}

export type Newsletter = {
  id: number; subject: string; title: string; body: string;
  btn_text: string; btn_url: string; status: string;
  created_at: string; started_at: string; finished_at: string;
};

export function getNewsletter(id: number): Newsletter | undefined {
  return db.prepare("SELECT * FROM newsletters WHERE id=?").get(id) as Newsletter | undefined;
}

/* unsubscribeUrl 預設是電子豹的變數佔位 {{unsub}}，寄送時逐位收件人代入自己的退訂網址 */
export const UNSUB_VAR = "{{unsub}}";
export function newsletterHtml(n: Newsletter, unsubscribeUrl: string = UNSUB_VAR): string {
  return buildAdminMail({ title: n.title, body: n.body, btnText: n.btn_text, btnUrl: n.btn_url, unsubscribeUrl });
}

/* 目前有幾個可寄的訂閱者：沒退訂、且不在「寄不到」名單裡 */
export function audienceCount(): number {
  const rows = db.prepare("SELECT email FROM subscribers WHERE COALESCE(unsubscribed_at,'')=''").all() as { email: string }[];
  return rows.filter((r) => !mailBlocked(r.email)).length;
}

/*
 * 開始寄送：把名單快照進 newsletter_sends，狀態改成 sending。
 * 回傳這次排進去幾位。已經是 sending／sent 的不重複快照。
 */
export function startNewsletter(id: number): { ok: boolean; queued: number; msg: string } {
  const n = getNewsletter(id);
  if (!n) return { ok: false, queued: 0, msg: "找不到這封電子報" };
  if (n.status === "sending") return { ok: false, queued: 0, msg: "這封正在寄送中" };
  if (n.status === "sent") return { ok: false, queued: 0, msg: "這封已經寄完了" };
  if (!newsleopardEnabled()) return { ok: false, queued: 0, msg: "電子豹尚未設定（NEWSLEOPARD_API_KEY／NEWSLEOPARD_FROM）" };

  const subs = db
    .prepare("SELECT email,name FROM subscribers WHERE COALESCE(unsubscribed_at,'')='' ORDER BY id")
    .all() as { email: string; name: string }[];
  /* 「寄不到」名單在這裡就濾掉，不要排進佇列之後再一封封失敗 */
  const list = subs.filter((s) => s.email.includes("@") && !mailBlocked(s.email));
  if (list.length === 0) return { ok: false, queued: 0, msg: "沒有可寄送的訂閱者" };

  const ins = db.prepare(
    "INSERT INTO newsletter_sends (newsletter_id,email,name,status) VALUES (?,?,?,'pending') ON CONFLICT(newsletter_id,email) DO NOTHING"
  );
  const tx = db.transaction((rows: { email: string; name: string }[]) => {
    for (const r of rows) ins.run(id, r.email.trim().toLowerCase(), r.name || "");
    db.prepare("UPDATE newsletters SET status='sending', started_at=? WHERE id=?")
      .run(new Date().toISOString(), id);
  });
  tx(list);
  return { ok: true, queued: list.length, msg: `已排入 ${list.length} 位收件人` };
}

export function newsletterProgress(id: number): { total: number; sent: number; failed: number; pending: number } {
  const row = db
    .prepare(
      `SELECT COUNT(*) total,
              SUM(status='sent') sent,
              SUM(status='failed') failed,
              SUM(status IN ('pending','sending')) pending
       FROM newsletter_sends WHERE newsletter_id=?`
    )
    .get(id) as { total: number; sent: number; failed: number; pending: number };
  return { total: row.total || 0, sent: row.sent || 0, failed: row.failed || 0, pending: row.pending || 0 };
}

/*
 * 認領逾時多久算「那一輪已經死了」。
 *
 * 電子豹的 API 逾時是 30 秒，加上重試與資料庫寫入，一輪最壞情況是分鐘級；
 * 10 分鐘遠大於它，所以只有真的當掉（部署中斷、行程被砍）才會被放回待寄。
 * 放回去也不會重寄成功的那些：UNIQUE(newsletter_id,email) 管的是名單，
 * 而狀態已經是 sent 的列不在這條 UPDATE 的範圍內。
 */
export const CLAIM_STALE_MS = 10 * 60_000;

/* 認領逾時的分界線。純函式，好測 */
export function staleClaimCutoff(nowMs: number = Date.now()): string {
  return new Date(nowMs - CLAIM_STALE_MS).toISOString();
}

/* 卡在 sending 太久的放回待寄。sent_at 是 ISO 字串，字典序就是時間序，可以直接比 */
export function requeueStaleClaims(id: number, nowMs: number = Date.now()): number {
  const r = db
    .prepare("UPDATE newsletter_sends SET status='pending' WHERE newsletter_id=? AND status='sending' AND sent_at < ?")
    .run(id, staleClaimCutoff(nowMs));
  if (r.changes > 0) console.log(`[newsletter] ${r.changes} 封卡在寄送中超過 10 分鐘，放回待寄`);
  return r.changes;
}

/*
 * 推一批（最多 100 封）。回傳這一批處理了幾封。
 * 沒有待寄、也沒有別人在寄的，就把電子報標成 sent。
 */
export async function pushBatch(id: number): Promise<number> {
  const n = getNewsletter(id);
  if (!n || n.status !== "sending") return 0;

  /* 上一輪寄到一半掛掉的先撿回來，不然那些人永遠收不到 */
  requeueStaleClaims(id);

  /*
   * 先認領再寄（2026-09-05）。
   *
   * 原本是「選出 100 封 → 呼叫 API → 回來才改狀態」，中間那段時間這 100 列
   * 還是 pending。電子豹慢一點（逾時設 30 秒，排程 20 秒一輪）下一輪就會選到
   * 同一批，同一個人收到兩封。改成在同一個交易裡把它們標成 sending，
   * 別人再選就選不到；當掉留下的 sending 由上面那支放回待寄。
   */
  const claimedAt = new Date().toISOString();
  const claim = db.transaction(() => {
    const rows = db
      .prepare("SELECT id,email,name FROM newsletter_sends WHERE newsletter_id=? AND status='pending' ORDER BY id LIMIT ?")
      .all(id, BATCH_MAX) as { id: number; email: string; name: string }[];
    const mark = db.prepare("UPDATE newsletter_sends SET status='sending', sent_at=? WHERE id=? AND status='pending'");
    for (const r of rows) mark.run(claimedAt, r.id);
    return rows;
  });
  const batch = claim();

  if (batch.length === 0) {
    /* 還有別人正在寄的就先別收工，等那一輪回來（或逾時被放回待寄） */
    const inflight = (db
      .prepare("SELECT COUNT(*) c FROM newsletter_sends WHERE newsletter_id=? AND status='sending'")
      .get(id) as { c: number }).c;
    if (!inflight)
      db.prepare("UPDATE newsletters SET status='sent', finished_at=? WHERE id=? AND status='sending'")
        .run(new Date().toISOString(), id);
    return 0;
  }

  /*
   * 退訂連結逐人不同。電子豹的 unsubscribedLink 是整批一個值（進收件軟體的標題列），
   * 所以那裡放站上的退訂入口（沒帶權杖的頁面會請對方留信箱、寄專屬連結給他）；
   * 信件最底下那行則用 {{unsub}} 佔位，逐位收件人用 variables 代入自己的權杖連結。
   */
  const html = newsletterHtml(n);
  const r = await sendEmailBatch({
    subject: n.subject,
    html,
    recipients: batch.map((b) => ({ address: b.email, name: b.name || b.email, variables: { unsub: unsubUrl(b.email) } })),
    unsubscribeUrl: `${SITE()}/unsubscribe`,
  });

  const now = new Date().toISOString();
  const okStmt = db.prepare("UPDATE newsletter_sends SET status='sent', sent_at=?, error='' WHERE id=?");
  const badStmt = db.prepare("UPDATE newsletter_sends SET status='failed', error=?, sent_at=? WHERE id=?");
  const tx = db.transaction(() => {
    if (!r.ok) {
      /* 整批失敗（例如連不上、金鑰失效）：全部標成失敗並記原因，
         站長可以在後台按「重試失敗的」再來一次 */
      for (const b of batch) badStmt.run(r.error.slice(0, 300), now, b.id);
      return;
    }
    for (const b of batch) {
      const err = r.failed[b.email];
      if (err) badStmt.run(String(err).slice(0, 300), now, b.id);
      else okStmt.run(now, b.id);
    }
  });
  tx();
  return batch.length;
}

/* 把失敗的那些放回待寄，給站長重試用 */
export function retryFailed(id: number): number {
  const r = db
    .prepare("UPDATE newsletter_sends SET status='pending', error='' WHERE newsletter_id=? AND status='failed'")
    .run(id);
  if (r.changes > 0) db.prepare("UPDATE newsletters SET status='sending', finished_at='' WHERE id=?").run(id);
  return r.changes;
}

/*
 * 把贊助者同步進電子報名單。
 *
 * 為什麼做成「定期同步」而不是「入帳時寫一筆」：入帳確認的呼叫點散在七處
 * （綠界回呼、LINE Pay、Portaly、TapPay、對帳排程、續期扣款、後台補開），
 * 寫在呼叫端一定會漏掉其中一兩條，而漏掉的症狀是「有些贊助者收不到電子報」，
 * 沒有人會發現。這支用狀態去撈，補漏與新增是同一段程式。
 *
 * 三個安全性質：
 *   · 冪等。ON CONFLICT DO NOTHING，跑幾次結果都一樣。
 *   · 退訂過的不會被復活。他們的 email 已經在 subscribers 裡（帶著 unsubscribed_at），
 *     唯一鍵直接擋掉，不需要另外判斷。
 *   · 只收已經付款的（paid／active）。pending 的人可能最後根本沒付成功。
 */
export function syncSponsorSubscribers(): number {
  const rows = db
    .prepare(
      `SELECT email, display_name FROM sponsorships
       WHERE status IN ('paid','active') AND COALESCE(newsletter,1)=1
         AND email LIKE '%@%'`
    )
    .all() as { email: string; display_name: string }[];
  if (rows.length === 0) return 0;
  const ins = db.prepare(
    "INSERT INTO subscribers (email,name,source,created_at) VALUES (?,?,?,?) ON CONFLICT(email) DO NOTHING"
  );
  const now = new Date().toISOString();
  let added = 0;
  const tx = db.transaction(() => {
    for (const r of rows) {
      const info = ins.run(r.email.trim().toLowerCase(), r.display_name || "", "贊助", now);
      if (info.changes > 0) added++;
    }
  });
  tx();
  if (added > 0) console.log(`[newsletter] 贊助者同步：新增 ${added} 位訂閱者`);
  return added;
}

/*
 * 背景推進。跟 lib/reconcile.ts 同一個模式：由 instrumentation.ts 啟動的 setInterval，
 * 用 globalThis 的旗標避免熱重載時裝到第二個計時器。
 *
 * 每 20 秒推一批（100 封），也就是每小時上限 18,000 封。
 * 對這個站的名單規模綽綽有餘，而且慢慢寄對送達率比較好——
 * 一次灌爆對方的收件伺服器是被判定成垃圾信的典型特徵。
 */
/* 同一時間只跑一輪。電子豹慢的時候（逾時 30 秒 > 排程 20 秒）會疊在一起，
   而疊起來的兩輪會搶同一批收件人 */
let running = false;

async function tick() {
  if (running) return;
  running = true;
  try {
    const row = db.prepare("SELECT id FROM newsletters WHERE status='sending' ORDER BY id LIMIT 1").get() as
      | { id: number }
      | undefined;
    if (row) await pushBatch(row.id);
  } catch (e) {
    console.error("[newsletter tick]", e);
  }
  /* 贊助者同步：一小時一次就夠，寄信是分鐘級的事，名單不是 */
  try {
    const last = getSetting("sponsor_sync_at", "");
    if (!last || Date.now() - Date.parse(last) > 60 * 60 * 1000) {
      setSetting("sponsor_sync_at", new Date().toISOString());
      syncSponsorSubscribers();
    }
  } catch (e) {
    console.error("[newsletter tick 贊助者同步]", e);
  } finally {
    running = false;
  }
}

/*
 * 排程的啟動改由 instrumentation.ts 呼叫（2026-09-05），跟對帳、備份、續期同一個模式。
 *
 * 原本是 import 這個模組的副作用：只要沒有人碰到後台或 /unsubscribe，
 * 這支就沒被載入過，重新部署後卡在 sending 的電子報會一直停在那裡，
 * 直到有人剛好開了某個頁面才續寄。啟動點放在 instrumentation 才與部署同生命週期。
 */
const g = globalThis as unknown as { __yoNewsletterTimer?: ReturnType<typeof setInterval> };
export function startNewsletterLoop(): void {
  if (g.__yoNewsletterTimer) return;
  g.__yoNewsletterTimer = setInterval(() => { void tick(); }, 20_000);
  g.__yoNewsletterTimer.unref?.();
}
