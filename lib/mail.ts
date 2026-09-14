import nodemailer from "nodemailer";
import { lineInviteHtml } from "./line";
import crypto from "crypto";
import { money } from "./format";
import { t } from "./copy";
import db, { getSetting, setSetting } from "./db";
import { isPayMethodOff } from "./shop";
import { isReviewSite, reviewMailTo } from "./review-mode";
import { newsleopardEnabled, sendEmail } from "./newsleopard";
import { taipeiYMD } from "./month";
import { logMail, copyPlan, copyTarget, type MailKind } from "./mail-log";

/*
 * 交易信件：訂單確認、出貨通知、支持收據（含停止連結）。
 * 用任何 SMTP 服務皆可（Gmail 應用程式密碼 / Resend / SES）。
 * 未設定 SMTP_* 環境變數時自動略過並記 log，不影響主流程。
 */

const SMTP = {
  host: process.env.SMTP_HOST || "",
  port: Number(process.env.SMTP_PORT || 465),
  user: process.env.SMTP_USER || "",
  pass: process.env.SMTP_PASS || "",
  from: process.env.MAIL_FROM || `問爽的 WenSong <${process.env.SMTP_USER || "no-reply@wensong.tw"}>`,
};

function smtpReady(): boolean {
  return Boolean(SMTP.host && SMTP.user && SMTP.pass);
}

/*
 * 每日 SMTP 額度。
 *
 * 站長的策略（2026-08-31）：交易信先用 Gmail 的免費額度，快滿了才換電子豹，
 * 把電子豹的封數留給電子報那種一次幾百封的群發。
 *
 * 免費 Gmail 帳號經 SMTP 寄送的上限是每天 500 個收件人。撞到上限的懲罰不是
 * 溫和地拒絕，是帳號被暫時鎖住約 24 小時——那段時間連手動寄信都不行。
 * 所以預設門檻設 450 留 50 封餘裕，寧可早一點換手也不要撞牆。
 *
 * 計數存在 settings（跟著資料庫的 volume 走），重新部署不會歸零。
 * 用台北時間切日，跟 Gmail 的計算方式不完全一致（它是滾動 24 小時），
 * 但方向是保守的：我們的一天結束得比它早，不會低估。
 */
const SMTP_DAILY_LIMIT = Number(process.env.MAIL_SMTP_DAILY_LIMIT || 450);

function smtpQuotaKey(): string {
  return `mail_smtp_sent_${taipeiYMD().iso}`;
}

export function smtpSentToday(): number {
  return Number(getSetting(smtpQuotaKey(), "0")) || 0;
}

/* n＝這封信有幾個收件人。Gmail／iCloud 算的是收件人數，密件副本也算一個，計數要跟著加 */
function bumpSmtpSent(n = 1): void {
  try {
    setSetting(smtpQuotaKey(), String(smtpSentToday() + n));
  } catch { /* 計數失敗不能影響寄信本身 */ }
}

export function smtpQuotaLeft(): number {
  return Math.max(0, SMTP_DAILY_LIMIT - smtpSentToday());
}

/* 只要其中一條路通就算能寄信 */
export function mailEnabled(): boolean {
  return smtpReady() || newsleopardEnabled();
}

/* 後台顯示現在實際走哪一條，別讓站長自己猜 */
export function mailTransportLabel(): string {
  const nl = newsleopardEnabled();
  if (smtpReady() && nl) {
    const left = smtpQuotaLeft();
    return left > 0
      ? `SMTP（今日還剩 ${left} 封）→ 滿了換電子豹`
      : `電子豹（SMTP 今日額度已用完 ${smtpSentToday()} 封）`;
  }
  if (nl) return "電子豹";
  return smtpReady() ? "SMTP" : "未設定";
}

let transporter: nodemailer.Transporter | null = null;
function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: SMTP.host,
      port: SMTP.port,
      secure: SMTP.port === 465,
      auth: { user: SMTP.user, pass: SMTP.pass },
      /*
       * 逾時全部寫明，不用預設值。
       *
       * 會踩到是因為每日備份信的附件是整個資料庫加圖片，是全站最大的一封，
       * 收信端已經收下並投遞、但回應階段連線斷掉時，nodemailer 一樣是拋錯，
       * 於是「信到了卻算失敗」，排程半小時後又重寄一次。
       *
       * 連線與問候給短一點，連不上就早點失敗；資料傳輸給足 10 分鐘，
       * 大附件才不會傳到一半被自己砍掉。
       */
      connectionTimeout: 30_000,
      greetingTimeout: 30_000,
      socketTimeout: 10 * 60_000,
    });
  }
  return transporter;
}

export function siteUrl(): string {
  return (process.env.SITE_URL || "https://www.wensong.tw").replace(/\/$/, "");
}

/* 信件外框：米袋黃品牌樣式，含感謝語、聯絡資訊與網站連結。
   bottomHtml 放在整封信「最底部」（聯絡資訊之後），取消/停止類連結一律放這裡 */
/* opts.below：放在整個框「外面」的最底下，給電子報退訂這種要有、但不該搶眼的東西 */
function wrap(title: string, bodyHtml: string, bottomHtml = "", opts: { internal?: boolean; below?: string } = {}): string {
  /* 信尾聯絡信箱用品牌信箱，不退回 SMTP 登入帳號 */
  const contact = process.env.CONTACT_EMAIL || "hi@wensong.tw";
  const site = siteUrl();
  /*
   * internal＝寄給站長自己的營運通知（有人下單、有人投稿、發票開不出來⋯⋯）。
   * 這種信不放感謝框與「聯絡我們」：那兩塊是寫給顧客看的品牌語言，
   * 站長對自己說「台灣因為有你，變得更好」沒有意義，只是把真正要看的
   * 訂單資訊往下推。站長指示 2026-08-31。
   */
  const thanks = opts.internal ? "" : `
      <!-- 感謝區 -->
      <div style="margin-top:28px;border:2px solid #B8402C;padding:16px 20px;">
        <p style="margin:0;font-size:14px;line-height:2;color:#B8402C;">
          ${t("mail_thanks_1")}<br>
          <span style="color:#3A3226;">${t("mail_thanks_2")}</span>
        </p>
      </div>`;
  const footer = opts.internal ? "" : `
      <!-- 聯絡資訊 -->
      <p style="font-size:12.5px;color:#7C7060;border-top:2px dashed #E3D3AC;padding-top:14px;margin-top:22px;line-height:2;">
        <b style="color:#3A3226;">聯絡我們</b><br>
        信箱：<a href="mailto:${contact}" style="color:#2C4A6B;">${contact}</a><br>
        官網：<a href="${site}" style="color:#2C4A6B;">${site.replace("https://", "")}</a>　訂單查詢：<a href="${site}/orders" style="color:#2C4A6B;">${site.replace("https://", "")}/orders</a><br>
        ${t("mail_footer_line")}
      </p>`;
  return `<!doctype html><html><body style="margin:0;padding:0;background:#EFE3C4;">
  <div style="max-width:560px;margin:0 auto;padding:32px 16px;font-family:'Noto Serif TC','PingFang TC',serif;color:#3A3226;">
    <div style="height:12px;background:repeating-linear-gradient(90deg,#B8402C 0 36px,#EFE3C4 36px 45px,#2C4A6B 45px 81px,#EFE3C4 81px 90px);"></div>
    <div style="border:2px solid #3A3226;border-top:none;background:#F5EDD8;padding:32px 28px;">
      <p style="font-size:13px;letter-spacing:.3em;color:#2C4A6B;border:1.5px solid #2C4A6B;display:inline-block;padding:3px 12px;margin:0 0 14px;">佑 在 幹 嘛 ｜ 則 佑</p>
      <h1 style="font-size:22px;letter-spacing:.1em;margin:0 0 18px;">${title}</h1>
      ${bodyHtml}
${thanks}
${footer}
      ${bottomHtml}
    </div>
    <div style="height:12px;background:repeating-linear-gradient(90deg,#B8402C 0 36px,#EFE3C4 36px 45px,#2C4A6B 45px 81px,#EFE3C4 81px 90px);"></div>
    ${opts.below || ""}
  </div></body></html>`;
}

