import db from "./db";
import { wrapMail, mailBlocked } from "./mail";
import { findLineBinding } from "./line";
import { isMultiShip } from "./multi-ship";

/*
 * 後台手寫信：把純文字組成站上那套信件版型（米袋黃底、上下織帶、紅框感謝區）。
 *
 * 為什麼不讓站長直接寫 HTML：他要的是「跟系統信長得一樣」，不是排版自由。
 * 給一個文字框就好，段落與換行自動處理，出來的東西一定跟訂單信同一個模子。
 */

/* 使用者輸入一律逃脫。少了這一段，內文打到 < 或 & 就會把整封信的版面弄壞，
   貼進一段別處複製來的 HTML 更會直接破版。 */
function esc(s: string): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

export type AdminMailInput = {
  title: string;       // 信件大標（版型裡那行襯線大字）
  body: string;        // 純文字內文，空行分段
  btnText?: string;    // 可選的按鈕
  btnUrl?: string;
  footnote?: string;   // 可選的小字補充（放在按鈕下方）
  unsubscribeUrl?: string; // 電子報才有：退訂連結，放在整個框外面的最底下，小字灰色
};

/*
 * 把純文字轉成信件內文。
 * 空行分段，段落內的單一換行保留成 <br>，這樣站長在文字框裡看到的排版
 * 跟收件人看到的一致，不用去想 HTML。
 */
function paragraphs(text: string): string {
  return String(text || "")
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p style="font-size:15px;line-height:2;margin:0 0 14px;">${esc(p).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

export function buildAdminMail(input: AdminMailInput): string {
  const btn =
    input.btnText?.trim() && input.btnUrl?.trim()
      ? `<p style="margin:22px 0 0;">
           <a href="${esc(input.btnUrl.trim())}"
              style="display:inline-block;padding:13px 26px;font-size:15px;letter-spacing:.08em;
                     border:2px solid #3A3226;background:#B8402C;color:#EFE3C4;text-decoration:none;">
             ${esc(input.btnText.trim())}
           </a>
         </p>`
      : "";
  const note = input.footnote?.trim()
    ? `<p style="font-size:13px;color:#7C7060;line-height:2;margin:14px 0 0;">${esc(input.footnote.trim()).replace(/\n/g, "<br>")}</p>`
    : "";
  /* 退訂放框外最底下、11.5px 灰字：站長要求「要有，但別讓人一眼就看到」。
     藏得太深會被檢舉垃圾信，那對網域的傷害比少一個訂閱者大得多，所以還是一行完整的字，不是一個點。 */
  const below = input.unsubscribeUrl
    ? `<p style="text-align:center;font-size:11.5px;color:#9C9080;line-height:1.8;margin:18px 0 0;">
         不想再收到電子報？<a href="${esc(input.unsubscribeUrl)}" style="color:#9C9080;">取消訂閱</a>
       </p>`
    : "";
  return wrapMail(esc(input.title || "").trim() || "問爽的", `${paragraphs(input.body)}${btn}${note}`, "", { below });
}

/* 收件人：一行一個，也接受逗號或分號分隔。順便去掉重複，
   同一個人收到兩封一模一樣的信很尷尬。 */
export function parseRecipients(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of String(raw || "").split(/[\n,，;；\s]+/)) {
    const e = part.trim();
    if (!e) continue;
    const key = e.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
  }
  return out;
}

/* 一次最多寄幾封。原本 20，2026-09-05 站長要「帶入已付款未出貨的客人」一次寄，
   提到 60。還是刻意的上限：這支工具是拿來寫給特定一群人的，不是群發電子報。
   真的要群發名單，那需要退訂連結與寄送速率控制，跟這裡的用途不一樣，
   混在一起遲早會把網域寄到被列為垃圾信。 */
export const ADMIN_MAIL_MAX = 60;

/*
 * 「帶入已付款未出貨的客人」：發送頁那顆鈕的名單。
 *
 * 規則（站長 2026-09-05）：已付款且還沒全部出貨、信箱去重、跳過標記寄不到的、
 * 跳過已經綁 LINE 的（他們已經在 LINE 上收得到出貨通知，不用再邀）。
 * 多地址企業單看收件名單：名單還沒補或還有人沒出，都算未出貨。
 */
export function paidUnshippedEmails(): string[] {
  const rows = db.prepare(
    "SELECT email,phone,ship_method,COALESCE(ship_list,'') ship_list FROM orders WHERE status='paid' ORDER BY id DESC",
  ).all() as { email: string; phone: string; ship_method: string; ship_list: string }[];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const o of rows) {
    const email = String(o.email || "").trim();
    const key = email.toLowerCase();
    if (!email || seen.has(key)) continue;
    if (!isUnshipped(o)) continue;
    if (mailBlocked(email)) continue;
    const b = findLineBinding({ email, phone: o.phone || "" });
    if (b && b.status === "bound") continue;
    seen.add(key);
    out.push(email);
  }
  return out;
}

/* 純函式，smoke 測試驗：非多地址的已付款單一律未出貨；多地址看名單 */
export function isUnshipped(o: { ship_method: string; ship_list: string }): boolean {
  if (!isMultiShip(o.ship_method)) return true;
  let list: { shipped?: number }[] = [];
  try { list = JSON.parse(o.ship_list || "[]"); } catch { list = []; }
  if (list.length === 0) return true;
  return list.some((r) => !r.shipped);
}
