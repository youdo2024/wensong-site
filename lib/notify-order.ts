/*
 * 訂單通知的單一入口（站長 2026-09-03：「太多地方能發，整合到同一個地方」）。
 *
 * 以前一張訂單能從四個地方通知客人：訂單列表的提醒信、訂單頁的重寄信、訂單頁的推 LINE、
 * 簡訊頁的單獨寄一則。每一條路各自判斷「這個人收得到嗎」，判斷還不一樣。
 * 現在三種管道都從這裡走：先看 orderChannels() 說哪些管道走得通，再用 notifyOrder() 一次發。
 * 自動對帳的待繳費通知（reconcile.ts）沿用同一個「LINE 先、退回簡訊」規則，見 sendPaymentReminder()。
 */
import db from "@/lib/db";
import {
  mailEnabled, mailBlocked, sendMail, wrapMail,
  sendOrderAtmMail, sendOrderCreatedMail, sendOrderPaidMail, sendOrderShippedMail, sendOrderResumeMail, sendOrderFailedMail,
} from "@/lib/mail";
import { sendSms, smsReady, pendingSms, failedSms, payUrlFor, payShortUrl } from "@/lib/sms";
import { shortUrl, type ShortChannel } from "@/lib/short-link";
import {
  lineEnabled, lineNotifyOn, lineStatusForOrder, notifyOrderLine, lineTemplate, renderLine, composeLine, pushLine,
  orderStatusUrl, lineInviteSmsLine, type LineBinding, type LineReason,
} from "@/lib/line";

export type NotifyKind = "atm" | "created" | "paid" | "shipped" | "pending" | "failed" | "custom";
export const NOTIFY_KINDS: { key: NotifyKind; label: string }[] = [
  { key: "pending", label: "待付款提醒（附免重填的付款連結）" },
  { key: "atm", label: "繳費資訊（ATM／超商取號後）" },
  { key: "created", label: "訂單確認（剛成立）" },
  { key: "paid", label: "付款完成" },
  { key: "shipped", label: "已出貨" },
  { key: "failed", label: "付款失敗，請重新付款" },
  { key: "custom", label: "自訂內容（下面的主旨與內文）" },
];

export type OrderForNotify = {
  id: number; order_no: string; name: string; email: string; phone: string; address: string; items: string;
  subtotal: number; shipping: number; total: number; status: string; pay_method: string; pay_note: string; token: string;
  remind_count: number; invoice_type?: string; invoice_data?: string;
  addon_amount?: number; discount_amount?: number; discount_code?: string;
};

export function loadOrderForNotify(id: number): OrderForNotify | undefined {
  const o = db.prepare("SELECT * FROM orders WHERE id=?").get(id) as (OrderForNotify & { phone: string | null }) | undefined;
  if (!o) return undefined;
  return { ...o, phone: o.phone || "", pay_note: o.pay_note || "", token: o.token || "", remind_count: o.remind_count || 0 };
}

export type ChannelState = { ok: boolean; why: string; binding?: LineBinding };
export type Channels = { mail: ChannelState; sms: ChannelState; line: ChannelState };

/* 這位客人三種管道各自走不走得通。畫面直接照這個顯示，發送前再擋一次 */
export function orderChannels(o: Pick<OrderForNotify, "email" | "phone">): Channels {
  const mail: ChannelState = !o.email
    ? { ok: false, why: "沒留信箱" }
    : mailBlocked(o.email)
      ? { ok: false, why: "這個信箱已標記寄不到" }
      : !mailEnabled()
        ? { ok: false, why: "還沒設定寄信服務（SMTP）" }
        : { ok: true, why: "" };
  const phone = String(o.phone || "").replace(/\D/g, "");
  const ready = smsReady();
  const sms: ChannelState = !phone
    ? { ok: false, why: "沒留電話" }
    : !/^09\d{8}$/.test(phone)
      ? { ok: false, why: "電話不是台灣手機格式" }
      : !ready.ok
        ? { ok: false, why: ready.why }
        : { ok: true, why: "" };
  let line: ChannelState;
  if (!lineEnabled()) line = { ok: false, why: "還沒設定 LINE 金鑰" };
  else {
    const st = lineStatusForOrder(o);
    if (!st.binding) line = { ok: false, why: "沒綁 LINE" };
    else if (st.binding.status !== "bound") line = { ok: false, why: st.label, binding: st.binding };
    else if (!lineNotifyOn()) line = { ok: false, why: "已綁定，但 LINE 通知總開關關著（網站設定）", binding: st.binding };
    else line = { ok: true, why: "", binding: st.binding };
  }
  return { mail, sms, line };
}

