import type { Metadata } from "next";
import Nav from "@/components/Nav";
import Footer from "@/components/Footer";
import Crumbs from "@/components/Crumbs";
import { buildMetadata, SEO } from "@/lib/seo";

/* 純內容頁（快取政策下放後每頁明寫） */
export const dynamic = "force-dynamic";

export const metadata: Metadata = buildMetadata({
  title: "查證與更正政策",
  path: "/corrections",
  description: "問爽的的查證流程與更正政策：內容如何查證、發現錯誤如何處理、讀者如何通報。事實正確是本站的底線。",
});

/* 更正政策（信任基礎建設）：查證流程、錯誤處理、讀者通報管道 */
export default function CorrectionsPage() {
  const sec = { fontSize: 18, fontWeight: 900 as const, letterSpacing: ".1em", margin: "28px 0 10px" };
  const p = { fontSize: 15, lineHeight: 2, color: "var(--ink)" };
  return (
    <>
      <Nav />
      <div className="frame" style={{ maxWidth: 680, padding: "48px 20px 100px" }}>
        <Crumbs items={[{ name: "首頁", path: "/" }, { name: "查證與更正政策" }]} />
        <div className="page-head">
          <span className="tag">查 證 與 更 正</span>
          <h1>查證與更正政策</h1>
          <p>事實正確是這個網站的底線</p>
        </div>

        <h2 style={sec}>我們怎麼查證</h2>
        <p style={p}>
          本站內容以三種材料為基礎：實地田野調查與第一手訪談、官方公開資料（如農業部、林業及自然保育署、農業部生物多樣性研究所、海洋委員會等機構之統計與報告）、以及可具名的當事人說法。
          數字與事件在發布前會比對可取得的原始出處；引用他人研究或報導時，於文中或文末標示來源。
          無法查證的傳聞，我們選擇不寫。
        </p>

        <h2 style={sec}>發現錯誤時，我們怎麼處理</h2>
        <p style={p}>
          確認屬實的錯誤，我們會盡快更正內文（原則上於確認後 48 小時內），並視錯誤性質在文末加註更正說明與日期；
          若錯誤足以影響讀者對事件的理解，會另行於社群平台公告。我們不會無聲修改重大錯誤。
        </p>

        <h2 style={sec}>你發現錯誤，怎麼告訴我們</h2>
        <p style={p}>
          來信 <a href={`mailto:${SEO.email}?subject=${encodeURIComponent("內容更正回報")}`} style={{ color: "var(--indigo)", textUnderlineOffset: 4 }}>{SEO.email}</a>，
          註明文章網址、有疑義的段落、以及你認為正確的資訊（若有出處更好）。
          每一封更正回報都會由主持人親自查核，並回覆處理結果。謝謝每一位幫忙把關的讀者——你們是這個網站可信的原因之一。
        </p>
      </div>
      <Footer />
    </>
  );
}
