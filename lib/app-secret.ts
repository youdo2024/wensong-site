import { getSetting } from "./db";

/*
 * 全站簽章金鑰的單一來源。
 *
 * 原本 lib/auth.ts 有一份正確的解析順序（環境變數 → 資料庫的 instance_secret →
 * 正式環境直接炸掉），lib/line-bind.ts 卻自己寫了一份，而且只看環境變數，
 * 沒設就退回原始碼裡的固定字串。結果是同一個站有兩套強度不同的金鑰：
 * 後台是安全的，綁定與贊助 cookie 卻是任何看過 repo 的人都簽得出來的。
 *
 * 抽成這一支共用，以後再加簽章用途也不會又長出第三份。
 * 用函式取值而不是模組層級常數，確保資料庫初始化完成後才讀。
 */
export function appSecret(): string {
  const s = process.env.ADMIN_SECRET || getSetting("instance_secret", "");
  if (s) return s;
  /*
   * 正式環境走到這裡就是不正常，寧可整站簽不出東西也不能退回原始碼裡的固定字串。
   * 照理說不可能發生，lib/db.ts 啟動時就會產生 instance_secret，這裡只是最後一道保險。
   */
  if (process.env.NODE_ENV === "production") {
    throw new Error("簽章金鑰不存在：請在 Zeabur 設 ADMIN_SECRET，或確認資料庫的 instance_secret 有產生");
  }
  return "yozaiganma-dev-secret";
}
