/*
 * TapPay 金流標示：官方 logo＋安全性文字。
 * 文案照 TapPay 官方〈附件3 安全性文字範例及 Logo 下載〉（2021 v1.0）的參考範例一，
 * 僅把「本公司」改為「本站」；logo 用官方提供的標準橫式 PNG。
 */
export default function TapPayBadge({ full = false, style }: { full?: boolean; style?: React.CSSProperties }) {
  return (
    <span style={{ display: "inline-flex", flexDirection: "column", alignItems: "center", gap: 10, maxWidth: 520, ...style }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/brand/tappay-logo.png" alt="TapPay" style={{ height: 34, width: "auto", display: "block" }} />
      {full ? (
        <span style={{ fontSize: 12.5, color: "var(--grey)", lineHeight: 1.9, textAlign: "center", letterSpacing: ".04em" }}>
          本站採用喬睿科技 TapPay SSL 2048bit 交易系統，消費者刷卡時直接在銀行端系統中交易，本站絕不留下您的信用卡資料，以保障您的權益。TapPay
          交易系統通過 PCI-DSS 國際信用卡組織安全稽核，周全保護您的信用卡資料安全。
        </span>
      ) : (
        <span style={{ fontSize: 12.5, color: "var(--grey)", letterSpacing: ".06em" }}>
          金流服務由喬睿科技 TapPay 提供（PCI-DSS 國際安全認證）
        </span>
      )}
    </span>
  );
}
