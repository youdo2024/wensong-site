import type { StatusTone } from "./StatusBar";

/*
 * 訂單列表用的兩個純函式：相對時間與狀態語意色。
 *
 * 為什麼要抽出來：手機一行一單只有兩層，時間那一格塞不下「2026.09.05 10:12」，
 * 站長真正要判斷的是「這筆是剛剛的還是上禮拜的」，不是精確到秒。
 * 抽成純函式的另一個理由是它可以被 tests/smoke.ts 驗，
 * 時間換算寫錯（少了台北 +8）不會在畫面上看得出來，只會讓「今天」變成「昨天」。
 *
 * 放在 components/admin/ 而不是 lib/：這一批不動 lib/**。
 */

/* 資料庫存 UTC ISO；台灣沒有夏令時間，固定位移 +8 就是台北的日曆日 */
function twParts(d: Date): { y: number; m: number; d: number; hh: string; mm: string } {
  const t = new Date(d.getTime() + 8 * 3600 * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate(), hh: p(t.getUTCHours()), mm: p(t.getUTCMinutes()) };
}

/*
 * 相對時間：今天只給時分、昨天就寫「昨天」、再往前給月/日、跨年才補年份。
 * now 可以外傳是為了測得動，正式呼叫都用預設值。
 */
export function relTime(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  if (!iso || Number.isNaN(d.getTime())) return "—";
  const a = twParts(d);
  const n = twParts(now);
  if (a.y === n.y && a.m === n.m && a.d === n.d) return `${a.hh}:${a.mm}`;
  /* 昨天要用「台北日曆日差一天」判斷，不能用 24 小時：凌晨一點看昨天下午的單也該顯示昨天 */
  const y = twParts(new Date(now.getTime() - 86400_000));
  if (a.y === y.y && a.m === y.m && a.d === y.d) return "昨天";
  if (a.y !== n.y) return `${a.y}/${a.m}/${a.d}`;
  return `${a.m}/${a.d}`;
}

/*
 * 狀態決定語意色。跟訂單詳情頁同一把尺：待處理琥珀、完成綠、失敗與取消朱紅，其餘灰。
 * 四個顏色，沒有第五個。
 */
export function statusTone(status: string): StatusTone {
  if (status === "pending") return "pending";
  if (status === "paid" || status === "shipped" || status === "done") return "ok";
  if (status === "cancelled" || status === "refunded" || status === "failed") return "fail";
  return "muted";
}

/* 編號末四碼：一行一單的寬度放不下完整編號，末四碼已經足以辨識是哪一筆 */
export function orderLast4(orderNo: string): string {
  return String(orderNo || "").slice(-4);
}
