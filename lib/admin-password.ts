/*
 * 後台密碼可用與否的判斷，單獨一支純函式模組。
 *
 * 為什麼不放在 lib/auth.ts：那支會 import next/headers 與資料庫，
 * 冒煙測試（純 Node 執行）載不動，這條規則又正好是最該被測到的一條。
 */

/*
 * 這份設定的密碼能不能拿來登入。
 *
 * 原本 lib/auth.ts 沒設 ADMIN_PASSWORD 時會退回原始碼裡的 "yozaiganma"。
 * 程式碼在 repo 裡，等於任何看過它的人都能登進正式後台，
 * 把全部訂單、贊助者、名單的個資看光。版面上那條紅色警示只是提醒，擋不住任何人。
 *
 * 所以正式環境改成：沒設或短於 8 碼就一律不給登入（連比對都不做），
 * 站長會在登入頁看到「密碼尚未設定」而不是「密碼不對」，知道要去 Zeabur 補。
 * 開發環境維持原本的後備密碼，本機才跑得起來。
 */
export function passwordUsable(env: { NODE_ENV?: string; ADMIN_PASSWORD?: string }): boolean {
  if (env.NODE_ENV !== "production") return true;
  /* 只要求「有設」。不設長度門檻：站長現在用的密碼長度我不知道，
     一上線就把人鎖在後台外面比預設密碼更糟。長度另外在後台紅字提醒即可。 */
  return (env.ADMIN_PASSWORD || "").length > 0;
}
