import { cookies } from "next/headers";
import { getSetting } from "./db";
import { shopEnabled } from "./shop";
import { isAdmin } from "./auth";

/*
 * 商店預覽連結：商店對外關閉時，給金流審查人員（或任何指定對象）
 * 一條可直接看到完整商店的路。
 * 流程：後台網站設定顯示一條帶金鑰的連結 → 對方點開 /api/shop-preview?k=金鑰
 * → 種一顆 httpOnly cookie → 商店、購物袋、結帳、下單全部放行。
 * 後台按「重新產生」換金鑰，所有舊連結與已種的 cookie 立即失效。
 */

export const SHOP_PREVIEW_COOKIE = "yo_shop_preview";

export function shopPreviewKey(): string {
  return getSetting("shop_preview_key", "");
}

export async function shopPreviewOk(): Promise<boolean> {
  const key = shopPreviewKey();
  if (!key) return false;
  const c = (await cookies()).get(SHOP_PREVIEW_COOKIE)?.value || "";
  return c === key;
}

/*
 * 未上架商品的預覽權限。
 *
 * 注意跟 shopViewable() 的差別：那支的第一個條件是「商店有開就放行」，
 * 用來判斷「商店休息中時誰還能逛」，對「未上架商品誰看得到」是錯的門——
 * 商店開著的話它對所有訪客回 true，未公開的商品就這樣外洩了。實測踩過。
 * 這支只認站長本人或持預覽金鑰的人。
 */
export async function draftViewable(): Promise<boolean> {
  return (await isAdmin()) || (await shopPreviewOk());
}

/* 商店頁的統一守門：公開中、站長本人，或持有效預覽 cookie */
export async function shopViewable(): Promise<boolean> {
  return shopEnabled() || (await isAdmin()) || (await shopPreviewOk());
}
