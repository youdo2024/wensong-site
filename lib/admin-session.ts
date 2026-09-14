import crypto from "crypto";

/*
 * 後台 session cookie 的組裝與驗證，單獨一支純函式模組。
 *
 * 為什麼不放在 lib/auth.ts：那支會 import next/headers 與資料庫，
 * 冒煙測試（純 Node 執行）載不動，而這裡的規則正好是最該被測到的一條。
 * 做法與 lib/admin-password.ts 相同。
 *
 * ── 為什麼要有 epoch ──
 * 原本的 cookie 是 `到期時間.簽章`，裡面沒有任何識別碼。
 * 這代表一張簽出去的 cookie 在 7 天內都有效，而且沒有任何辦法讓它失效：
 * 按了登出只是把自己瀏覽器裡的那份刪掉，被側錄走的那份照樣進得了後台，
 * 站長就算察覺不對勁也只能等它自己過期。
 *
 * 改成 `到期時間.epoch.簽章`：epoch 是資料庫裡的一個整數（admin_session_epoch），
 * 驗證時要對得上目前的值。登出時把它加一，所有簽過的 cookie 一次全部作廢。
 * 舊格式（兩段）自然驗不過，站長重登一次就好。
 *
 * ── 第 2 段：3 帳號各自登入 ──
 * cookie 再加一段，帶著登入者的 id 與名字（base64url 包一個小 JSON），
 * 好讓修改記錄（lib/admin-log.ts）知道是誰做的，不必另外查表。
 * 舊格式（三段）驗不過，一樣讓站長重登一次，不必寫相容分支。
 *
 * ── epoch 改成「每人一份」（2026-09-14 審查抓到）──
 * 剛做完帳號制時 epoch 還是全站共用一個 settings 鍵：任何一位登出，
 * 其他兩位當下的 session 也會跟著失效，等於「登出」的語意其實是
 * 「把全部人都踢下線」，多人協作體感很差，還可能害人正在編輯的內容遺失。
 *
 * 驗證改成收一個 epochForUser(id) 函式而不是單一數字：先驗簽、解出 cookie
 * 裡帶的登入者 id，再問這個人自己的 epoch 是多少。單一密碼制（id 0）沒有
 * 帳號可言，沿用原本 settings 那一份全域 epoch；帳號制（id>0）各自一份
 * （admin_users.session_epoch），登出只 bump 自己那一份，不影響另外兩位。
 * 這支不碰 db，呼叫端（lib/auth.ts）決定 id 0 或 id>0 各自怎麼查。
 */

export const DEFAULT_EPOCH = 1;

export type SessionUser = { id: number; name: string };

/* 舊的單一密碼制沒有帳號可言，登入者一律記成「站長」（id 0） */
const DEFAULT_USER: SessionUser = { id: 0, name: "站長" };

function encodeUser(user: SessionUser): string {
  return Buffer.from(JSON.stringify(user), "utf8").toString("base64url");
}

function decodeUser(raw: string): SessionUser | null {
  try {
    const obj = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    if (obj && typeof obj.id === "number" && typeof obj.name === "string" && obj.name) {
      return { id: obj.id, name: obj.name };
    }
  } catch {
    /* 壞資料當沒有登入者，讓外層照樣把整張 cookie 當驗證失敗 */
  }
  return null;
}

/* 組出 cookie 值。sign 由呼叫端注入，這支才不用碰金鑰與資料庫 */
export function packSession(
  exp: number,
  epoch: number,
  sign: (payload: string) => string,
  user: SessionUser = DEFAULT_USER
): string {
  const payload = `${exp}.${epoch}.${encodeUser(user)}`;
  return `${payload}.${sign(payload)}`;
}

/*
 * 驗簽＋解出登入者＋比對「這個人」的 epoch＋檢查到期時間，四關全過才回傳內容，
 * 任一關沒過回 null。
 *
 * epoch 比對排在解出登入者「之後」：epoch 是每人各自一份，不知道 cookie
 * 裡簽的是誰就沒辦法問「他的 epoch 是多少」。這不影響安全性──userB64
 * 已經是簽章涵蓋的內容，上一步驗簽沒過的話這裡根本不會執行到。
 */
function decodeSession(
  raw: string | undefined | null,
  sign: (payload: string) => string,
  epochForUser: (id: number) => number,
  nowMs: number
): { exp: number; user: SessionUser } | null {
  if (!raw) return null;
  const parts = raw.split(".");
  /* 舊格式（兩段或三段）在這裡就被擋掉，不必另外寫相容分支 */
  if (parts.length !== 4) return null;
  const [expStr, epochStr, userB64, sig] = parts;
  if (!expStr || !epochStr || !userB64 || !sig) return null;
  /* 定時比較：簽章比對不因提早不相等而洩漏時間差 */
  const a = Buffer.from(sign(`${expStr}.${epochStr}.${userB64}`));
  const b = Buffer.from(sig);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  const user = decodeUser(userB64);
  if (!user) return null;
  if (Number(epochStr) !== epochForUser(user.id)) return null;
  if (!(Number(expStr) > nowMs)) return null;
  return { exp: Number(expStr), user };
}

/*
 * 驗證 cookie。簽章不對、epoch 不是這個人現行的值、過期、使用者資料解不出來，
 * 四者任一都回 false。epochForUser 由呼叫端注入（lib/auth.ts）：
 * 單一密碼制（id 0）查全域 settings，帳號制（id>0）查 admin_users 各自那一份。
 */
export function verifySession(
  raw: string | undefined | null,
  sign: (payload: string) => string,
  epochForUser: (id: number) => number,
  nowMs: number = Date.now()
): boolean {
  return decodeSession(raw, sign, epochForUser, nowMs) !== null;
}

/* 驗證通過就回傳登入者（id、name），驗不過回 null。currentAdmin()／修改記錄都靠這支 */
export function sessionUser(
  raw: string | undefined | null,
  sign: (payload: string) => string,
  epochForUser: (id: number) => number,
  nowMs: number = Date.now()
): SessionUser | null {
  return decodeSession(raw, sign, epochForUser, nowMs)?.user ?? null;
}

/* 資料庫裡讀出來的 epoch 字串轉成可用的整數。壞值一律當 1，不能讓它變成 NaN 而全站登不進去 */
export function parseEpoch(raw: string): number {
  const n = Number(raw);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : DEFAULT_EPOCH;
}