/* 給站內其他模組（如商品購買通知）共用同一套信件外框 */
export const wrapMail = wrap;
export type WrapOpts = { internal?: boolean; below?: string };
/* 寄給站長自己的營運通知：同一個外框，但不放感謝框與「聯絡我們」 */
export const wrapOwnerMail = (title: string, bodyHtml: string, bottomHtml = "") =>
  wrap(title, bodyHtml, bottomHtml, { internal: true });

/*
 * 這個信箱寄得到嗎。
 *
 * 每次寄信都查一次資料庫看起來很浪費，但寄一封信本身要跟 SMTP 來回好幾趟，
 * 一次索引查詢的成本跟它比是零。而且這是最後一道防線，
 * 呼叫端漏掉檢查的時候要擋得住，寧可查。
 */
export function mailBlocked(email: string): boolean {
  const e = String(email || "").trim().toLowerCase();
  if (!e) return false;
  try {
    return Boolean(db.prepare("SELECT 1 FROM mail_blocked WHERE email=? LIMIT 1").get(e));
  } catch {
    /* 資料表還沒建起來之類的狀況，不能讓整個寄信流程掛掉 */
    return false;
  }
}

export function blockMail(email: string, reason: string): void {
  const e = String(email || "").trim().toLowerCase();
  if (!e) return;
  db.prepare("INSERT INTO mail_blocked (email,reason,created_at) VALUES (?,?,?) ON CONFLICT(email) DO UPDATE SET reason=excluded.reason")
    .run(e, reason, new Date().toISOString());
}

export function unblockMail(email: string): void {
  db.prepare("DELETE FROM mail_blocked WHERE email=?").run(String(email || "").trim().toLowerCase());
}

export function blockedMails(): { email: string; reason: string; created_at: string }[] {
  return db.prepare("SELECT email,reason,created_at FROM mail_blocked ORDER BY created_at DESC").all() as
    { email: string; reason: string; created_at: string }[];
}

/*
 * HTML 信的純文字版。
 *
 * 只寄 HTML、沒有純文字對照版的信，Gmail 與 iCloud 的垃圾分數會比較高，
 * 新寄件人（hi@wensong.tw 剛啟用）本來就在觀察期，能少一分是一分。
 * 不用外部套件：把區塊標籤換成換行、連結展開成「文字（網址）」、其餘標籤拿掉、實體解回來。
 */
export function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<a\s[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, (_, u, t) => {
      const text = t.replace(/<[^>]+>/g, "").trim();
      return text && text !== u ? `${text}（${u}）` : u;
    })
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6]|table|blockquote)>/gi, "\n")
    .replace(/<\/t[dh]>/gi, "　")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .split("\n").map((l) => l.replace(/[ \t　]+/g, " ").trim()).join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export type MailMeta = {
  /* 寄件紀錄的種類，沒給就當客人例行信 */
  kind?: MailKind;
  /* 關聯的訂單或贊助編號（YD… / SP…），訂單頁「寄件紀錄」靠它對上 */
  refNo?: string;
  /* 要不要把整封 HTML 存進紀錄（只有手寫信會開） */
  keepBody?: boolean;
  /* none＝這封不做副本（手寫信多人寄時由呼叫端自己寄一封總副本） */
  copy?: "auto" | "none";
};

/*
 * 信件附件。
 *
 * content 收 Buffer 或字串兩種，encoding 一定要能傳下去給 nodemailer：
 * nodemailer 9 看到字串 content 會當成 UTF-8 純文字，自己再 base64 一次，
 * 於是「已經是 base64 的字串」會被編成兩層，收件人存下來的檔案解不開。
 * 二進位的東西（備份的 .gz）直接給 Buffer 最省事，非給字串不可時就補 encoding: "base64"。
 */
export type MailAttachment = {
  filename: string;
  content: string | Buffer;
  contentType?: string;
  encoding?: string;
};

/*
 * 寄不出去的時候叫醒站長（站長 2026-09-05）。
 *
 * 為什麼需要：只設 SMTP、沒設電子豹的情況下，Gmail 免費額度撞到 450 封那一刻起，
 * 當天剩下的每一封交易信都是靜靜地失敗——訂單確認、出貨通知、扣款收據全部沒寄，
 * 而站長要到隔天有人來信問「我付了錢怎麼沒收到信」才會知道。
 * 後台的寄件紀錄是有留 failed，但那要有人主動去看。
 *
 * 一天只叫一次（台北時間切日，跟額度計數同一把尺）。用 settings 記戳記，
 * 重新部署不會重來一輪，也不會因為一小時內失敗兩百封就寄兩百封警報。
 *
 * 這封警報自己不能走 deliver()：deliver 正是因為「沒有可用管道」才呼叫它，
 * 再走一次只會再失敗一次。所以直接抓 transporter 寄，也刻意不記進當日額度
 * ——額度都滿了，這封是硬要擠出去的例外，計不計數已經沒有意義。
 * SMTP 本身就不通（沒設定或帳密錯）的話寄不出去也沒辦法，記 log 就算了。
 */
async function alertMailChannelDown(failedSubject: string, failedTo: string): Promise<void> {
  const key = `mail_quota_alert_${taipeiYMD().iso}`;
  try {
    if (getSetting(key, "")) return;
    const emails = getSetting("owner_notify_emails", "")
      .split(/[,，;\s]+/)
      .map((x) => x.trim())
      .filter((x) => x.includes("@"));
    if (emails.length === 0) return;
    if (!smtpReady()) {
      /* 連 SMTP 都沒有就沒有第二條路寄警報，至少讓 log 與寄件紀錄留下痕跡 */
      console.error("[mail] 沒有可用的寄信管道，且 SMTP 未設定，無法寄出警報");
      logMail({ kind: "owner", route: "", to: emails.join(", "), subject: "寄信管道全數不通", status: "failed", detail: "SMTP 未設定，警報寄不出去" });
      setSetting(key, new Date().toISOString());
      return;
    }
    /* 先寫戳記再寄：寄的過程中又有信失敗時不會再觸發一封 */
    setSetting(key, new Date().toISOString());
    const to = emails.join(", ");
    const subject = "［要處理］今天的信寄不出去了｜問爽的";
    const html = wrapOwnerMail(
      "今天的信寄不出去了",
      `<p style="font-size:15px;line-height:2;">網站要寄一封信給客人，但沒有任何可用的寄信管道，這封信沒有寄出去。</p>
       <p style="font-size:13.5px;color:#7C7060;line-height:2;">
         寄不出去的那封：${esc(failedSubject)}<br>
         原本要寄給：${esc(failedTo)}<br>
         今日 SMTP 已用：${smtpSentToday()} 封（上限 ${SMTP_DAILY_LIMIT}）<br>
         電子豹：${newsleopardEnabled() ? "已設定" : "未設定"}
       </p>
       <p style="font-size:14px;line-height:2;">最快的解法是到網站設定把電子豹的金鑰填上，交易信會自動改走那條。今天之後失敗的每一封都可以在後台「寄件紀錄」找到，補寄不用重問客人。</p>
       <p style="font-size:12.5px;color:#7C7060;">同樣的狀況一天只通知這一次。</p>`
    );
    const info = await getTransporter().sendMail({ from: SMTP.from, to, subject, html, text: htmlToText(html) });
    const rejected = ((info?.rejected || []) as unknown[]).length;
    logMail({ kind: "owner", route: "smtp", to, subject, status: rejected ? "failed" : "sent", detail: rejected ? "警報信被退" : "寄信管道全數不通的當日警報" });
  } catch (e) {
    console.error("[mail] 警報信寄不出去", e);
    try {
      logMail({ kind: "owner", route: "smtp", to: getSetting("owner_notify_emails", ""), subject: "寄信管道全數不通", status: "failed", detail: e instanceof Error ? e.message : String(e) });
    } catch { /* 連紀錄都寫不進去就算了，不能讓警報反過來害到主流程 */ }
  }
}

