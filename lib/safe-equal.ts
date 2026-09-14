import crypto from "crypto";

/*
 * 權杖比對專用的定時比較（constant-time）。
 *
 * 為什麼不用 ===：JavaScript 的字串比較一遇到不同的字元就回傳，
 * 比對「前 8 碼對」與「第 1 碼就錯」花的時間不一樣。
 * 訂單權杖、贊助 pay_token、取消連結的 HMAC 都是可以無限次重試的東西，
 * 對方只要量到那點時間差，就能一個字元一個字元把權杖猜出來。
 *
 * 長度不同直接回 false：crypto.timingSafeEqual 長度不等會直接丟例外，
 * 而長度本來就會從網址長度看出來，不是秘密。
 */
export function safeEqual(a: string | null | undefined, b: string | null | undefined): boolean {
  if (typeof a !== "string" || typeof b !== "string") return false;
  /* 空字串一律不算相等：資料庫裡沒發過權杖的舊資料那一欄是空的，
     不能讓「網址不帶權杖」剛好對上「資料庫也是空的」而放行 */
  if (!a || !b) return false;
  const x = Buffer.from(a, "utf8");
  const y = Buffer.from(b, "utf8");
  if (x.length !== y.length) return false;
  return crypto.timingSafeEqual(x, y);
}
