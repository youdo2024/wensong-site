/*
 * 「我們賣的是什麼」的唯一來源。
 *
 * 發票品名與金流頁的商品明細是兩套不同的欄位，分散在綠界、LINE Pay、
 * PayUni、Portaly 五個地方。先前只改了發票品名，金流頁仍顯示舊名稱，
 * 顧客付款時看到的和收到的發票對不起來。全部改從這裡取，才不會再走偏。
 *
 * 措辭用「交易標的」而不是「付款動機」（不寫「贊助」），與使用條款
 * 第六條的定性一致：非以有形媒介提供之數位內容及線上服務，買受人取得對價。
 */

/* 發票品名（光貿電子發票的 ProductItem.Description） */
export const INVOICE_ITEM = "數位內容服務";

/* 金流結帳頁顯示的商品明細。帶品牌讓顧客認得出是誰收款 */
export function payItemName(mode: string): string {
  return mode === "monthly" ? `問爽的 ${INVOICE_ITEM}（每月）` : `問爽的 ${INVOICE_ITEM}`;
}

/* 綠界的交易描述（TradeDesc），只在後台報表出現，不給顧客看 */
export const TRADE_DESC = "wensong digital content";
