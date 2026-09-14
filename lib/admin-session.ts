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
 */

export const DEFAULT_EPOCH = 1;

/* 組出 cookie 值。sign 由呼叫端注入，這支才不用碰金鑰與資料庫 */
export function packSession(exp: number, epoch: number, sign: (payload: string) => string): string {
  const payload = `${exp}.${epoch}`;
  return `${payload}.${sign(payload)}`;
}

/*
 * 驗證 cookie。簽章不對、epoch 不是現行值、過期，三者任一都回 false。
 * 順序是先驗簽再比 epoch：epoch 是自己資料庫裡的數字，先比它不會洩漏什麼，
 * 但簽章不對的東西本來就不該被繼續解讀。
 */
export function verifySession(
  raw: string | undefined | null,
  sign: (payload: string) => string,
  epoch: number,
  nowMs: number = Date.now()
): boolean {
  if (!raw) return false;
  const parts = raw.split(".");
  /* 舊格式只有兩段（到期時間.簽章），在這裡就被擋掉，不必另外寫相容分支 */
  if (parts.length !== 3) return false;
  const [expStr, epochStr, sig] = parts;
  if (!expStr || !epochStr || !sig) return false;
  /* 定時比較：簽章比對不因提早不相等而洩漏時間差 */
  const a = Buffer.from(sign(`${expStr}.${epochStr}`));
  const b = Buffer.from(sig);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  if (Number(epochStr) !== epoch) return false;
  return Number(expStr) > nowMs;
}

/* 資料庫裡讀出來的 epoch 字串轉成可用的整數。壞值一律當 1，不能讓它變成 NaN 而全站登不進去 */
export function parseEpoch(raw: string): number {
  const n = Number(raw);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : DEFAULT_EPOCH;
}
