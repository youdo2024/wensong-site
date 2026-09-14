"use client";
import Script from "next/script";
import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

/* Meta 像素編號（公開資訊，非機密，跟 GA 評估 ID 同性質） */
const PIXEL_ID = "945509361910089";

type FbqWindow = { fbq?: (...args: unknown[]) => void };

/* 全站基底碼：首次載入由基底碼自己送 PageView；
   之後的站內換頁（App Router 客戶端導航不會重新載入頁面）靠 pathname 變化補送 */
export function MetaPixel() {
  const pathname = usePathname();
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    (window as unknown as FbqWindow).fbq?.("track", "PageView");
  }, [pathname]);
  return (
    <>
      <Script id="meta-pixel" strategy="afterInteractive">{`
        !function(f,b,e,v,n,t,s)
        {if(f.fbq)return;n=f.fbq=function(){n.callMethod?
        n.callMethod.apply(n,arguments):n.queue.push(arguments)};
        if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
        n.queue=[];t=b.createElement(e);t.async=!0;
        t.src=v;s=b.getElementsByTagName(e)[0];
        s.parentNode.insertBefore(t,s)}(window, document,'script',
        'https://connect.facebook.net/en_US/fbevents.js');
        fbq('init', '${PIXEL_ID}');
        fbq('track', 'PageView');
      `}</Script>
      <noscript>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          height="1"
          width="1"
          style={{ display: "none" }}
          alt=""
          src={`https://www.facebook.com/tr?id=${PIXEL_ID}&ev=PageView&noscript=1`}
        />
      </noscript>
    </>
  );
}

/* 事件參數：有金額才帶 value 與幣別，有品名才帶 content_name。
   帶空字串或 0 進去只會讓 Meta 後台多出一堆沒有意義的維度值。 */
function evParams(value?: number, contentName?: string) {
  const p: Record<string, unknown> = {};
  if (value && value > 0) { p.value = value; p.currency = "TWD"; }
  if (contentName) p.content_name = contentName;
  return p;
}

/* 互動當下直接發事件用（例如按下贊助表單送出鈕的 InitiateCheckout）。
   基底碼被擋廣告器擋掉時 fbq 不存在，安靜略過。 */
export function fbTrack(name: string, value?: number, contentName?: string) {
  const w = window as unknown as FbqWindow;
  w.fbq?.("track", name, evParams(value, contentName));
}

/* 放在頁面上，載入時送一次 Meta 標準事件（用於轉換：完成贊助、完成購物）。
   注意：不能自己先建 fbq 假函式——基底碼開頭是 if(f.fbq)return，
   搶先建了會讓真正的 fbevents.js 永遠不載入。所以改用短暫重試等基底碼就緒。 */
/* dedupeKey（交易編號）：同一筆交易只發一次——localStorage 擋重新整理／回上一頁的重發，
   同時把它當 fbq 的 eventID 送出，Meta 端也能對同 ID 去重（雙保險）。 */
export function FbEvent({
  name,
  value,
  dedupeKey,
  contentName,
}: {
  name: string;
  value?: number;
  dedupeKey?: string;
  contentName?: string;
}) {
  useEffect(() => {
    const storeKey = dedupeKey ? `fbev_${name}_${dedupeKey}` : "";
    try {
      if (storeKey && localStorage.getItem(storeKey)) return;
    } catch { /* 私密瀏覽拿不到 localStorage 就照舊發送 */ }
    let tries = 0;
    const timer = setInterval(() => {
      const w = window as unknown as FbqWindow;
      if (w.fbq) {
        const params = evParams(value, contentName);
        if (dedupeKey) w.fbq("track", name, params, { eventID: dedupeKey });
        else w.fbq("track", name, params);
        try { if (storeKey) localStorage.setItem(storeKey, String(Date.now())); } catch { /* 同上 */ }
        clearInterval(timer);
      } else if (++tries > 25) {
        clearInterval(timer); // ~5 秒還沒有就是被擋廣告器擋了，安靜放棄
      }
    }, 200);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}
