/*
 * 審核用測試站（REVIEW_SITE=1）。
 *
 * 用途：給金流／審核單位看的站。外觀與正式站一模一樣，但只有拿到帳密的人進得來，
 * 而且所有「會對外造成後果」的行為都被強制關掉。
 *
 * 為什麼需要一整套開關，而不是只擋一道門：2026-08-13 TapPay 的窗口在正式站測試下單，
 * 光貿真的開出了一張正式發票 DR69013737，站長事後手動作廢。那次是靠人補救；
 * 這裡把它變成靠程式。
 *
 * 這支刻意不 import 任何東西：middleware 跑在 Edge 執行環境，
 * 沾到 db 或 node 內建模組就會整個掛掉。
 */

export function isReviewSite(): boolean {
  return process.env.REVIEW_SITE === "1";
}

/*
 * 測試站的四道強制保險，任何一道都不吃資料庫設定，只看環境變數：
 *
 * 1. 發票一律走光貿測試環境（忽略 AMEGO_TAX_ID／AMEGO_APP_KEY）
 *    → 就算站長不小心把正式金鑰貼進測試站，也開不出正式發票
 * 2. 所有信件改寄到 REVIEW_MAIL_TO 一個信箱
 *    → 審核人員下的測試單不會寄信給真實顧客，也不會觸發夥伴出貨
 * 3. GA 與 Meta Pixel 關閉
 *    → 測試流量不混進正式數據，也不會污染廣告受眾
 * 4. 全站 noindex
 *    → 不會被搜尋引擎索引成正式站的重複內容
 */
export const REVIEW_FORCE_INVOICE_SANDBOX = true;

/* 測試站的信一律轉寄到這裡；沒設就整個不寄（寧可不寄，也不要寄錯人） */
export function reviewMailTo(): string {
  return (process.env.REVIEW_MAIL_TO || "").trim();
}