type Deliver = { ok: boolean; route: "smtp" | "newsleopard" | ""; error: string; copyRejected?: boolean };

/*
 * 真的把信送出去的那一段。不看封鎖名單、不記紀錄、不管副本，只負責兩條路的切換。
 * sendMail 是政策層，這裡是搬運層；副本信也走這裡，才不會自己再被副本一次。
 */
async function deliver(
  to: string, subject: string, html: string,
  attachments?: MailAttachment[],
  bcc = "",
): Promise<Deliver> {
  /*
   * 交易信的路由（站長 2026-08-31 指示）：
   *
   *   1. 帶附件 → 一律 SMTP。電子豹 /v1/messages 沒有附件欄位（讀過欄位表），
   *      每日備份那封夾著整個資料庫，只有 SMTP 送得出去。
   *   2. SMTP 還有今日額度 → 走 SMTP（Gmail 免費額度先用）
   *   3. 額度用完或 SMTP 失敗 → 換電子豹
   *
   * 電子報不走這裡，它直接呼叫電子豹的批次 API（lib/newsletter.ts），
   * 所以「群發一律電子豹」是結構上就成立的，不靠這段判斷。
   *
   * 兩條路都留著的理由沒變：交易信不能寄不出去。客人付了錢卻沒收到確認信，
   * 他不會想「大概是寄信服務掛了」，他會想「這個網站有問題」，然後來信或退刷。
   */
  const hasAttach = Boolean(attachments?.length);
  const smtpFirst = smtpReady() && (hasAttach || smtpQuotaLeft() > 0);
  let smtpErr = "";

  if (smtpFirst) {
    try {
      const info = await getTransporter().sendMail({
        from: SMTP.from, to, subject, html, text: htmlToText(html),
        ...(bcc ? { bcc } : {}),
        ...(hasAttach ? { attachments } : {}),
      });
      bumpSmtpSent(bcc ? 2 : 1);
      /*
       * nodemailer 只有「全部收件人都被退」才會拋錯。帶著密件副本時，主收件人被退、副本收下，
       * 它會當成功回來。那對客人來說就是沒收到信，所以主收件人被退一律當失敗，讓下面的電子豹備援接手。
       * 密件副本被退則不算這封失敗：原收件人收到了就是成功，只在紀錄裡註明。
       */
      const rejected = ((info?.rejected || []) as unknown[]).map((r) => String(r).toLowerCase());
      if (rejected.includes(to.toLowerCase())) throw new Error(`收信端拒收 ${to}`);
      const copyRejected = Boolean(bcc) && rejected.includes(bcc.toLowerCase());
      console.log(`[mail sent via SMTP] ${subject} → ${to}（今日已用 ${smtpSentToday()}）`);
      return { ok: true, route: "smtp", error: "", copyRejected };
    } catch (e) {
      smtpErr = e instanceof Error ? e.message : String(e);
      console.error(`[mail SMTP 失敗] ${subject} → ${to}`, e);
      /* 帶附件的沒有第二條路可走 */
      if (hasAttach || !newsleopardEnabled()) return { ok: false, route: "smtp", error: `SMTP 失敗：${smtpErr}` };
    }
  }

  if (newsleopardEnabled() && !hasAttach) {
    const why = smtpReady() ? (smtpQuotaLeft() > 0 ? "SMTP 失敗" : `SMTP 今日額度已滿（${smtpSentToday()}）`) : "沒有 SMTP";
    const r = await sendEmail({ to, subject, html });
    if (r.ok) {
      console.log(`[mail sent via 電子豹｜${why}] ${subject} → ${to}`);
      return { ok: true, route: "newsleopard", error: "" };
    }
    console.error(`[mail 電子豹 也失敗] ${subject} → ${to}：${r.error}`);
    return { ok: false, route: "newsleopard", error: `${why}；電子豹也失敗：${r.error}` };
  }

  console.log(`[mail skip - 沒有可用的寄信管道] ${subject} → ${to}`);
  /* 額度用完或管道全掛：一天叫醒站長一次。不 await，警報慢不該拖住主流程 */
  void alertMailChannelDown(subject, to);
  return { ok: false, route: "", error: smtpErr ? `SMTP 失敗：${smtpErr}` : "沒有可用的寄信管道" };
}

/*
 * 只寄副本，不記紀錄、不再副本。給手寫信多人寄時那一封「本次寄給：⋯」總副本用。
 * 失敗只回 false，呼叫端自己決定要不要在意；原信早就寄出去了。
 */
export async function sendCopyOnly(to: string, subject: string, html: string): Promise<boolean> {
  if (isReviewSite() || !mailEnabled()) return false;
  try { return (await deliver(to, subject, html)).ok; } catch { return false; }
}

export async function sendMail(
  to: string,
  subject: string,
  html: string,
  attachments?: MailAttachment[],
  meta: MailMeta = {},
): Promise<boolean> {
  const kind: MailKind = meta.kind || "routine";
  const rec = (status: "sent" | "failed" | "skipped", detail: string, route = "") =>
    logMail({ kind, route, to, subject, status, detail, refNo: meta.refNo, body: meta.keepBody ? html : "" });

  if (!mailEnabled()) {
    console.log(`[mail skip - 沒有設定任何寄信管道] ${subject} → ${to}`);
    rec("skipped", "沒有設定任何寄信管道");
    return false;
  }
  /*
   * 審核用測試站：所有信改寄到 REVIEW_MAIL_TO 那一個信箱。
   * 審核人員會下測試單，那些單不該寄信給真實顧客，也不該把夥伴叫起來出貨。
   * 沒設轉寄信箱就整個不寄——寧可不寄，也不要寄錯人。
   */
  if (isReviewSite()) {
    const box = reviewMailTo();
    if (!box) {
      console.log(`[mail skip - 測試站未設 REVIEW_MAIL_TO] ${subject} → ${to}`);
      rec("skipped", "測試站未設 REVIEW_MAIL_TO");
      return false;
    }
    if (box !== to) {
      subject = `［測試站｜原收件人 ${to}］${subject}`;
      to = box;
    }
  }
  /* 標記為寄不到的一律不寄。寄出去只會再換來一封退信 */
  if (mailBlocked(to)) {
    console.log(`[mail skip - 信箱已標記寄不到] ${subject} → ${to}`);
    rec("skipped", "信箱已標記寄不到");
    return false;
  }

  /*
   * 副本（站長 2026-09-05）：網站設定填了副本信箱，指定種類的信就暗中多寄一份給他。
   * SMTP 用密件副本，客人看不到，站長收到的那封收件人欄還是客人；
   * 電子豹的 API 沒有密件欄位，走到那條路就另寄一封主旨加「［副本→客人］」。
   * 測試站不副本，副本失敗不影響原信。
   */
  const copyTo = isReviewSite() || meta.copy === "none" ? "" : copyTarget(copyPlan(), kind, to);

  let r: Deliver;
  try {
    r = await deliver(to, subject, html, attachments, copyTo);
  } catch (e) {
    r = { ok: false, route: "", error: e instanceof Error ? e.message : String(e) };
  }
  if (!r.ok) {
    rec("failed", r.error, r.route);
    return false;
  }
  let note = "";
  if (copyTo) {
    if (r.route === "smtp") note = r.copyRejected ? `副本被退（${copyTo}）` : `副本→${copyTo}`;
    else {
      /* 原信剛走了電子豹，代表 SMTP 不通或額度滿了；副本直接走電子豹，不要再去撞一次 30 秒的 SMTP 逾時 */
      try {
        const c = await sendEmail({ to: copyTo, subject: `［副本→${to}］${subject}`, html });
        note = c.ok ? `副本→${copyTo}` : `副本失敗（${copyTo}）`;
      } catch { note = `副本失敗（${copyTo}）`; }
    }
  }
  rec("sent", note, r.route);
  return true;
}

