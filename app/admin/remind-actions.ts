"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import db from "@/lib/db";
import { isAdmin } from "@/lib/auth";
import {
  loadOrderTarget, loadSponsorTarget, sendNotice, countManualRemind, setRemindStop, setContacted,
  type Kind, type Target,
} from "@/lib/remind";

/*
 * 提醒中心（/admin/remind）的四個動作。守門方式與 app/admin/actions.ts 的 guard() 相同：
 * 不是站長就送去登入頁。做完一律回提醒中心，結果用 ?ok= 或 ?err= 一句話帶回去。
 */
async function guard() {
  if (!(await isAdmin())) redirect("/admin/login");
}

/* 回提醒中心，保留當時選的篩選分頁 */
function back(formData: FormData, q: string): never {
  const f = String(formData.get("f") || "");
  redirect(`/admin/remind?${f ? `f=${encodeURIComponent(f)}&` : ""}${q}`);
}

function pick(formData: FormData): { kind: Kind; id: number; t: Target | undefined } {
  const kind: Kind = String(formData.get("kind") || "") === "sponsor" ? "sponsor" : "order";
  const id = Number(formData.get("id")) || 0;
  const t = kind === "order" ? loadOrderTarget(id) : loadSponsorTarget(id);
  return { kind, id, t };
}

/* 「Email 已寄・LINE 未推（沒綁 LINE）・簡訊 已送」 */
function summary(r: Record<string, { ok: boolean; why: string }>): string {
  const part = (label: string, x: { ok: boolean; why: string } | undefined, verb: string) =>
    x ? `${label} ${x.ok ? "已" : "未"}${verb}${x.ok && x.why === "dry" ? "（只記錄不寄）" : x.ok ? "" : `（${x.why}）`}` : "";
  return [part("Email", r.mail, "寄"), part("LINE", r.line, "推"), part("簡訊", r.sms, "送")].filter(Boolean).join("・");
}
function anyOk(r: Record<string, { ok: boolean; why: string }>): boolean {
  return Boolean(r.mail?.ok || r.line?.ok || r.sms?.ok);
}

/*
 * 一鍵提醒：待付款照規則寄第 N 次（最多算到第 3 次的文案），並算成一次手動提醒、從現在重新計時。
 * 已判失敗的那筆沒有「繼續付款」可接，改寄付款失敗通知（換個方式再試），不算提醒次數。
 */
export async function remindNow(formData: FormData) {
  await guard();
  const { kind, id, t } = pick(formData);
  if (!t) back(formData, "err=" + encodeURIComponent("查無這筆紀錄"));
  let r: Record<string, { ok: boolean; why: string }>;
  if (t!.status === "pending") {
    const seq = Math.min(3, t!.remind_seq + 1);
    r = await sendNotice(t!, `remind${seq}`, { force: true });
    countManualRemind(kind, id);
  } else {
    r = await sendNotice(t!, "failed", { force: true });
  }
  revalidatePath("/admin/remind");
  back(formData, `${anyOk(r) ? "ok" : "err"}=${encodeURIComponent(`${t!.no}：${summary(r)}`)}`);
}

/*
 * 分管道一鍵（站長 2026-09-04）：點 LINE 就只推 LINE、點 Email 就只寄信、點「電子豹簡訊」就只發簡訊。
 * 待付款照這筆走到第幾次選文案並算一次、重新計時；已失敗的寄失敗通知不算次數。手動不套深夜延後。
 * back 參數決定做完回哪一頁（提醒中心／訂單列表／贊助列表）。
 */
