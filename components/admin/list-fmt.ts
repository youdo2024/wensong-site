import type { StatusTone } from "./StatusBar";
import type { ContactReason } from "@/lib/contact-queue";

/*
 * 發送、名單、待聯絡、投稿四頁共用的純函式（改版第五批）。
 *
 * 為什麼要抽出來：這幾個判斷都是「錯了畫面不會壞，只會讓人判斷錯」的那一種。
 * 分頁挑錯只是多按一下，但語意色挑錯會讓站長把該打電話的那一筆看成沒事的，
 * 那種錯誤沒有任何畫面異常可以提醒他，只有測試盯得住。
 *
 * 放在 components/admin/ 而不是 lib/：這一批不動 lib/**（admin-ui-spec 第七節）。
 */

/* ── 發送頁的四個分頁 ── */
export type MailTab = "mail" | "sms" | "line" | "log";
const MAIL_TABS: MailTab[] = ["mail", "sms", "line", "log"];

/*
 * 發送頁一進來要停在哪一個分頁。
 *
 * 三條規則，由強到弱：
 * 1. 網址明講 ?tab=sms 就聽它的（分頁自己切換時會把它寫進網址）。
 * 2. 錨點 #log 要能用：訂單頁、待聯絡頁、還有這頁自己的「再看 100 筆」都連到
 *    /admin/mail?...#log，改版之後紀錄躲在分頁裡，錨點捲不到就等於那些連結全壞了。
 * 3. 帶著寄件紀錄的篩選參數（q／n／owner／test）進來的，要的一定是紀錄，
 *    不是手寫信；那些參數只有紀錄那張表在用。
 * 其餘一律停在「信」，因為這頁九成是拿來寄一封手寫信的。
 */
export function mailTabFromParams(
  sp: { tab?: string; q?: string; n?: string; owner?: string | string[]; test?: string | string[] },
  hash?: string
): MailTab {
  const t = String(sp.tab || "");
  if ((MAIL_TABS as string[]).includes(t)) return t as MailTab;
  if (String(hash || "").replace(/^#/, "") === "log") return "log";
  const has = (v: string | string[] | undefined) =>
    Array.isArray(v) ? v.some((x) => String(x || "") !== "") : String(v || "") !== "";
  if (has(sp.q) || has(sp.n) || has(sp.owner) || has(sp.test)) return "log";
  return "mail";
}

/* ── 待聯絡的四種原因對到語意色 ── */
/*
 * 靛藍已經從後台拿掉（admin-ui-spec 第二節），原本 pending_long 用的就是靛藍。
 * 退信與刷卡失敗＝朱紅（這個人現在收不到、或錢真的沒收到）；
 * ATM 快到期與拖太久＝琥珀（還有救，是要去催的那一種）。
 */
export function contactTone(reason: ContactReason): StatusTone {
  if (reason === "bad_email" || reason === "card_failed") return "fail";
  return "pending";
}

/* ── 投稿狀態 ── */
/*
 * 資料庫只有 new 與 read 兩個值（app/admin/actions.ts 的 markSubmissionRead 只寫 read），
 * 沒有「已採用」「已退回」這兩種狀態可以讀。採用是站長自己寄一封載明稿費的信，
 * 契約才成立，系統從頭到尾沒有記過那件事。
 * 這裡只翻譯真的存在的狀態，不編一個看起來很像真的的欄位出來。
 */
export function submissionTone(status: string): StatusTone {
  return status === "new" ? "pending" : "muted";
}
export function submissionStatusLabel(status: string): string {
  return status === "new" ? "待審" : "已看過";
}

/* ── 付款連結與電子報的狀態（改版第六批）──
 *
 * 抽出來的理由跟上面同一條：這兩張表的狀態色錯了畫面完全正常。
 * 付款連結的「可用」是琥珀（錢還沒進來、要去追對方付款），
 * 挑成綠的話站長掃過一整頁會以為那幾條都收到錢了，那是會漏帳的錯。
 * 電子報的「草稿」與「寄送中」都是琥珀（還沒完成的事），只有「已寄完」是綠。
 */
export function payLinkStatus(status: string): [string, StatusTone] {
  if (status === "open") return ["可用", "pending"];
  if (status === "used") return ["已成立訂單", "ok"];
  if (status === "released") return ["已作廢／已到期", "muted"];
  return ["—", "muted"];
}

export function newsletterStatus(status: string): [string, StatusTone] {
  if (status === "draft") return ["草稿", "pending"];
  if (status === "sending") return ["寄送中", "pending"];
  if (status === "sent") return ["已寄完", "ok"];
  return [status, "muted"];
}

/* ── 地圖廚師的搜尋（2026-09-06）── */

/*
 * 清單上有 85 位，要找某一位只能用瀏覽器的 Ctrl+F，而手機沒有那個。
 * 比對姓名、店名、縣市三欄就夠：站長找人的時候腦子裡想的就是這三件事之一。
 *
 * 大小寫不分（英文店名常常大小寫不一致），前後空白去掉，
 * 空字串一律回 true：沒有輸入關鍵字時不該把任何人濾掉。
 */
export function chefSearchHit(
  c: { name?: string; rest?: string; city?: string },
  keyword: string,
): boolean {
  const kw = String(keyword || "").trim().toLowerCase();
  if (!kw) return true;
  return [c.name, c.rest, c.city].some((v) => String(v || "").toLowerCase().includes(kw));
}