/* ── 取消訂閱連結（HMAC 簽名，無法偽造他人 id） ── */
/* 與後台 session 同一把金鑰：環境變數優先，沒設就用資料庫裡的持久隨機值。
   持久這件事很重要，金鑰若每次部署都變，已經寄出去的取消連結會全部失效。 */
function cancelSecret(): string {
  return process.env.ADMIN_SECRET || getSetting("instance_secret", "") || "yozaiganma-dev-secret";
}
export function cancelToken(id: number): string {
  return crypto.createHmac("sha256", cancelSecret()).update(`cancel-sponsor:${id}`).digest("hex").slice(0, 32);
}
export function cancelUrl(id: number): string {
  return `${siteUrl()}/support/cancel?id=${id}&t=${cancelToken(id)}`;
}

/* 停止每月支持連結（一律放信件最底部） */
function stopSponsorBottom(id: number): string {
  return `<p style="font-size:12px;color:#7C7060;margin-top:14px;padding-top:12px;border-top:1px solid #E3D3AC;">
    ${t("mail_stop_prefix")}<a href="${cancelUrl(id)}" style="color:#7C7060;">${t("mail_stop_link")}</a></p>`;
}

type OrderLike = {
  order_no: string; name: string; email: string; address: string;
  items: string; subtotal: number; shipping: number; total: number;
  pay_note?: string; addon_amount?: number; discount_amount?: number; discount_code?: string;
  /* 訂單權杖：有帶才會在「收到訂單」信裡放接續付款按鈕 */
  token?: string;
  /* 發票選項（結帳時填的）。用來在信裡講一句「這張發票去哪了」 */
  invoice_type?: string;
  invoice_data?: string;
};

/*
 * 沒有實體貨要寄的訂單（付款連結收服務費那種）：地址是空的、運費是 0、
 * 也沒有出貨這件事。照原樣寄會出現空白的收件欄位跟「出貨當天會再通知你」
 * 這種不成立的句子，所以整塊條件顯示，不另外開一套模板去維護兩份文案。
 */
export function hasShipping(o: { address?: string }): boolean {
  return Boolean((o.address || "").trim());
}
/*
 * 發票去向。捐贈是不可逆的，客人手上要有一份白紙黑字的紀錄說「捐給誰」，
 * 這封信就是那份紀錄——站長選的三層告知裡的第二層。
 *
 * 站長明確指示不要寫「捐出去就不能對獎」（他的判斷是台灣人本來就知道），
 * 所以這裡只講捐給誰，不解釋代價。
 */
function invoiceLine(o: OrderLike): string {
  let d: { npoban?: string; npobanName?: string; carrierNo?: string; taxId?: string } = {};
  try { d = JSON.parse(o.invoice_data || "{}"); } catch { d = {}; }
  const npo = String(d.npoban || "").trim();
  if (npo) {
    const who = String(d.npobanName || "").trim();
    return `電子發票　已捐贈給 <b>${esc(who || "你指定的受贈單位")}</b>（捐贈碼 ${esc(npo)}）<br>`;
  }
  if (o.invoice_type === "b2b" && String(d.taxId || "").trim())
    return `電子發票　開立統編 ${esc(String(d.taxId).trim())}<br>`;
  if (String(d.carrierNo || "").trim())
    return `電子發票　已存入手機條碼載具 ${esc(String(d.carrierNo).trim())}<br>`;
  return "";
}

function shipRow(o: OrderLike): string {
  return hasShipping(o)
    ? `<tr><td style="padding:6px 0;font-size:14.5px;color:#7C7060;">運費</td><td align="right" style="font-size:14.5px;">${money(o.shipping)}</td></tr>`
    : "";
}
/*
 * HTML 跳脫。
 *
 * 這些欄位是顧客自己在結帳表單打的：姓名、地址、商品規格、金流回傳的備註。
 * 沒跳脫的話，一個姓名裡的「<」就會被信件軟體當成標籤開頭，
 * 後面整段版面跟著壞掉——收件人看到的是一封破掉的信。
 *
 * 嚴重度說明，免得日後有人覺得這裡做過頭：
 * 這幾封信的收件人是顧客「自己填的信箱」，所以他只能影響寄給自己的信，
 * 不是拿別人當目標。真正危險的方向是「陌生人的輸入寄進站長信箱」，
 * 那條路在 lib/notify.ts，那邊本來就每個欄位都跳脫了。
 * 這裡補的是版面正確性與縱深防禦，不是在補一個正在被利用的洞。
 *
 * 單引號也一起換掉：這些值有時會落在 style="..." 或 href="..." 裡面。
 */
export function esc(v: unknown): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function addrLine(o: OrderLike): string {
  return hasShipping(o) ? `收件／取貨：${esc(o.address)}<br>` : "";
}

export function itemRows(itemsJson: string): string {
  try {
    const items = JSON.parse(itemsJson) as { name: string; choice: string | null; price: number; qty: number }[];
    return items
      .map(
        (i) =>
          `<tr><td style="padding:6px 0;font-size:14.5px;">${esc(i.name)}${i.choice ? `（${esc(i.choice)}）` : ""} × ${esc(i.qty)}</td><td align="right" style="font-size:14.5px;">${money(i.price * i.qty)}</td></tr>`
      )
      .join("");
  } catch {
    return "";
  }
}

/* ── 訂單信 ── */

/*
 * 「改用其他付款方式」。
 *
 * 站長 2026-09-07 指示：每一封還沒付完款的信都要讓客人換付款方式。
 * 為什麼重要：實測 ATM 成功率 89%、信用卡只有 48%，而收到 ATM 帳號之後
 * 想改刷卡的人，本來在信裡完全找不到路，只能寫信問或是就這樣算了。
 * 目的地一律是感謝頁的「重選付款方式」狀態，跟提醒信按的是同一顆，
 * 因為那頁本來就會依照目前開放的付款方式重新給選項，不必在信裡各自判斷。
 * 沒有權杖就不放按鈕（放了也開不起來），不是每封信都拿得到權杖。
 *
 * 已取號的 ATM 信要小心措辭：換了付款方式並不會讓舊的虛擬帳號失效。
 * 訂單那邊即使客人事後才轉到舊帳號，綠界回傳的單號還原得回訂單編號，
 * 對得上；但贊助是拿 trade_no 直接比對，換方式時 trade_no 會被覆寫，
 * 舊帳號的入帳就對不到任何一筆。所以信裡只講「換完就別再轉這組帳號」，
 * 不可以寫「會自動失效」。
 */