export async function remindVia(formData: FormData) {
  await guard();
  const { kind, id, t } = pick(formData);
  const channel = String(formData.get("channel") || "");
  const to = String(formData.get("back") || "");
  const go = (q: string): never => {
    if (to === "orders") redirect(`/admin/orders?remind=${q.startsWith("ok") ? "ok" : "fail"}&detail=${encodeURIComponent(q.replace(/^(ok|err)=/, ""))}`);
    if (to === "sponsors") redirect(`/admin/sponsors?${q}`);
    back(formData, q);
  };
  if (!t) go("err=" + encodeURIComponent("查無這筆紀錄"));
  if (!["mail", "line", "sms"].includes(channel)) go("err=" + encodeURIComponent("沒有這個管道"));
  const event = t!.status === "pending" ? `remind${Math.min(3, t!.remind_seq + 1)}` : "failed";
  const r = await sendNotice(t!, event, { channels: { [channel]: true }, force: true });
  if (t!.status === "pending" && anyOk(r)) countManualRemind(kind, id);
  revalidatePath("/admin/remind"); revalidatePath("/admin/orders"); revalidatePath("/admin/sponsors");
  go(`${anyOk(r) ? "ok" : "err"}=${encodeURIComponent(`${t!.no}：${summary(r)}`)}`);
}

/* 站長按「用訊息 App」：由客戶端元件呼叫，記錄並算一次，然後客戶端自己開 sms: 連結 */
export async function markSmsAppSent(kind: Kind, id: number): Promise<void> {
  await guard();
  const { markSmsApp } = await import("@/lib/remind");
  markSmsApp(kind, id);
  revalidatePath("/admin/remind"); revalidatePath("/admin/orders"); revalidatePath("/admin/sponsors");
}

const EVENTS = ["remind1", "remind2", "remind3", "failed"] as const;

/* 選管道與內容：自己挑通知種類、勾管道、要的話換主旨與內文 */
export async function remindCustom(formData: FormData) {
  await guard();
  const { kind, id, t } = pick(formData);
  if (!t) back(formData, "err=" + encodeURIComponent("查無這筆紀錄"));
  const event = String(formData.get("event") || "");
  if (!(EVENTS as readonly string[]).includes(event)) back(formData, "err=" + encodeURIComponent("沒有這種通知"));
  const channels = {
    mail: String(formData.get("ch_mail") || "") === "1",
    line: String(formData.get("ch_line") || "") === "1",
    sms: String(formData.get("ch_sms") || "") === "1",
  };
  if (!channels.mail && !channels.line && !channels.sms) back(formData, "err=" + encodeURIComponent("至少勾一個管道"));
  const subject = String(formData.get("subject") || "").trim();
  const body = String(formData.get("body") || "").trim();
  const r = await sendNotice(t!, event, { channels, custom: subject || body ? { subject, body } : undefined, force: true });
  if (event.startsWith("remind")) countManualRemind(kind, id);
  revalidatePath("/admin/remind");
  back(formData, `${anyOk(r) ? "ok" : "err"}=${encodeURIComponent(`${t!.no}：${summary(r)}`)}`);
}

/* 停止自動提醒／恢復 */
export async function toggleRemindStop(formData: FormData) {
  await guard();
  const { kind, id, t } = pick(formData);
  if (!t) back(formData, "err=" + encodeURIComponent("查無這筆紀錄"));
  const stop = !t!.remind_stop;
  setRemindStop(kind, id, stop);
  revalidatePath("/admin/remind");
  back(formData, "ok=" + encodeURIComponent(stop ? `${t!.no}：已停止自動提醒，之後只能手動寄` : `${t!.no}：已恢復自動提醒`));
}

/* 標記已聯絡／還原（自動提醒照走，只是清單上做個記號） */
export async function toggleContacted(formData: FormData) {
  await guard();
  const { kind, id, t } = pick(formData);
  if (!t) back(formData, "err=" + encodeURIComponent("查無這筆紀錄"));
  const row = db.prepare(`SELECT COALESCE(contacted_at,'') c FROM ${kind === "order" ? "orders" : "sponsorships"} WHERE id=?`).get(id) as { c: string } | undefined;
  const on = !(row?.c);
  setContacted(kind, id, on);
  revalidatePath("/admin/remind");
  revalidatePath("/admin/contact");
  back(formData, "ok=" + encodeURIComponent(on ? `${t!.no}：已標記聯絡過` : `${t!.no}：已還原成未聯絡`));
}
