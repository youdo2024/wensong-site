/*
 * 捐贈碼的純規則。刻意不 import 任何東西。
 *
 * 分成獨立一支的理由跟 choice-split 一樣：結帳表單是 client component，
 * 而 lib/npoban.ts 要查資料庫、import 了 db。client 端只要沾到 db，
 * 建置就會炸在「Module not found: Can't resolve 'fs'」，而且錯誤訊息
 * 完全看不出跟捐贈碼有關。踩過一次就不要再踩第二次。
 */

/* 捐贈碼規格：3 到 7 位數字（財政部說明） */
export const NPOBAN_RE = /^\d{3,7}$/;

/*
 * 預設受贈單位：財團法人台灣兒童暨家庭扶助基金會（家扶基金會）。
 * 站長從小受家扶扶助，這是他指定的預設值，不是隨便挑的。
 */
export const DEFAULT_NPOBAN = "8585";
export const DEFAULT_NPOBAN_NAME = "家扶基金會";

export function npobanFormatOk(code: string): boolean {
  return NPOBAN_RE.test(String(code || "").trim());
}
