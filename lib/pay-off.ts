import { getSetting, setSetting, json } from "./db";

/*
 * 付款方式停用清單的讀寫（商店、贊助各一份；沒有各自設定時退回舊的共用 pay_methods_off）。
 * 獨立成小模組是為了讓 lib/linepay.ts 也能用：LINE Pay 回「商家不存在」這種金鑰層級的錯誤時要自動暫停自己，
 * 而 lib/shop.ts 已經 import linepay，反向 import 會繞成圈。
 */
export type PayScope = "shop" | "support";

export function paysOffFor(scope: PayScope): string[] {
  const key = scope === "shop" ? "pay_methods_off_shop" : "pay_methods_off_support";
  const own = getSetting(key, "");
  if (own) return json<string[]>(own, []);
  return json<string[]>(getSetting("pay_methods_off", "[]"), []);
}

export function setPayMethodOff(payKey: string, scope: PayScope, off: boolean): void {
  const key = scope === "shop" ? "pay_methods_off_shop" : "pay_methods_off_support";
  const cur = paysOffFor(scope).filter((k) => k !== payKey);
  const next = off ? [...cur, payKey] : cur;
  setSetting(key, JSON.stringify(next));
  /* 舊的共用鍵跟著商店那份走，跟網站設定表單的寫法一致，還沒讀新鍵的地方行為不變 */
  if (scope === "shop") setSetting("pay_methods_off", JSON.stringify(next));
}