export function orderChooseUrl(orderNo: string, token: string): string {
  return `${siteUrl()}/shop/thanks?no=${encodeURIComponent(orderNo)}&k=${encodeURIComponent(token)}&pay=choose`;
}
export function sponsorChooseUrl(id: number, token: string, mode = "once"): string {
  return `${siteUrl()}/support/thanks?mode=${encodeURIComponent(mode || "once")}&pay=choose&sid=${id}&t=${encodeURIComponent(token)}`;
}
/* 信裡的按鈕。primary 是實心那顆 */
function mailBtn(href: string, label: string, primary = false): string {
  return `<a href="${href}" style="display:inline-block;margin:0 6px 8px 0;padding:11px 22px;font-size:14.5px;letter-spacing:.08em;
       border:2px solid #3A3226;text-decoration:none;${primary ? "background:#B8402C;color:#EFE3C4;" : "background:#EFE3C4;color:#3A3226;"}">${label}</a>`;
}


/* 下單當下就寄（不等付款完成），買家立刻有一封完整明細在手上 */
export function sendOrderCreatedMail(o: OrderLike) {
  const html = wrap(
    "收到你的訂單了",
    `<p style="font-size:15px;line-height:2;">${esc(o.name)} 你好，${hasShipping(o) ? "我們已收到你的訂單，完成付款後會盡快為你出貨。" : "我們已收到你的訂單，完成付款就算完成，沒有需要寄送的東西。"}</p>
     <p style="font-size:14px;color:#7C7060;">訂單編號　<b style="color:#B8402C;font-family:monospace;font-size:16px;">${esc(o.order_no)}</b></p>
     <table width="100%" style="border-top:2px solid #3A3226;margin-top:10px;">${itemRows(o.items)}
       ${o.addon_amount ? `<tr><td style="padding:6px 0;font-size:14.5px;color:#B8402C;">額外支持「問爽的」，謝謝你 ♥</td><td align="right" style="font-size:14.5px;color:#B8402C;">${money(o.addon_amount)}</td></tr>` : ""}
       ${o.discount_amount ? `<tr><td style="padding:6px 0;font-size:14.5px;color:#2C4A6B;">折扣${o.discount_code ? `（${esc(o.discount_code)}）` : ""}</td><td align="right" style="font-size:14.5px;color:#2C4A6B;">− ${money(o.discount_amount)}</td></tr>` : ""}
       ${shipRow(o)}
       <tr><td style="padding:10px 0;font-size:16px;border-top:2px dashed #E3D3AC;"><b>總金額</b></td><td align="right" style="border-top:2px dashed #E3D3AC;font-size:17px;"><b>${money(o.total)}</b></td></tr>
     </table>
     ${o.token ? `<p style="text-align:center;margin:20px 0 4px;">
       ${mailBtn(`${siteUrl()}/api/orders/pay?no=${encodeURIComponent(o.order_no)}&t=${encodeURIComponent(o.token)}`, "繼 續 付 款", true)}
       ${mailBtn(orderChooseUrl(o.order_no, o.token), "改用其他付款方式")}</p>
     <p style="font-size:12.5px;color:#7C7060;line-height:1.9;text-align:center;">付款中斷（例如刷卡驗證頁出錯）不用重填任何資料，點上面的按鈕就能接續。想換一種付款方式也可以，資料一樣不用重填。已完成付款的話這封信留著當明細就好。</p>` : ""}
     <p style="font-size:13.5px;color:#7C7060;line-height:1.9;">${addrLine(o)}${invoiceLine(o)}付款完成後會再收到一封確認信；可隨時用「訂單編號 + Email」到 <a href="${siteUrl()}/orders" style="color:#2C4A6B;">訂單查詢</a> 看進度。</p>
     ${lineInviteHtml(o)}`
  );
  return sendMail(o.email, `收到訂單 ${o.order_no}｜問爽的 WenSong`, html, undefined, { refNo: o.order_no });
}

export function sendOrderPaidMail(o: OrderLike) {
  const html = wrap(
    t("m_order_title"),
    `<p style="font-size:15px;line-height:2;">${esc(o.name)} 你好，${t("m_order_body")}</p>
     <p style="font-size:14px;color:#7C7060;">訂單編號　<b style="color:#B8402C;font-family:monospace;font-size:16px;">${esc(o.order_no)}</b></p>
     <table width="100%" style="border-top:2px solid #3A3226;margin-top:10px;">${itemRows(o.items)}
       ${o.addon_amount ? `<tr><td style="padding:6px 0;font-size:14.5px;color:#B8402C;">額外支持「問爽的」，謝謝你 ♥</td><td align="right" style="font-size:14.5px;color:#B8402C;">${money(o.addon_amount)}</td></tr>` : ""}
       ${o.discount_amount ? `<tr><td style="padding:6px 0;font-size:14.5px;color:#2C4A6B;">折扣${o.discount_code ? `（${esc(o.discount_code)}）` : ""}</td><td align="right" style="font-size:14.5px;color:#2C4A6B;">− ${money(o.discount_amount)}</td></tr>` : ""}
       ${shipRow(o)}
       <tr><td style="padding:10px 0;font-size:16px;border-top:2px dashed #E3D3AC;"><b>總金額</b></td><td align="right" style="border-top:2px dashed #E3D3AC;font-size:17px;"><b>${money(o.total)}</b></td></tr>
     </table>
     <p style="font-size:13.5px;color:#7C7060;line-height:1.9;">${addrLine(o)}${invoiceLine(o)}可隨時用「訂單編號 + Email」到 <a href="${siteUrl()}/orders" style="color:#2C4A6B;">訂單查詢</a> 看進度。</p>
     ${lineInviteHtml(o)}`
  );
  return sendMail(o.email, `付款完成 ${o.order_no}｜問爽的 WenSong`, html, undefined, { refNo: o.order_no });
}

export function sendOrderAtmMail(o: OrderLike) {
  const html = wrap(
    t("m_atm_title"),
    `<p style="font-size:15px;line-height:2;">${esc(o.name)} 你好，${t("m_atm_body")}</p>
     <p style="font-size:14px;color:#7C7060;">訂單編號　<b style="color:#B8402C;font-family:monospace;font-size:16px;">${esc(o.order_no)}</b></p>
     ${o.pay_note ? `<p style="font-size:15px;border:2px solid #2C4A6B;padding:14px 18px;color:#2C4A6B;">${esc(o.pay_note)}</p>` : ""}
     <p style="font-size:14px;">應付金額　<b>${money(o.total)}</b></p>
     ${o.token ? `<p style="margin-top:14px;">${mailBtn(orderChooseUrl(o.order_no, o.token), "改用其他付款方式")}</p>
     <p style="font-size:13px;color:#7C7060;line-height:2;">已經轉帳的話就不用理會這顆按鈕。還沒轉、想改成刷卡或 LINE Pay 的話，按上面那顆換一種，換完之後就不要再轉到這組帳號了。</p>` : ""}
     ${lineInviteHtml(o)}`
  );
  return sendMail(o.email, `待付款 ${o.order_no}｜問爽的 WenSong`, html, undefined, { refNo: o.order_no });
}

/*
 * 訂單待付款提醒（比照贊助的提醒信）。
 *
 * 為什麼需要：綠界對信用卡「只有授權成功才回呼」，被發卡行擋下時我們收不到通知，
 * 訂單停在待付款而顧客也不會再回來。實際發生過：同一位顧客三分鐘內
 * 先試 LINE Pay 再試信用卡，兩筆都卡住，我們一封信都沒寄。
 *
 * 兩種情境的信不一樣：
 *   ATM 已取號 → 重貼一次繳費帳號（她需要的是帳號，不是換付款方式）
 *   其餘（刷卡／LINE Pay 沒完成）→ 給一鍵再付一次，並優先推 ATM，
 *     因為實測 ATM 成功率 89%、信用卡只有 48%。
 */
export type OrderResume = OrderLike & {
  token: string;
  pay_method: string;
  atmInfo?: string;      // pay_note 裡的繳費資訊（有取號才有）
  isFinalReminder?: boolean;
};

