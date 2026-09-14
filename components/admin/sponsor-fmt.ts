import type { StatusTone } from "./StatusBar";

/*
 * 贊助列表與提醒中心共用的純函式。
 *
 * 為什麼跟訂單的 order-fmt 分開：訂單的狀態字是 pending/paid/shipped/cancelled，
 * 贊助多了 active（扣款中）與 paused（連兩期扣失敗被停扣），少了 shipped，
 * 硬套訂單那把尺會讓「扣款中」變灰色，站長會以為那筆停了。
 *
 * 抽成純函式的理由跟 order-fmt 一樣：顏色錯了畫面不會壞，只會讓人判斷錯，
 * 只有測試盯得住。放在 components/admin/ 而不是 lib/，因為這一批不動 lib/**。
 */

/*
 * 贊助狀態決定語意色（ia.md §0 的四個語意色，沒有第五個）：
 * 待付款＝琥珀（要去催）、已付款與扣款中＝綠（正常）、付款失敗與已取消＝朱紅、其餘＝灰。
 * paused（已暫停扣款）算待處理：連兩期扣不到就是要去聯絡的人，給琥珀讓它從灰色裡跳出來（2026-09-06）。
 */
export function sponsorTone(status: string): StatusTone {
  if (status === "paused") return "pending";
  if (status === "pending") return "pending";
  if (status === "paid" || status === "active") return "ok";
  if (status === "failed" || status === "cancelled") return "fail";
  return "muted";
}

/* 類別標籤：一行一筆的姓名後面那個弱化的小字 */
export function sponsorModeLabel(mode: string): string {
  return mode === "monthly" ? "每月定額" : "單筆";
}

/*
 * 提醒中心的一列是琥珀還是朱紅：付款失敗＝朱紅，還在等付款＝琥珀，
 * 已停止自動提醒＝灰（系統不會再動它，站長也不必再看它）。
 */
export function remindTone(opts: { failed: boolean; stopped: boolean }): StatusTone {
  if (opts.stopped) return "muted";
  return opts.failed ? "fail" : "pending";
}

/* 付款方式代碑轉中文。資料庫存的是 atm／credit／linepay 這種代碼，畫面不該把代碼丟給站長看 */
const PAY_LABEL: Record<string, string> = {
  atm: "ATM 轉帳", credit: "信用卡", card: "信用卡", linepay: "LINE Pay", applepay: "Apple Pay",
  googlepay: "Google Pay", samsungpay: "Samsung Pay", cvs: "超商代碼", portaly: "Portaly", payuni: "PayUni",
};
export function sponsorPayLabel(m: string | null | undefined): string {
  const k = String(m || "").trim().toLowerCase();
  return k ? (PAY_LABEL[k] || m!) : "—";
}
/* 來源：資料庫的 direct 是「沒有帶任何來源參數直接進站」，畫面寫直接進入 */
export function sponsorSourceText(src: string | null | undefined, label: (s: string) => string): string {
  const v = String(src || "").trim();
  if (!v || v === "direct") return "直接進入";
  return label(v) || v;
}
