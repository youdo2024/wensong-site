export function money(n: number): string {
  return "NT." + n.toLocaleString("en-US");
}
export function dollar(n: number): string {
  return "$" + n.toLocaleString("en-US");
}
export function fmtDate(iso: string): string {
  return iso.replaceAll("-", ".");
}
/*
 * 後台時間顯示：資料庫存的是 UTC（new Date().toISOString()），
 * 這裡固定位移 +8 轉成台北時間再輸出「2026.08.02 14:35」。
 * 不用 toLocaleString——伺服器的時區與語系資料不保證齊全，格式會漂移；
 * 台灣沒有夏令時間，固定位移是安全的。
 */
export function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  if (!iso || isNaN(d.getTime())) return iso || "—";
  const t = new Date(d.getTime() + 8 * 3600 * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${t.getUTCFullYear()}.${p(t.getUTCMonth() + 1)}.${p(t.getUTCDate())} ${p(t.getUTCHours())}:${p(t.getUTCMinutes())}`;
}
/*
 * 台灣時間，連字號格式（2026-08-16 23:35）。
 *
 * 資料庫存的是 UTC。以前後台表格用 fmtDateTime 轉成台灣時間，
 * 但匯出的 CSV 與幾個內頁是直接把 ISO 字串切前 16 個字，等於原封不動印出 UTC，
 * 同一筆訂單在兩個地方會差八小時。實際踩到過：對照顧客的 LINE Pay 收據時間
 * 完全對不上，差點以為是別筆交易。
 *
 * 這裡跟 fmtDateTime 只差在分隔符號：表格用點好看，CSV 要連字號，
 * 不然 Excel 與 Google 試算表不會把它當成時間。
 */
export function fmtDateTimeDash(iso: string): string {
  const d = new Date(iso);
  if (!iso || isNaN(d.getTime())) return iso || "";
  const t = new Date(d.getTime() + 8 * 3600 * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${t.getUTCFullYear()}-${p(t.getUTCMonth() + 1)}-${p(t.getUTCDate())} ${p(t.getUTCHours())}:${p(t.getUTCMinutes())}`;
}

export const ORDER_STATUS: Record<string, string> = {
  pending: "待付款",
  paid: "已付款",
  shipped: "已出貨",
  done: "已完成",
  cancelled: "已取消",
  /* 已收款後退還（退刷／退匯）。跟已取消不同：取消＝沒收到錢、庫存自動回補；
     退款＝錢進來又退回去，結算報表要列負項把該夥伴的銷售額沖回來，庫存不自動動
     （食品退回多半直接報廢，要補庫存站長自己在商品頁改）。 */
  refunded: "已退款",
};
export const SPONSOR_STATUS: Record<string, string> = {
  active: "扣款中",
  paid: "已付款",
  cancelled: "已取消",
  pending: "待付款",
  failed: "付款失敗",
  /* 連續兩期扣款失敗會被 lib/remind.ts 標成 paused。少了這一條，
     後台那一格顯示空白，站長看到的是「這筆贊助沒有狀態」而不是「已經停扣了」。 */
  paused: "已暫停扣款",
};