export function orderResumeMailHtml(o: OrderResume): { subject: string; html: string } {
  const site = siteUrl();
  /* 姓名是顧客自己在結帳表單打的，一律跳脫再進 HTML；空字串才退回「你」 */
  const name = esc(o.name) || "你";
  const atm = Boolean(o.atmInfo);
  const payUrl = (m?: string) =>
    `${site}/api/orders/pay?no=${encodeURIComponent(o.order_no)}&t=${encodeURIComponent(o.token)}${m ? `&m=${encodeURIComponent(m)}` : ""}`;

  const btn = (href: string, label: string, primary = false) =>
    `<a href="${href}" style="display:inline-block;margin:0 6px 8px 0;padding:11px 22px;font-size:14.5px;letter-spacing:.08em;
       border:2px solid #3A3226;text-decoration:none;${primary ? "background:#B8402C;color:#EFE3C4;" : "background:#EFE3C4;color:#3A3226;"}">${label}</a>`;

  const body = atm
    ? `<p style="font-size:15px;line-height:2;">${name}好，你的訂單 <b>${money(o.total)}</b> 已經取得轉帳帳號，但還沒收到款項。轉帳資訊再附上一次：</p>
       <p style="font-size:15px;line-height:2.2;border-left:3px solid #A87F2E;padding-left:14px;">${esc(o.atmInfo)}</p>
       <p style="font-size:13.5px;color:#7C7060;line-height:2;">已經轉好的話請忽略這封信，入帳後系統會自動寄確認信與電子發票。逾期未轉帳這筆訂單會自動取消，不會產生任何費用。</p>
       <p style="margin-top:14px;">${mailBtn(orderChooseUrl(o.order_no, o.token), "改用其他付款方式")}</p>
       <p style="font-size:13px;color:#7C7060;line-height:2;">已經轉帳的話就不用理會這顆按鈕。還沒轉、想改成刷卡或 LINE Pay 的話，按上面那顆換一種，換完之後就不要再轉到這組帳號了。</p>`
    : `<p style="font-size:15px;line-height:2;">${name}好，你的訂單還沒完成付款${hasShipping(o) ? "，商品先幫你留著" : ""}。</p>
       <p style="font-size:13.5px;color:#7C7060;line-height:2;">
         刷卡沒過多半是發卡行那端的驗證沒通過，跟你的卡有沒有額度不一定有關係。
         下面任一種方式都可以直接接續付款，<b>資料不用重填</b>：</p>
       <p style="margin-top:14px;">
         ${isPayMethodOff("ATM 轉帳") ? "" : btn(payUrl("ATM 轉帳"), "改用 ATM 轉帳（最穩）", true)}
         ${isPayMethodOff("信用卡") ? "" : btn(payUrl("信用卡"), "再刷一次信用卡")}
         ${isPayMethodOff("ATM 轉帳") && isPayMethodOff("信用卡") ? btn(payUrl(), "接續付款", true) : ""}
       </p>`;

  const html = wrap(
    o.isFinalReminder ? "最後一次提醒：訂單還沒完成付款" : "你的訂單還沒完成付款",
    `${body}
     <p style="font-size:14px;color:#7C7060;margin-top:18px;">訂單編號　<b style="color:#B8402C;font-family:monospace;font-size:16px;">${esc(o.order_no)}</b>　金額　<b>${money(o.total)}</b></p>
     <table width="100%" style="border-top:2px solid #3A3226;margin-top:8px;">${itemRows(o.items)}</table>
     ${o.isFinalReminder ? `<p style="font-size:13px;color:#7C7060;line-height:2;margin-top:14px;">這是最後一次提醒，之後不會再打擾你。訂單逾期會自動取消並釋出庫存，不會產生任何費用。</p>` : ""}
     ${lineInviteHtml(o)}`
  );
  return { subject: `${o.isFinalReminder ? "最後提醒｜" : ""}訂單還沒完成付款 ${o.order_no}｜問爽的 WenSong`, html };
}

/*
 * 刷卡失敗後的救援信。
 *
 * 為什麼需要：金流回報失敗之後，訂單被標成已取消、庫存放回去，然後我們什麼都不做。
 * 顧客那邊看到的是一個失敗畫面，多數人就走了。實際發生過三筆合計 NT$3,965
 * 就這樣安靜地流失，而其中兩位其實只是卡在內建瀏覽器的 3D 驗證。
 *
 * 這封信要先講「沒有扣款」，那是對方最擔心的事。再講「不是你的卡的問題」，
 * 不然她會以為自己額度不夠而放棄。最後才給連結。順序反過來效果會差很多。
 */
export function sendOrderFailedMail(o: OrderResume & { reason?: string }) {
  const site = siteUrl();
  /* 姓名是顧客自己在結帳表單打的，一律跳脫再進 HTML；空字串才退回「你」 */
  const name = esc(o.name) || "你";
  const payUrl = (m?: string) =>
    `${site}/api/orders/pay?no=${encodeURIComponent(o.order_no)}&t=${encodeURIComponent(o.token)}${m ? `&m=${encodeURIComponent(m)}` : ""}`;
  const btn = (href: string, label: string, primary = false) =>
    `<a href="${href}" style="display:inline-block;margin:0 6px 8px 0;padding:11px 22px;font-size:14.5px;letter-spacing:.08em;
       border:2px solid #3A3226;text-decoration:none;${primary ? "background:#B8402C;color:#EFE3C4;" : "background:#EFE3C4;color:#3A3226;"}">${label}</a>`;

  const html = wrap(
    "你的付款沒有完成，也沒有扣款",
    `<p style="font-size:15px;line-height:2;">${name}好，你剛才那筆訂單的付款沒有完成。</p>
     <p style="font-size:15px;line-height:2;"><b>先跟你說最重要的事：這筆沒有扣到款</b>，你的帳戶不會有任何扣款紀錄。</p>
     <p style="font-size:13.5px;color:#7C7060;line-height:2;">
       刷卡沒過多半是卡片在跟發卡銀行做驗證時中斷了，跟你的卡有沒有額度通常沒有關係。
       如果你剛才是從 Facebook 或 Instagram 的內建瀏覽器點進來的，那種瀏覽器在跳轉到付款頁時特別容易斷掉。</p>
     <p style="font-size:15px;line-height:2;">商品先幫你留著了。下面任一種方式都可以直接接續付款，<b>資料不用重填</b>：</p>
     <p style="margin-top:14px;">
       ${isPayMethodOff("ATM 轉帳") ? "" : btn(payUrl("ATM 轉帳"), "改用 ATM 轉帳（最穩）", true)}
       ${isPayMethodOff("LINE Pay") ? "" : btn(payUrl("LINE Pay"), "改用 LINE Pay")}
       ${isPayMethodOff("ATM 轉帳") && isPayMethodOff("LINE Pay") ? btn(payUrl(), "接續付款", true) : ""}
     </p>
     <p style="font-size:13px;color:#7C7060;line-height:2;margin-top:8px;">
       這兩種都不需要跳轉驗證，比較不會再斷一次。想再刷一次卡的話，
       建議先用 Safari 或 Chrome 打開我們的網站，不要在社群 App 裡面操作。</p>
     <p style="font-size:14px;color:#7C7060;margin-top:18px;">訂單編號　<b style="color:#B8402C;font-family:monospace;font-size:16px;">${esc(o.order_no)}</b>　金額　<b>${money(o.total)}</b></p>
     <table width="100%" style="border-top:2px solid #3A3226;margin-top:8px;">${itemRows(o.items)}</table>
     ${o.reason ? `<p style="font-size:12px;color:#7C7060;margin-top:12px;">金流回報：${esc(o.reason)}</p>` : ""}
     ${lineInviteHtml(o)}`
  );
  return sendMail(o.email, `付款沒有完成（沒有扣款）${o.order_no}｜問爽的 WenSong`, html, undefined, { refNo: o.order_no });
}

