import { cookies } from "next/headers";
import { getSetting } from "./db";
import { isAdmin } from "./auth";

/*
 * 支持方案說明頁的檢視權限，做法沿用商店預覽（lib/shop-preview.ts）。
 *
 * 為什麼這頁不公開：權益細則寫得完整是為了讓金流審查看得懂，
 * 但贊助頁本身要維持單純（只有金額與一個按鈕），細則放出來會分散注意力。
 * 所以這頁預設誰都看不到，只有站長本人，或拿到專屬連結的人才進得去。
 *
 * 流程：後台網站設定顯示一條帶金鑰的連結 → 對方點開 /api/plan-preview?k=金鑰
 * → 種一顆 httpOnly cookie → 說明頁放行。
 * 後台按「重新產生」換金鑰，所有舊連結與已種的 cookie 立即失效。
 */

export const PLAN_PREVIEW_COOKIE = "yo_plan_preview";

export function planPreviewKey(): string {
  return getSetting("plan_preview_key", "");
}

export async function planPreviewOk(): Promise<boolean> {
  const key = planPreviewKey();
  if (!key) return false;
  const c = (await cookies()).get(PLAN_PREVIEW_COOKIE)?.value || "";
  return c === key;
}

/* 說明頁守門：站長本人，或持有效預覽 cookie。沒有「公開」這個選項 */
export async function planViewable(): Promise<boolean> {
  return (await isAdmin()) || (await planPreviewOk());
}