export type ChannelResult = { ok: boolean; error: string };
export type NotifyResult = { mail?: ChannelResult; sms?: ChannelResult; line?: ChannelResult };

const LINE_WHY: Record<LineReason, string> = {
  sent: "", disabled: "LINE 通知總開關關著", not_bound: "沒綁 LINE", blocked: "這個人封鎖了或沒加好友",
  test_mode: "測試模式中，這個 userId 不在白名單", quota: "本月 LINE 額度用完", failed: "LINE 回錯",
};

function atmInfoOf(o: OrderForNotify): string {
  return /繳費帳號[^。]*/.exec(o.pay_note || "")?.[0] || "";
}

/*
 * 這一則要附的網址。channel 給了就換成站內短網址（lib/short-link.ts）：
 * 簡訊有 268 字的硬上限，而且每個管道各一組碼，點擊數才歸得了管道。
 */
function urlFor(o: OrderForNotify, kind: NotifyKind, channel?: ShortChannel): string {
  if (!o.token) return "";
  const long = kind === "pending" || kind === "failed" || kind === "created"
    ? payUrlFor(o.order_no, o.token)
    : orderStatusUrl(o.order_no, o.token);
  return channel ? shortUrl(long, channel) : long;
}

/* 簡訊與 LINE 用的純文字。待付款／付款失敗有簡訊模板；其餘借用 LINE 模板（同一組變數，也是純文字） */
function plainTextFor(o: OrderForNotify, kind: Exclude<NotifyKind, "custom">): string {
  const name = (o.name || "").trim();
  if (kind === "pending") return pendingSms({ order_no: o.order_no, total: o.total, name, remind_count: o.remind_count });
  if (kind === "failed") return failedSms({ order_no: o.order_no, name });
  if (kind === "created") return `${name ? name + "你好，" : ""}訂單 ${o.order_no} 已成立，金額 ${o.total} 元，付款請點下方連結`;
  return renderLine(lineTemplate(kind), { name, order: o.order_no, total: String(o.total), info: kind === "atm" ? o.pay_note : "", url: "", title: "" });
}

/*
 * 一次發。channels 勾哪些發哪些；發不出去的管道回 error，不丟例外，
 * 因為一個管道失敗不該讓另外兩個也不發（信寄出去了，簡訊失敗，那次通知就是成功的）。
 */
