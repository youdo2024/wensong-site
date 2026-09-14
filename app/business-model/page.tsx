import type { Metadata } from "next";
import { buildMetadata } from "@/lib/seo";
import Nav from "@/components/Nav";
import Footer from "@/components/Footer";

/* 純內容頁,但站規:每頁明寫快取模式（快取政策下放後每頁明寫） */
export const dynamic = "force-dynamic";

/*
 * 給金流／銀行審查人員的數位內容服務說明頁。
 * 不放進任何選單或 sitemap（robots noindex），需要時把網址直接給審查窗口。
 */
export const metadata: Metadata = {
  ...buildMetadata({ title: "數位內容服務說明｜於悅商行", path: "/business-model", description: "於悅商行數位內容服務之交易性質、發票開立與退款政策說明，供金流服務業者與金融機構審查參考。" }),
  robots: { index: false, follow: false },
};

const ROWS: [string, string][] = [
  ["營業人", "於悅商行（統一編號 88528295）・臺中市南屯區惠中里文心路一段 378 號 7 樓之 10"],
  ["業務內容", "數位內容製作與銷售（生態飲食主題之文章、圖表、影音）、周邊商品零售"],
  ["支持方案之性質", "數位內容服務之銷售。買受人付款後取得：本站持續公開之內容產出、支持者專屬數位圖像（桌布集）下載、確認信與電子發票。屬交易行為，非捐贈、非募資、非《公益勸募條例》之勸募"],
  ["方案型態", "單次支持（一次性）／每月支持（繼續性服務契約，信用卡按月扣款，買受人可隨時自確認信連結停止）"],
  ["發票開立", "每筆交易由光貿電子發票加值中心自動開立雲端發票，品名「數位內容服務」，寄送至買受人 Email；需載具、捐贈或統編者由客服協助處理"],
  ["定價", "由買受人於本站提供之級距或自訂金額中選擇，單筆下限 NT$100"],
  ["金流", "綠界科技（ECPay）、LINE Pay。本站不經手、不儲存卡號"],
  ["退款政策", "數位內容一經提供即完成，依消保法第 19 條第 1 項但書不適用七日猶豫期；重複扣款或金額錯誤個案協助，循原付款方式退回（使用條款第八條）"],
  ["相關文件", "使用條款 www.wensong.tw/terms・隱私權 www.wensong.tw/privacy・退換貨 www.wensong.tw/returns"],
];

export default function BusinessModel() {
  return (
    <>
      <Nav />
      <div className="frame" style={{ maxWidth: 760, padding: "56px 20px 120px" }}>
        <div className="page-head">
          <span className="tag">數 位 內 容 服 務 說 明</span>
          <h1>於悅商行・數位內容服務</h1>
        </div>
        <p style={{ color: "var(--grey)", fontSize: 14.5, lineHeight: 2, marginBottom: 24 }}>
          本頁供金流服務業者與金融機構審查參考，說明本站「支持方案」之交易性質與相關文件。
        </p>
        <div className="box">
          <div className="band" />
          <div className="inner">
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <tbody>
                {ROWS.map(([k, v]) => (
                  <tr key={k}>
                    <td style={{ padding: "12px 14px 12px 0", fontWeight: 700, whiteSpace: "nowrap", verticalAlign: "top", borderBottom: "1px dashed var(--kraft)", letterSpacing: ".06em" }}>{k}</td>
                    <td style={{ padding: "12px 0", fontSize: 14.5, lineHeight: 2, verticalAlign: "top", borderBottom: "1px dashed var(--kraft)" }}>{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="band" />
        </div>
      </div>
      <Footer />
    </>
  );
}
