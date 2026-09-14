import { cookies } from "next/headers";
import crypto from "crypto";
import { getSetting, setSetting } from "./db";
import { cookieSecure } from "./cookie-secure";
import { passwordUsable, accountModeEnabled } from "./admin-password";
import { appSecret } from "./app-secret";
import { packSession, parseEpoch, sessionUser, verifySession, type SessionUser } from "./admin-session";
import { getUserEpoch, bumpUserEpoch } from "./admin-users";

const COOKIE = "yo_admin";

/*
 * 簽章金鑰：環境變數優先，沒設就用資料庫裡的隨機金鑰（lib/db.ts 產生）。
 * 原本沒設時會退回原始碼裡的固定字串，那代表任何看得到程式碼的人
 * 都能偽造後台 session 直接繞過登入，看到全部訂單與贊助者的個資。
 * 實作已經抽到 lib/app-secret.ts 共用（LINE 綁定 cookie 先前自己寫了一份弱的）。
 */
function secret(): string {
  return appSecret();
}

/* 密碼沒有後備方案：正式環境沒設就只能用預設密碼，必須讓站長看得到這件事 */
export function adminPasswordIsDefault(): boolean {
  /* 帳號制（ADMIN_USER_1..3）啟用時這個警告不適用：那時 ADMIN_PASSWORD 本來就不需要設 */
  if (accountModeEnabled(process.env)) return false;
  return !process.env.ADMIN_PASSWORD;
}

/* 判斷邏輯在 lib/admin-password.ts（純函式，冒煙測試載得動），這裡照舊出口 */
export { passwordUsable, accountModeEnabled } from "./admin-password";

function password(): string {
  return process.env.ADMIN_PASSWORD || "yozaiganma";
}

function sign(payload: string) {
  return crypto.createHmac("sha256", secret()).update(payload).digest("hex");
}

export function checkPassword(pw: string) {
  /* 正式環境沒設好密碼就直接拒絕，絕不拿原始碼裡的預設字串去比對 */
  if (!passwordUsable(process.env)) return false;
  const a = Buffer.from(pw);
  const b = Buffer.from(password());
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/*
 * 帳號制（第 2 段）：核對帳號密碼，對了就補上 last_login_at 並回傳登入者。
 * 實作在 lib/admin-users.ts（純函式＋db，不 import next/headers，冒煙測試載得動），
 * 這裡原樣出口，跟 passwordUsable／accountModeEnabled 同一套規矩。
 */
export { checkAccountPassword } from "./admin-users";

/*
 * 目前這一代的後台 session。cookie 裡帶著它，值對不上就一律不算登入。
 * 登出時把「這個人」的 epoch 加一，等於把先前簽給他的每一張 cookie 一次作廢
 * （被側錄走的那張也包含在內），這是原本的 `到期時間.簽章` 做不到的事。
 *
 * 單一密碼制（id 0，沒有帳號可言）沿用全域那一份 settings 鍵；
 * 帳號制（id>0）各自一份（admin_users.session_epoch，lib/admin-users.ts）。
 * 原本三人共用同一個全域鍵，任何一位登出都會把另外兩位當下的 session
 * 一起踢掉，是這次審查抓到、體感最差的一個取捨（2026-09-14）。
 */
function globalEpoch(): number {
  return parseEpoch(getSetting("admin_session_epoch", "1"));
}

/* 依登入者查「他自己」的 epoch：帳號制查 admin_users，單一密碼制查全域 settings */
function epochForUser(id: number): number {
  return id > 0 ? getUserEpoch(id) : globalEpoch();
}

/* 登出時呼叫：只讓這個人的既有 session 失效，不影響另外兩位；重新登入一次就好 */
export function bumpSessionEpoch(user: SessionUser): void {
  if (user.id > 0) bumpUserEpoch(user.id);
  else setSetting("admin_session_epoch", String(globalEpoch() + 1));
}

export async function createSession(user: SessionUser = { id: 0, name: "站長" }) {
  const exp = Date.now() + 1000 * 60 * 60 * 24 * 7; // 7 天
  const store = await cookies();
  store.set(COOKIE, packSession(exp, epochForUser(user.id), sign, user), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
    secure: cookieSecure(),
  });
}

/* ── 登入防暴力破解：同一 IP 15 分鐘內錯 8 次即鎖定 ── */
const attempts = new Map<string, { count: number; first: number }>();
const WINDOW = 15 * 60 * 1000;
const MAX_TRIES = 8;

export function loginLocked(ip: string): boolean {
  const rec = attempts.get(ip);
  if (!rec) return false;
  if (Date.now() - rec.first > WINDOW) {
    attempts.delete(ip);
    return false;
  }
  return rec.count >= MAX_TRIES;
}
export function recordLoginFail(ip: string) {
  const rec = attempts.get(ip);
  if (!rec || Date.now() - rec.first > WINDOW) {
    attempts.set(ip, { count: 1, first: Date.now() });
  } else {
    rec.count++;
  }
}
export function clearLoginFails(ip: string) {
  attempts.delete(ip);
}

export async function destroySession() {
  const store = await cookies();
  store.delete(COOKIE);
}

export async function isAdmin(): Promise<boolean> {
  const store = await cookies();
  /* 驗證邏輯在 lib/admin-session.ts（純函式，冒煙測試載得動）：
     驗簽、解出登入者、比對「他自己」的 epoch、檢查到期時間，四關都過才算登入 */
  return verifySession(store.get(COOKIE)?.value, sign, epochForUser);
}

/* 現在登入的是誰。用在修改記錄（lib/admin-log.ts）與後台頁首顯示「現在登入：名字」 */
export async function currentAdmin(): Promise<SessionUser | null> {
  const store = await cookies();
  return sessionUser(store.get(COOKIE)?.value, sign, epochForUser);
}
