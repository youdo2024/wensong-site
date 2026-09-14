import crypto from "crypto";
import db from "./db";

/*
 * 後台帳號（第 2 段：三人各自登入）。
 *
 * 密碼雜湊 hashPassword/verifyPassword 是純函式，不 import next/headers，
 * 冒煙測試（純 Node 執行）載得動，跟 lib/admin-password.ts、lib/admin-session.ts 同一套規矩。
 * findUser/touchLogin/seedAdminUsersFromEnv 才碰資料庫，只給 lib/auth.ts 這種伺服器端模組用。
 */

const SCRYPT_KEYLEN = 64;
const SCRYPT_SALT_BYTES = 16;

/* 格式 scrypt$<salt hex>$<hash hex>，往後想換演算法只要認得出這個前綴就好 */
export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(SCRYPT_SALT_BYTES);
  const hash = crypto.scryptSync(password, salt, SCRYPT_KEYLEN);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = (stored || "").split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const [, saltHex, hashHex] = parts;
  if (!saltHex || !hashHex) return false;
  let salt: Buffer;
  let want: Buffer;
  try {
    salt = Buffer.from(saltHex, "hex");
    want = Buffer.from(hashHex, "hex");
  } catch {
    return false;
  }
  /* 壞格式（例如非十六進位字元被 Buffer.from 靜靜截斷成空的）一律當驗證失敗 */
  if (salt.length === 0 || want.length === 0) return false;
  const got = crypto.scryptSync(password, salt, want.length);
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}

export type AdminUserRow = {
  id: number;
  username: string;
  name: string;
  pass_hash: string;
  active: number;
  created_at: string;
  last_login_at: string;
};

export function findUser(username: string): AdminUserRow | undefined {
  return db.prepare("SELECT * FROM admin_users WHERE username=? AND active=1").get(username) as AdminUserRow | undefined;
}

export function touchLogin(id: number): void {
  db.prepare("UPDATE admin_users SET last_login_at=? WHERE id=?").run(new Date().toISOString(), id);
}

/*
 * 拆解 `username|顯示名|scrypt$salt$hash` 這個格式。
 *
 * 舊寫法 `raw.split("|")` 沒限制段數，直接用陣列解構取前三段：一旦顯示名稱本身
 * 含「|」，第三段就會變成名字裡多出來的片段，雜湊值被換成一個不完整、驗證一定
 * 失敗的字串，帳號被靜默建成永遠登不進去的壞密碼，站長完全看不出來哪裡錯。
 *
 * 修法：username 用「第一個 |」界定，passHash 用「最後一個 |」界定，
 * 中間不管出現幾個 | 全部算顯示名稱本身。密碼雜湊的格式固定是
 * `scrypt$<十六進位鹽>$<十六進位雜湊>`，本來就不可能含「|」，
 * 所以「最後一個 |」永遠是名字與雜湊的正確分界，不受名字內容影響。
 */
export function parseAdminUserEnv(raw: string): { username: string; name: string; passHash: string } | null {
  const s = (raw || "").trim();
  const first = s.indexOf("|");
  const last = s.lastIndexOf("|");
  if (first === -1 || last === -1 || first === last) return null; // 湊不出「三段」，格式本身就不對
  const username = s.slice(0, first).trim();
  const name = s.slice(first + 1, last).trim();
  const passHash = s.slice(last + 1).trim();
  if (!username || !name || !passHash) return null;
  return { username, name, passHash };
}

/*
 * 從環境變數種子灌帳號，格式 `username|顯示名|scrypt$salt$hash`（ADMIN_USER_1..3）。
 * 在 login 時呼叫一次即可，不放進 lib/db.ts：那支只管 schema 與內容種子，
 * 讀環境變數這件事應該跟著登入流程走，不該混進資料庫初始化。
 *
 * upsert 以 username 為 key：更新顯示名與密碼雜湊，並把 active 扳回 1。
 * 站長拿掉某一個 ADMIN_USER_N 不代表要停用那個帳號（那要另外做停用功能），
 * 這裡只負責「環境變數裡目前寫的三人，密碼與名字要跟環境變數一致」。
 */
export function seedAdminUsersFromEnv(env: NodeJS.ProcessEnv = process.env): void {
  const upsert = db.prepare(
    `INSERT INTO admin_users (username,name,pass_hash,active,created_at)
     VALUES (@username,@name,@pass_hash,1,@created_at)
     ON CONFLICT(username) DO UPDATE SET name=excluded.name, pass_hash=excluded.pass_hash, active=1`
  );
  for (const key of ["ADMIN_USER_1", "ADMIN_USER_2", "ADMIN_USER_3"] as const) {
    const raw = env[key];
    if (!raw) continue;
    const parsed = parseAdminUserEnv(raw);
    if (!parsed) continue;
    upsert.run({ username: parsed.username, name: parsed.name, pass_hash: parsed.passHash, created_at: new Date().toISOString() });
  }
}

/* 帳號查無時仍要花的假雜湊：固定值，內容本身無意義，只是為了讓 scrypt 的成本被花掉 */
const DUMMY_HASH = hashPassword("這不是真的帳號-只給計時側信道防禦跑一次-scrypt");

/*
 * 帳號制核心：核對帳號密碼，對了就補上 last_login_at 並回傳登入者，錯了回 null。
 *
 * 帳號查無時仍對固定假雜湊跑一次 verifyPassword（scrypt，成本固定），
 * 讓「帳號不存在」跟「帳號存在但密碼錯」耗費差不多的時間。原本查無直接
 * return null、完全不碰 scrypt，兩條路徑差了兩個數量級（scrypt 預設成本
 * N=16384 要跑幾十毫秒，直接 return null 是微秒級），等於用回應時間
 * 洩漏「這個帳號存不存在」，形成帳號列舉的計時側信道（2026-09-14 審查抓到）。
 *
 * 放在這支檔案（不是 lib/auth.ts）：這裡不 import next/headers，
 * 純函式＋db，冒煙測試載得動，跟 findUser／touchLogin 同一套規矩。
 * lib/auth.ts 原樣出口，呼叫端（app/admin/actions.ts 的 login）一行都不用改。
 */
export function checkAccountPassword(username: string, pw: string): { id: number; name: string } | null {
  seedAdminUsersFromEnv();
  const user = username ? findUser(username) : undefined;
  if (!user) {
    verifyPassword(pw, DUMMY_HASH);
    return null;
  }
  if (!verifyPassword(pw, user.pass_hash)) return null;
  touchLogin(user.id);
  return { id: user.id, name: user.name };
}
