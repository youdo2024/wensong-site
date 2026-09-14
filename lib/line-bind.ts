import crypto from "crypto";
import { appSecret } from "./app-secret";

/* 綁定流程用的短效 cookie：/line/bind 寫、/api/auth/line/callback 讀。Route 檔不能匯出非 handler 的東西，所以放這裡 */
export const BIND_COOKIE = "yo_line_bind";

/*
 * 與後台同一組金鑰解析（環境變數 → 資料庫的 instance_secret → 正式環境直接炸掉）。
 * 原本只看環境變數，沒設就退回原始碼裡的固定字串——而正式站的金鑰是放在
 * 資料庫的 instance_secret，所以這條路實際上一直在用那個公開字串簽 cookie，
 * 任何看過 repo 的人都能自己簽一張綁定或贊助 cookie 出來。
 * 加上 ".linebind" 做用途分隔，這裡的簽章不能拿去當後台 session 用。
 */
function secret() {
  return appSecret() + ".linebind";
}
export function signBind(payload: string): string {
  return crypto.createHmac("sha256", secret()).update(payload).digest("hex");
}
export function makeBindCookie(orderNo: string, token: string, src: string): string {
  const payload = `${orderNo}|${token}|${src}|${Date.now() + 10 * 60_000}`;
  return `${payload}.${signBind(payload)}`;
}
/* 解開並驗簽；過期或簽不對就當沒有 */
export function parseBindCookie(raw: string | undefined): { orderNo: string; token: string; src: string } | null {
  if (!raw) return null;
  const dot = raw.lastIndexOf(".");
  if (dot < 0) return null;
  const payload = raw.slice(0, dot);
  if (signBind(payload) !== raw.slice(dot + 1)) return null;
  const [orderNo, token, src, exp] = payload.split("|");
  if (!orderNo || !token || Number(exp) < Date.now()) return null;
  return { orderNo, token, src: src || "thanks" };
}

/*
 * 贊助流程的「這個瀏覽器剛完成哪一筆贊助」cookie：/support/actions 建單時寫，感謝頁讀。
 * 金流回跳的感謝頁網址不一定帶贊助編號（Portaly、模擬模式只有 mode），沒有這個 cookie 感謝頁就不知道該把誰導去加 LINE。
 * 兩小時：客人可能在付款頁停很久。
 */
export const SPONSOR_COOKIE = "yo_sp";
export function makeSponsorCookie(id: number, token: string): string {
  const payload = `${id}|${token}|${Date.now() + 2 * 60 * 60_000}`;
  return `${payload}.${signBind(payload)}`;
}
export function parseSponsorCookie(raw: string | undefined): { id: number; token: string } | null {
  if (!raw) return null;
  const dot = raw.lastIndexOf(".");
  if (dot < 0) return null;
  const payload = raw.slice(0, dot);
  if (signBind(payload) !== raw.slice(dot + 1)) return null;
  const [id, token, exp] = payload.split("|");
  if (!Number(id) || !token || Number(exp) < Date.now()) return null;
  return { id: Number(id), token };
}
