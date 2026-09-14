import { cookies } from "next/headers";
import { isAdmin } from "./auth";

/*
 * 出貨夥伴的檢視權限（多夥伴版，docs/multi-partner-spec.md）。
 *
 * 原本全站只有一把金鑰、一組密碼，人人看到全部。現在金鑰住在 partners 表，
 * 一人一把：cookie 的值就是金鑰本身，每次請求回表查「這把鑰匙還有效嗎、是誰的」。
 * 後台對某位夥伴重新產生金鑰，只有他的舊連結與已種的 cookie 失效，別人不受影響；
 * 停用（active=0）同理。舊的 settings partner_key 從此不再被認得——
 * 這就是「切換部署即舊連結失效」的機制，不需要另外做失效名單。
 *
 * 密碼那關維持原設計：pin cookie 的值綁金鑰，換金鑰兩關一起重來。
 */

export const PARTNER_COOKIE = "yo_partner";
export const PARTNER_PIN_COOKIE = "yo_partner_pin";

/* 純資料查詢住在 partner-db.ts（不綁 request 環境）；這裡 re-export 讓舊呼叫端不用改 */
export { partnerByKey, partnerById, allPartners, type Partner } from "./partner-db";
import { partnerByKey } from "./partner-db";
import type { Partner } from "./partner-db";

export async function currentPartner(): Promise<Partner | null> {
  const c = (await cookies()).get(PARTNER_COOKIE)?.value || "";
  return partnerByKey(c) ?? null;
}

export async function partnerOk(): Promise<boolean> {
  return (await currentPartner()) !== null;
}

export async function partnerPinOk(): Promise<boolean> {
  const p = await currentPartner();
  if (!p) return false;
  const c = (await cookies()).get(PARTNER_PIN_COOKIE)?.value || "";
  return c === p.key;
}

/* 夥伴頁守門：站長本人，或「連結金鑰＋密碼」兩關都過的夥伴 */
export async function partnerViewable(): Promise<boolean> {
  return (await isAdmin()) || ((await partnerOk()) && (await partnerPinOk()));
}

/*
 * 這次請求是誰在看。
 *   "admin"  站長：看全部夥伴的區塊
 *   Partner  某位夥伴：只看自己的商品與訂單
 *   null     沒過門
 * 出貨與匯出的路由都要用這個做「只能動自己的貨」的判斷，
 * 不能只問 partnerViewable()——那只回答能不能進門，不回答他是誰。
 */
export async function viewerScope(): Promise<"admin" | Partner | null> {
  if (await isAdmin()) return "admin";
  const p = await currentPartner();
  return p && (await partnerPinOk()) ? p : null;
}