export function sendOrderResumeMail(o: OrderResume) {
  const { subject, html } = orderResumeMailHtml(o);
  return sendMail(o.email, subject, html, undefined, { refNo: o.order_no });
}

/*
 * 站長在後台替待付款訂單換了付款方式之後寄的連結信。
 *
 * 跟提醒信不同：這封是顧客自己要求換方式（實際案例是選了 LINE Pay 想改別的），
 * 所以只給她要的那一種一顆按鈕，不推銷別的方式，也不計入提醒次數。
 * 走的是同一張訂單、同一組權杖，所以「資料不用重填」這句是真的。
 */
export function orderPayLinkMailHtml(o: OrderResume): { subject: string; html: string } {
  const site = siteUrl();
  /* 姓名是顧客自己在結帳表單打的，一律跳脫再進 HTML；空字串才退回「你」 */
  const name = esc(o.name) || "你";
  const url = `${site}/api/orders/pay?no=${encodeURIComponent(o.order_no)}&t=${encodeURIComponent(o.token)}&m=${encodeURIComponent(o.pay_method)}`;
  const html = wrap(
    `用${esc(o.pay_method)}完成付款`,
    `<p style="font-size:15px;line-height:2;">${name}好，你的訂單付款方式已改為 <b>${esc(o.pay_method)}</b>。
       按下面的按鈕就能接續付款，<b>資料不用重填</b>${hasShipping(o) ? "，商品先幫你留著" : ""}。</p>
     <p style="margin-top:14px;">
       <a href="${url}" style="display:inline-block;margin:0 6px 8px 0;padding:11px 22px;font-size:14.5px;letter-spacing:.08em;
          border:2px solid #3A3226;text-decoration:none;background:#B8402C;color:#EFE3C4;">用${esc(o.pay_method)}付款</a>
     </p>
     <p style="font-size:13px;color:#7C7060;line-height:2;margin-top:8px;">
       按鈕打不開的話，把這條網址貼到瀏覽器：<br><span style="font-family:monospace;font-size:12.5px;word-break:break-all;">${esc(url)}</span></p>
     <p style="font-size:13px;color:#7C7060;line-height:2;">如果你沒有要求更改付款方式，直接忽略這封信就好，不會有任何扣款。</p>
     <p style="font-size:14px;color:#7C7060;margin-top:18px;">訂單編號　<b style="color:#B8402C;font-family:monospace;font-size:16px;">${esc(o.order_no)}</b>　金額　<b>${money(o.total)}</b></p>
     <table width="100%" style="border-top:2px solid #3A3226;margin-top:8px;">${itemRows(o.items)}</table>`
  );
  return { subject: `付款連結（${o.pay_method}）${o.order_no}｜問爽的 WenSong`, html };
}
export function sendOrderPayLinkMail(o: OrderResume) {
  const { subject, html } = orderPayLinkMailHtml(o);
  return sendMail(o.email, subject, html, undefined, { refNo: o.order_no });
}

/* opts.note：分批出貨時說明這批寄了什麼（多週訂單一週寄一批，一批一封信）。
   信裡不寫物流單號——站長不使用單號，寫了只會讓顧客去查一個查不到的東西。 */
export function sendOrderShippedMail(o: OrderLike, opts?: { note?: string }) {
  /* 沒有收件地址＝沒有東西要寄，這封信就不該存在。真的走到這裡代表別處有錯，
     寧可留下 log 也不要寄一封「已出貨」給一位根本沒有訂貨的人。 */
  if (!hasShipping(o)) {
    console.error("[mail] 略過出貨通知：這筆訂單沒有收件地址", o.order_no);
    return Promise.resolve(false);
  }
  const html = wrap(
    t("m_ship_title"),
    `<p style="font-size:15px;line-height:2;">${esc(o.name)} 你好，${t("m_ship_body")}</p>
     ${opts?.note ? `<p style="font-size:14.5px;line-height:2;border:2px solid #2C4A6B;padding:10px 14px;color:#2C4A6B;">${opts.note}</p>` : ""}
     <p style="font-size:14px;color:#7C7060;">訂單編號　<b style="color:#B8402C;font-family:monospace;font-size:16px;">${esc(o.order_no)}</b></p>
     <p style="font-size:13.5px;color:#7C7060;">收件／取貨：${esc(o.address)}</p>
     ${lineInviteHtml(o)}`
  );
  return sendMail(o.email, `已出貨 ${o.order_no}｜問爽的 WenSong`, html, undefined, { refNo: o.order_no });
}

/* ── 支持信 ── */
export function sendSponsorThanksMail(sp: {
  id: number; mode: string; amount: number; display_name: string; email: string;
}) {
  const monthly = sp.mode === "monthly";
  const html = wrap(
    t("m_sp_title"),
    `<p style="font-size:15px;line-height:2;">${esc(sp.display_name) || "你"}好，收到你的${monthly ? "每月" : "單次"}支持 <b>${money(sp.amount)}</b>${monthly ? "／月" : ""}。${t("m_sp_body")}</p>
     <p style="text-align:center;margin:18px 0;"><a href="${siteUrl()}/downloads/doudzao-wallpapers.zip" style="display:inline-block;border:2px solid #3A3226;background:#F5EDD8;color:#3A3226;text-decoration:none;font-size:14px;letter-spacing:.1em;padding:10px 22px;">下載豆棗手繪桌布集</a></p>
     <p style="font-size:12.5px;color:#7C7060;line-height:1.9;">收據摘要：本筆為數位內容服務${monthly ? "（每月方案，屬繼續性服務契約，隨時可停止）" : "（單次方案）"}，金額 ${money(sp.amount)}，統一發票將另行寄達。</p>
     ${monthly ? `<p style="font-size:13.5px;color:#7C7060;">${t("m_sp_monthly_note")}</p>` : ""}
     <p style="font-size:13.5px;color:#7C7060;">${t("m_sp_invoice")}</p>`,
    monthly ? stopSponsorBottom(sp.id) : ""
  );
  return sendMail(sp.email, `${monthly ? "每月支持已生效" : "收到你的支持了"}｜問爽的 WenSong`, html, undefined, { refNo: `SP${sp.id}` });
}

/* ATM 轉帳取號通知：把虛擬帳號與期限寄給支持者 */
export function sendSponsorAtmMail(sp: {
  id?: number; amount: number; display_name: string; email: string;
  bank: string; vaccount: string; expire: string;
  /* 有帶權杖才放得了「改用其他付款方式」，取號的兩個呼叫處都拿得到 */
  token?: string; mode?: string;
}) {
  const html = wrap(
    "轉帳帳號來了，等你完成這筆支持",
    `<p style="font-size:15px;line-height:2;">${esc(sp.display_name) || "你"}好，你的支持 <b>${money(sp.amount)}</b> 已取得轉帳帳號：</p>
     <p style="font-size:16px;line-height:2.2;border-left:3px solid #A87F2E;padding-left:14px;">
       銀行代碼：<b class="sans">${esc(sp.bank)}</b><br>
       虛擬帳號：<b class="sans">${esc(sp.vaccount)}</b><br>
       繳費期限：<b class="sans">${esc(sp.expire)}</b>
     </p>
     <p style="font-size:13.5px;color:#7C7060;line-height:2;">完成轉帳後系統會自動確認入帳，屆時再寄確認信與電子發票給你。若過期未轉帳，這筆支持會自動取消，不會有任何費用。</p>
     ${sp.id && sp.token ? `<p style="margin-top:14px;">${mailBtn(sponsorChooseUrl(sp.id, sp.token, sp.mode), "改用其他付款方式")}</p>
     <p style="font-size:13px;color:#7C7060;line-height:2;">已經轉帳的話就不用理會這顆按鈕。還沒轉、想改成刷卡或 LINE Pay 的話，按上面那顆換一種，換完之後就不要再轉到這組帳號了。</p>` : ""}`
  );
  return sendMail(sp.email, `轉帳帳號：${sp.vaccount}｜問爽的 WenSong`, html, undefined, { refNo: sp.id ? `SP${sp.id}` : undefined });
}