export async function notifyOrder(
  o: OrderForNotify,
  kind: NotifyKind,
  channels: { mail?: boolean; sms?: boolean; line?: boolean },
  custom: { subject?: string; body?: string; url?: string } = {}
): Promise<NotifyResult> {
  const ch = orderChannels(o);
  const r: NotifyResult = {};
  /*
   * 三個管道各自拿一組短網址，不共用同一條：
   * 共用的話點擊數只會告訴你「有人點了」，分不出是信有效還是簡訊有效。
   * 自訂內容那一種站長可能貼站外網址，shortUrl 縮不了就原樣回傳。
   */
  const rawUrl = kind === "custom" ? (custom.url || "").trim() : "";
  const urlOf = (channel: ShortChannel) => (kind === "custom" ? (rawUrl ? shortUrl(rawUrl, channel) : "") : urlFor(o, kind, channel));
  const body = (custom.body || "").trim();
  const subject = (custom.subject || "").trim();
  if (kind === "custom" && !body) return { mail: { ok: false, error: "自訂內容是空的" } };

  if (channels.mail) {
    if (!ch.mail.ok) r.mail = { ok: false, error: ch.mail.why };
    else {
      let ok = false;
      try {
        const resume = { ...o, atmInfo: atmInfoOf(o), isFinalReminder: o.remind_count >= 1 };
        if (kind === "atm") ok = atmInfoOf(o) ? await sendOrderAtmMail(o) : false;
        else if (kind === "created") ok = await sendOrderCreatedMail(o);
        else if (kind === "paid") ok = await sendOrderPaidMail(o);
        else if (kind === "shipped") ok = await sendOrderShippedMail(o);
        else if (kind === "pending") ok = await sendOrderResumeMail(resume);
        else if (kind === "failed") ok = await sendOrderFailedMail(resume);
        else {
          const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] || c);
          const mailUrl = urlOf("mail");
          const html = body.split(/\n{2,}/).map((p) => `<p style="line-height:1.9;margin:0 0 14px;">${esc(p).replace(/\n/g, "<br>")}</p>`).join("") +
            (mailUrl ? `<p style="margin:18px 0 0;"><a href="${esc(mailUrl)}" style="display:inline-block;padding:11px 22px;border:2px solid #3A3226;background:#B8402C;color:#EFE3C4;text-decoration:none;">前往</a></p>` : "");
          ok = await sendMail(o.email, subject || `關於你的訂單 ${o.order_no}`, wrapMail(subject || "關於你的訂單", html), undefined, { refNo: o.order_no, keepBody: true });
        }
      } catch (e) { console.error("[notify] mail", o.order_no, kind, e); }
      r.mail = { ok, error: ok ? "" : kind === "atm" && !atmInfoOf(o) ? "這張單還沒取號，沒有繳費資訊可寄" : "寄信失敗" };
    }
  }

  if (channels.line) {
    if (!ch.line.ok) r.line = { ok: false, error: ch.line.why };
    else if (kind === "custom" || kind === "created") {
      const lr = await pushLine({ lineUserId: ch.line.binding!.line_user_id, text: composeLine(kind === "custom" ? body : plainTextFor(o, kind), urlOf("line")), kind: kind === "custom" ? "manual" : kind, orderNo: o.order_no });
      r.line = { ok: lr.ok, error: lr.ok ? "" : lr.error || LINE_WHY[lr.reason] };
    } else {
      const lr = await notifyOrderLine(kind, o, { info: kind === "atm" ? o.pay_note : "", url: urlOf("line") });
      r.line = { ok: lr.ok, error: lr.ok ? "" : lr.error || LINE_WHY[lr.reason] };
    }
  }

  if (channels.sms) {
    if (!ch.sms.ok) r.sms = { ok: false, error: ch.sms.why };
    else {
      const text = kind === "custom" ? body : plainTextFor(o, kind);
      const sr = await sendSms({ phone: o.phone, body: text, url: urlOf("sms"), kind: kind === "custom" ? "manual" : kind });
      r.sms = { ok: sr.ok, error: sr.ok ? "" : sr.error };
    }
  }
  return r;
}

/*
 * 待付款提醒的固定規則（列表那顆按鈕與自動對帳都是這一套）：
 * 信一定寄；LINE 有綁就推；LINE 沒推成功才發簡訊，簡訊多一行邀請綁 LINE。
 * 信寄成功才算一次提醒（remind_count 加一）；簡訊或 LINE 失敗不影響計數。
 */
export async function sendPaymentReminder(o: OrderForNotify): Promise<NotifyResult & { counted: boolean }> {
  const r: NotifyResult & { counted: boolean } = { counted: false };
  const mail = await notifyOrder(o, "pending", { mail: true });
  r.mail = mail.mail;
  if (!r.mail?.ok) return r;
  db.prepare("UPDATE orders SET remind_at=?, remind_count=? WHERE id=?").run(new Date().toISOString(), o.remind_count + 1, o.id);
  r.counted = true;
  /* LINE 與簡訊各一組短網址：點擊數要分得出這個人是從哪一則點進來的 */
  const lr = await notifyOrderLine("pending", o, { url: payShortUrl(o.order_no, o.token, "line") });
  r.line = { ok: lr.ok, error: lr.ok ? "" : lr.error || LINE_WHY[lr.reason] };
  if (lr.ok) return r;
  const ch = orderChannels(o);
  if (!ch.sms.ok) { r.sms = { ok: false, error: ch.sms.why }; return r; }
  const sr = await sendSms({
    phone: o.phone,
    body: pendingSms({ order_no: o.order_no, total: o.total, name: o.name, remind_count: o.remind_count }) + lineInviteSmsLine(lr.reason, o.token, o.order_no),
    url: payShortUrl(o.order_no, o.token, "sms"), kind: "pending",
  });
  r.sms = { ok: sr.ok, error: sr.ok ? "" : sr.error };
  return r;
}

/* 給畫面看的一句話：「Email 已寄・LINE 已推・簡訊 未送（沒留電話）」 */
export function notifySummary(r: NotifyResult): string {
  const part = (label: string, x: ChannelResult | undefined, verb: string) => (x ? `${label} ${x.ok ? "已" : "未"}${verb}${x.ok ? "" : `（${x.error}）`}` : "");
  return [part("Email", r.mail, "寄"), part("LINE", r.line, "推"), part("簡訊", r.sms, "送")].filter(Boolean).join("・");
}
