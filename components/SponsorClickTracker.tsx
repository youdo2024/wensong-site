"use client";
import { useEffect } from "react";

type GtagWindow = { dataLayer?: unknown[]; gtag?: (...args: unknown[]) => void };

/* 站外贊助模式：點「贊助」外連按鈕（data-ga="sponsor-external"）時送一個 GA4 事件，
   讓你可以在 GA4 把 sponsor_click 標記為「關鍵事件（轉換）」——因為人會離站到 Portaly，
   我們無法在對方頁面偵測完成，所以以「點擊出站」作為可追蹤的轉換點 */
export default function SponsorClickTracker() {
  useEffect(() => {
    function onClick(e: MouseEvent) {
      const el = (e.target as HTMLElement | null)?.closest?.('a[data-ga="sponsor-external"]') as HTMLAnchorElement | null;
      if (!el) return;
      const w = window as unknown as GtagWindow;
      if (typeof w.gtag === "function") {
        w.gtag("event", "sponsor_click", { method: "portaly_external", link_url: el.href });
      }
    }
    document.addEventListener("click", onClick, { capture: true });
    return () => document.removeEventListener("click", onClick, { capture: true } as EventListenerOptions);
  }, []);
  return null;
}