/*
 * 未完成付款提醒信：表單送出了但沒在金流頁走完的支持者。
 * 帶一個一鍵回到付款頁的連結（用建立時就存好的 pay_token 認證，不會被他人開啟）；
 * ATM 已取號的則直接把虛擬帳號寫在信裡，不另外產生新帳號。
 */
export type SponsorResume = {
  id: number; mode: string; amount: number; display_name: string; email: string;
  provider: string; pay_method: string; pay_token: string;
  atm_bank: string; atm_vaccount: string; atm_expire: string;
  /* 第二封（最後一封）提醒信：語氣要說明這是最後一次，之後不再打擾 */
  isFinalReminder?: boolean;
};

/* 信件內容獨立成純函式，方便後台預覽與本機檢視排版 */
export function sponsorResumeMailHtml(sp: SponsorResume): { subject: string; html: string } {
  /* 這裡原本有一份自己的 esc，只處理 & < > 三個字元。
     已改用上面那支共用的（多處理引號，值有時會落在 style="..." 裡）。 */
  const site = siteUrl();
  const name = esc(sp.display_name) || "你";
  const monthly = sp.mode === "monthly";
  const atm = Boolean(sp.atm_vaccount);

  /* 綠界走付款跳轉頁；LINE Pay 每次都要重新建立付款請求，所以指向 request 端點 */
  const link =
    sp.provider === "linepay"
      ? `${site}/api/linepay/request?sp=${sp.id}&t=${encodeURIComponent(sp.pay_token)}`
      : sp.provider === "ecpay"
        ? `${site}/support/pay/${sp.id}?t=${encodeURIComponent(sp.pay_token)}`
        : `${site}/support`;

  const body = atm
    ? `<p style="font-size:15px;line-height:2;">${name}好，你的支持 <b>${money(sp.amount)}</b> 已經取得轉帳帳號，但還沒收到款項。轉帳資訊再附上一次：</p>
       <p style="font-size:16px;line-height:2.2;border-left:3px solid #A87F2E;padding-left:14px;">
         銀行代碼：<b style="font-family:monospace;">${esc(sp.atm_bank)}</b><br>
         虛擬帳號：<b style="font-family:monospace;">${esc(sp.atm_vaccount)}</b><br>
         繳費期限：<b style="font-family:monospace;">${esc(sp.atm_expire)}</b>
       </p>
       <p style="font-size:13.5px;color:#7C7060;line-height:2;">若過期未轉帳，這筆支持會自動取消，不會產生任何費用。已經轉好的話請忽略這封信，入帳後系統會自動寄確認信與電子發票。</p>
       <p style="margin-top:14px;">${mailBtn(sponsorChooseUrl(sp.id, sp.pay_token, sp.mode), "改用其他付款方式")}</p>
       <p style="font-size:13px;color:#7C7060;line-height:2;">已經轉帳的話就不用理會這顆按鈕。還沒轉、想改成刷卡或 LINE Pay 的話，按上面那顆換一種，換完之後就不要再轉到這組帳號了。</p>`
    : `<p style="font-size:15px;line-height:2;">${name}好，你在網站上填好了${monthly ? "每月定額" : "單筆"}支持 <b>${money(sp.amount)}</b>${monthly ? "／月" : ""}，但付款頁面好像沒有完成，目前還沒有向你收取任何費用。</p>
       <p style="font-size:15px;line-height:2;">如果只是中途被打斷，按下面這顆按鈕就能接續完成，不用重新填一次資料：</p>
       <p style="text-align:center;margin:26px 0;">
         <a href="${link}" style="display:inline-block;background:#B8402C;color:#F5EDD8;text-decoration:none;font-size:16px;letter-spacing:.12em;padding:14px 34px;border:2px solid #3A3226;box-shadow:5px 5px 0 rgba(58,50,38,.25);">完 成 這 筆 支 持</a>
       </p>
       <p style="font-size:13.5px;color:#7C7060;line-height:2;">${
         sp.isFinalReminder
           ? "這是最後一次提醒，之後不會再打擾你。如果只是改變主意，忽略這封信就好，不會有任何費用。無論如何，謝謝你曾經想支持這些故事。"
           : "如果只是改變主意，這封信忽略就好，不會有任何費用。無論如何，謝謝你曾經想支持這些故事。"
       }</p>`;

  const title = atm ? "你的轉帳帳號還等著" : sp.isFinalReminder ? "最後一次提醒：你的支持還差一步" : "你的支持，還差最後一步";
  return {
    subject: `${atm ? "轉帳帳號提醒" : sp.isFinalReminder ? "最後提醒：還差一步就完成了" : "還差一步就完成了"}｜問爽的 WenSong`,
    html: wrap(title, body),
  };
}

export function sendSponsorResumeMail(sp: SponsorResume) {
  const { subject, html } = sponsorResumeMailHtml(sp);
  return sendMail(sp.email, subject, html, undefined, { refNo: `SP${sp.id}` });
}

export function sendSponsorChargedMail(sp: { id: number; amount: number; display_name: string; email: string }) {
  const html = wrap(
    t("m_charge_title"),
    `<p style="font-size:15px;line-height:2;">${esc(sp.display_name) || "你"}好，本月的支持 <b>${money(sp.amount)}</b> 已扣款完成。${t("m_charge_body")}</p>`,
    stopSponsorBottom(sp.id)
  );
  return sendMail(sp.email, `本月扣款完成 ${money(sp.amount)}｜問爽的 WenSong`, html, undefined, { refNo: `SP${sp.id}` });
}

/* ── 投稿確認信 ── */
export function sendSubmissionMail(s: { name: string; email: string; title: string }) {
  const html = wrap(
    t("m_sub_title"),
    `<p style="font-size:15px;line-height:2;">${esc(s.name)} 你好，你的投稿〈${esc(s.title)}〉我收到了。</p>
     <p style="font-size:14px;color:#7C7060;line-height:2;">${t("m_sub_body")}</p>`
  );
  return sendMail(s.email, `收到你的投稿了〈${s.title}〉｜問爽的 WenSong`, html);
}

/*
 * 通知整合（docs/notify-spec.md）用的通用信：標題、第一段、幾顆按鈕、下方補充。
 * 提醒、失敗、扣款失敗都走這支，文案由 lib/notify-copy 決定，這裡只負責長相。
 */
export function noticeMailHtml(inp: {
  title: string; p1: string; buttons: { href: string; label: string; primary?: boolean }[]; extraHtml?: string; footHtml?: string;
}): string {
  const btn = (b: { href: string; label: string; primary?: boolean }) =>
    `<a href="${esc(b.href)}" style="display:inline-block;margin:0 8px 10px 0;padding:12px 24px;font-size:15px;letter-spacing:.08em;
       border:2px solid #3A3226;text-decoration:none;${b.primary ? "background:#B8402C;color:#EFE3C4;" : "background:#EFE3C4;color:#3A3226;"}">${esc(b.label)}</a>`;
  return wrap(
    inp.title,
    `<p style="font-size:15px;line-height:2;white-space:pre-line;">${esc(inp.p1)}</p>
     ${inp.extraHtml || ""}
     ${inp.buttons.length ? `<p style="margin-top:16px;">${inp.buttons.map(btn).join("")}</p>` : ""}
     ${inp.footHtml || ""}`
  );
}
