"use client";
/*
 * 付款方式圖示。贊助頁與商店結帳共用：兩邊的付款清單一樣，圖示沒有理由各做一份。
 * 原本只寫在 SupportForm 裡，所以結帳頁一直是沒有圖示的純文字。
 */
const CHIP_STYLE: Record<string, { bg: string; fg: string; label: string }> = {
  "ATM 轉帳": { bg: "#A87F2E", fg: "#fff", label: "ATM" },
  "銀行轉帳": { bg: "#A87F2E", fg: "#fff", label: "ATM" },
  "台灣Pay": { bg: "#E5007F", fg: "#fff", label: "台" },
  "街口": { bg: "#E60012", fg: "#fff", label: "街" },
  "全支付": { bg: "#FFD500", fg: "#111", label: "全" },
  "一卡通": { bg: "#43A047", fg: "#fff", label: "一" },
  "悠遊付": { bg: "#0079C0", fg: "#fff", label: "悠" },
};

export default function PayChip({ name, bare = false, stack = false }: { name: string; bare?: boolean; stack?: boolean }) {
  /* bare：直排的錢包格（圖示在上、名稱在下）不要右邊距；stack：付款格直排版，圖示放大、LINE Pay 用上下疊的官方排版 */
  const mr = (n: number) => (bare || stack ? 0 : n);
  const sz = (n: number) => (stack ? Math.round(n * 1.35) : n);
  if (name === "信用卡") {
    return (
      <svg aria-hidden viewBox="0 0 24 24" width={sz(20)} height={sz(20)} style={{ marginRight: mr(7), flex: "none" }}>
        <rect x="1.5" y="4.5" width="21" height="15" rx="2.5" fill="none" stroke="currentColor" strokeWidth="2" />
        <rect x="1.5" y="7.6" width="21" height="3.4" fill="currentColor" />
        <circle cx="6.6" cy="15.6" r="1.9" fill="currentColor" />
        <circle cx="9.2" cy="15.6" r="1.9" fill="currentColor" opacity=".65" />
        <rect x="13" y="14.8" width="7.5" height="1.7" rx=".85" fill="currentColor" />
      </svg>
    );
  }
  if (name === "Apple Pay") {
    return (
      <svg aria-hidden viewBox="0 0 24 24" width={sz(17)} height={sz(17)} style={{ marginRight: mr(6), flex: "none", marginTop: stack ? 0 : -2 }}>
        <path fill="currentColor" d="M17.05 12.54c-.03-2.6 2.12-3.85 2.22-3.91-1.21-1.77-3.09-2.01-3.76-2.04-1.6-.16-3.12.94-3.93.94-.81 0-2.06-.92-3.39-.89-1.74.03-3.35 1.01-4.25 2.57-1.81 3.14-.46 7.79 1.3 10.34.86 1.25 1.89 2.65 3.24 2.6 1.3-.05 1.79-.84 3.36-.84 1.57 0 2.01.84 3.38.81 1.4-.02 2.28-1.27 3.13-2.53.99-1.45 1.39-2.85 1.41-2.92-.03-.01-2.71-1.04-2.74-4.13z" />
        <path fill="currentColor" d="M14.44 4.94c.72-.87 1.2-2.08 1.07-3.29-1.03.04-2.28.69-3.02 1.56-.66.77-1.24 2-1.09 3.18 1.15.09 2.32-.58 3.04-1.45z" />
      </svg>
    );
  }
  if (name === "LINE Pay" && stack) {
    /* 官方直式排版：LINE 在上、綠底白字 Pay 在下（站長 2026-09-04 指定）。
       LINE 字用 currentColor，格子選中變深底時才看得見 */
    return (
      <span aria-label="LINE Pay" style={{ display: "inline-flex", flexDirection: "column", alignItems: "center", gap: 3, flex: "none" }}>
        <b style={{ fontSize: 15, letterSpacing: ".01em", fontWeight: 900, fontFamily: "var(--font-sans),'Noto Sans TC',sans-serif", lineHeight: 1 }}>LINE</b>
        <span style={{ background: "#06C755", color: "#fff", borderRadius: 6, fontSize: 14.5, fontWeight: 700, padding: "5px 11px", lineHeight: 1, fontFamily: "var(--font-sans),'Noto Sans TC',sans-serif" }}>Pay</span>
      </span>
    );
  }
  if (name === "LINE Pay") {
    /* 格子裡只放這個組合字、不再重複文字，所以做大一點並拿掉右邊距 */
    return (
      <span aria-label="LINE Pay" style={{ display: "inline-flex", alignItems: "center", gap: 4, flex: "none" }}>
        <b style={{ fontSize: 12.5, letterSpacing: ".02em", fontFamily: "var(--font-sans),'Noto Sans TC',sans-serif", lineHeight: 1 }}>LINE</b>
        <span style={{ background: "#06C755", color: "#fff", borderRadius: 5, fontSize: 12.5, fontWeight: 700, padding: "3.5px 7px", lineHeight: 1, fontFamily: "var(--font-sans),'Noto Sans TC',sans-serif" }}>Pay</span>
      </span>
    );
  }
  const c = CHIP_STYLE[name];
  if (!c) return null;
  return (
    <span
      aria-hidden
      style={{
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        width: sz(22), height: sz(22), borderRadius: 6, background: c.bg, color: c.fg,
        fontSize: sz(c.label.length > 1 ? 7.5 : 12), fontWeight: 700, lineHeight: 1,
        marginRight: mr(8), flex: "none", letterSpacing: 0,
        fontFamily: "var(--font-sans),'Noto Sans TC',sans-serif",
      }}
    >
      {c.label}
    </span>
  );
}
