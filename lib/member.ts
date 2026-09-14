import { cookies } from "next/headers";
import { safeEqual } from "./safe-equal";
import crypto from "crypto";
import db from "./db";

/*
 * 購物會員（Google／LINE 社群登入）
 * - 贊助依站主指示「不」綁會員，會員只服務商店（查訂單、自動帶入、訂閱管理）
 * - 兩組環境變數擇一設定即啟用：GOOGLE_CLIENT_ID/SECRET、LINE_CHANNEL_ID/SECRET
 * - session 沿用後台的 HMAC cookie 作法，另用獨立 cookie 與密鑰前綴
 */

/* 金鑰來源與後台一致：環境變數優先，沒設就用資料庫裡的持久隨機值。
   原本沒設時會退回原始碼裡的固定字串，等於任何人都能偽造會員 session
   去看別人的訂單。用函式取值，確保資料庫初始化完成後才讀。 */
function memberSecret(): string {
  return (
    (process.env.MEMBER_SECRET ||
      process.env.ADMIN_SECRET ||
      (db.prepare("SELECT value FROM settings WHERE key='instance_secret'").get() as { value: string } | undefined)?.value ||
      "yozaiganma-dev-secret") + ".member"
  );
}
const COOKIE = "yo_member";
const STATE_COOKIE = "yo_oauth_state";

export function googleEnabled(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}
export function lineEnabled(): boolean {
  return Boolean(process.env.LINE_CHANNEL_ID && process.env.LINE_CHANNEL_SECRET);
}
export function memberEnabled(): boolean {
  return googleEnabled() || lineEnabled();
}

export function memberSiteUrl(): string {
  return (process.env.SITE_URL || "https://www.wensong.tw").replace(/\/$/, "");
}

function sign(payload: string) {
  return crypto.createHmac("sha256", memberSecret()).update(payload).digest("hex");
}

export type Member = {
  id: number; email: string; name: string; avatar: string;
  provider: string; newsletter: number; created_at: string;
};

export async function createMemberSession(userId: number) {
  const exp = Date.now() + 1000 * 60 * 60 * 24 * 30; // 30 天
  const payload = `${userId}:${exp}`;
  const store = await cookies();
  store.set(COOKIE, `${payload}.${sign(payload)}`, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
    secure: process.env.NODE_ENV === "production",
  });
}

export async function destroyMemberSession() {
  const store = await cookies();
  store.delete(COOKIE);
}

export async function getMember(): Promise<Member | null> {
  const store = await cookies();
  const raw = store.get(COOKIE)?.value;
  if (!raw) return null;
  const dot = raw.lastIndexOf(".");
  if (dot < 0) return null;
  const payload = raw.slice(0, dot);
  /* 定時比較：簽章比對不因提早不相等而洩漏時間差 */
  if (!safeEqual(sign(payload), raw.slice(dot + 1))) return null;
  const [idStr, expStr] = payload.split(":");
  if (Number(expStr) < Date.now()) return null;
  const user = db
    .prepare("SELECT id,email,name,avatar,provider,newsletter,created_at FROM users WHERE id=?")
    .get(Number(idStr)) as Member | undefined;
  return user ?? null;
}

/* 同一個 provider 帳號回來就更新資料；Email 一律轉小寫存 */
export function upsertUser(u: { provider: string; providerId: string; email: string; name: string; avatar: string }): number {
  const now = new Date().toISOString();
  const email = u.email.trim().toLowerCase();
  const existing = db
    .prepare("SELECT id,email FROM users WHERE provider=? AND provider_id=?")
    .get(u.provider, u.providerId) as { id: number; email: string } | undefined;
  if (existing) {
    db.prepare("UPDATE users SET name=?, avatar=?, email=CASE WHEN ?!='' THEN ? ELSE email END, last_login_at=? WHERE id=?")
      .run(u.name, u.avatar, email, email, now, existing.id);
    return existing.id;
  }
  /* 新會員預設訂閱新品通知（等於幫他勾好，會員中心可隨時取消）；有 Email 就同步進訂閱名單 */
  const info = db
    .prepare("INSERT INTO users (email,name,avatar,provider,provider_id,newsletter,created_at,last_login_at) VALUES (?,?,?,?,?,1,?,?)")
    .run(email, u.name, u.avatar, u.provider, u.providerId, now, now);
  if (email) {
    db.prepare("INSERT INTO subscribers (email,name,source,created_at) VALUES (?,?,?,?) ON CONFLICT(email) DO NOTHING")
      .run(email, u.name, "會員註冊", now);
  }
  return Number(info.lastInsertRowid);
}

/* ── OAuth state（防 CSRF）：HMAC 簽名的時間戳，放短效 cookie 並隨網址帶出 ── */

export async function issueOauthState(): Promise<string> {
  const state = `${Date.now()}.${crypto.randomBytes(8).toString("hex")}`;
  const signed = `${state}.${sign(state)}`;
  const store = await cookies();
  store.set(STATE_COOKIE, signed, {
    httpOnly: true, sameSite: "lax", path: "/", maxAge: 600,
    secure: process.env.NODE_ENV === "production",
  });
  return signed;
}

export async function consumeOauthState(fromQuery: string): Promise<boolean> {
  const store = await cookies();
  const inCookie = store.get(STATE_COOKIE)?.value;
  store.delete(STATE_COOKIE);
  if (!inCookie || !fromQuery || inCookie !== fromQuery) return false;
  const parts = inCookie.split(".");
  if (parts.length !== 3) return false;
  const payload = `${parts[0]}.${parts[1]}`;
  if (sign(payload) !== parts[2]) return false;
  return Date.now() - Number(parts[0]) < 10 * 60 * 1000;
}
