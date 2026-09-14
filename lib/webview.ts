/*
 * 內建瀏覽器（webview）偵測：只在瀏覽器端呼叫。
 * 用途：付款方式智慧調整（內建瀏覽器裡刷卡類的 3D 驗證跳轉常常斷掉）＋環境記錄。
 * 偵測不到就當一般瀏覽器，任何情況都不影響流程。
 *
 * 實測資料：內建瀏覽器裡刷卡四個人嘗試只有一個人成功，
 * 同一批人的 LINE Pay 是 4/4；一般瀏覽器裡刷卡則是 4/5。
 */
export type WebviewKind = "fb" | "ig" | "line" | "wv" | "";

export function inAppBrowser(): { inApp: boolean; kind: WebviewKind } {
  try {
    if (typeof navigator === "undefined") return { inApp: false, kind: "" };
    const ua = navigator.userAgent || "";

    /* 有專屬識別字串的先認，這樣後台才看得出是從哪個 App 來的 */
    if (/Line\//i.test(ua)) return { inApp: true, kind: "line" };
    if (/Instagram/i.test(ua)) return { inApp: true, kind: "ig" };
    if (/FBAN|FBAV|FB_IAB|FBIOS|MessengerLiteForiOS/i.test(ua)) return { inApp: true, kind: "fb" };

    /*
     * 其他 App 的內建瀏覽器（YouTube、Threads、X 之類）。
     *
     * 這些沒有像 FBAN 那樣的專屬字串可以認，只能靠 webview 本身的特徵：
     *
     * Android：官方 webview 一定會在 UA 的第一段括號裡放 wv 這個標記，很可靠。
     *
     * iOS：WKWebView 如果 App 沒有自己設定名稱，UA 會跟 Safari 幾乎一樣，
     *      但少了結尾的 Safari/xxx。真正的 Safari、iOS 版 Chrome（CriOS）、
     *      iOS 版 Firefox（FxiOS）都一定帶 Safari/，
     *      所以「有 AppleWebKit 與 Mobile/ 卻沒有 Safari/」就是 iOS 的內建瀏覽器。
     *
     * 這一條比前面三條寬，可能把某些冷門瀏覽器也算進來。代價是那些人看不到
     * 信用卡，但還有 LINE Pay 與 ATM 可選；而在內建瀏覽器裡給信用卡的話
     * 有八成機率是失敗然後直接流失，兩相比較寧可寬一點。
     */
    const head = ua.split(")")[0] || "";
    const androidWebview = /Android/i.test(ua) && /(^|[;\s])wv([;\s)]|$)/i.test(head);
    const iosWebview =
      /iPhone|iPad|iPod/i.test(ua) && /AppleWebKit/i.test(ua) && /Mobile\//i.test(ua) && !/Safari\//i.test(ua);
    if (androidWebview || iosWebview) return { inApp: true, kind: "wv" };

    return { inApp: false, kind: "" };
  } catch {
    return { inApp: false, kind: "" };
  }
}

/* 畫面與後台顯示用的名稱 */
export function webviewLabel(kind: string): string {
  return kind === "fb" ? "Facebook" : kind === "ig" ? "Instagram" : kind === "line" ? "LINE" : kind === "wv" ? "這個 App" : "";
}
