"use client";
import Script from "next/script";
import { useEffect } from "react";

/* GA4 評估 ID（公開資訊，非機密） */
const GA_ID = "G-KHVHFQ1DFP";

type GtagWindow = { dataLayer?: unknown[]; gtag?: (...args: unknown[]) => void };

export function GoogleAnalytics() {
  return (
    <>
      <Script src={`https://www.googletagmanager.com/gtag/js?id=${GA_ID}`} strategy="afterInteractive" />
      <Script id="ga-init" strategy="afterInteractive">{`
        window.dataLayer = window.dataLayer || [];
        function gtag(){dataLayer.push(arguments);}
        gtag('js', new Date());
        /*
         * 付款完成後顧客是「從綠界／LINE Pay 的網域跳回來」的，document.referrer 會是金流商。
         * GA4 預設把外部 referrer 當成新的工作階段來源，於是這次回訪被切成新 session，
         * 原本的廣告／搜尋來源就斷了，報表上大量顯示 (not set) 或金流商 referral。
         * 感謝頁改用 ignore_referrer，讓 GA4 沿用原本的工作階段與來源。
         * 注意：這只治我們這一側，金流商網域仍需在 GA4 後台的「不需要的參照連結」排除。
         */
        /* 用字串比對而非正則：這段字寫在 JSX 模板字串裡，正則的反斜線會被吃掉，
           變成壞掉的字面值並讓整支 GA 初始化腳本拋錯（實測 gtag 直接 undefined）。 */
        var __p = location.pathname;
        var __thx = __p.indexOf('/support/thanks') === 0 || __p.indexOf('/shop/thanks') === 0;
        gtag('config', '${GA_ID}', __thx ? { ignore_referrer: true } : {});
      `}</Script>
    </>
  );
}

/* 放在頁面上，載入時送一次 GA 事件（用於轉換：完成贊助、完成購物） */
export function GaEvent({ name, params }: { name: string; params?: Record<string, string> }) {
  useEffect(() => {
    const w = window as unknown as GtagWindow;
    w.dataLayer = w.dataLayer || [];
    if (!w.gtag) {
      /* gtag.js 規定佇列裡放 arguments 物件（不能是陣列），所以不用箭頭函式 */
      w.gtag = function () {
        // eslint-disable-next-line prefer-rest-params
        (w.dataLayer as unknown[]).push(arguments);
      } as unknown as (...args: unknown[]) => void;
    }
    w.gtag("event", name, params || {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}
