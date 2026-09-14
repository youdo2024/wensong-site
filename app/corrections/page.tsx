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

/* 更正政策（信任基礎建設）：逐字稿與來賓資料的查證與回報管道 */
export default function CorrectionsPage() {
  const sec = { fontSize: 18, fontWeight: 900 as const, letterSpacing: ".1em", margin: "28px 0 10px" };
  const p = { fontSize: 15, lineHeight: 2, color: "var(--ink)" };
  return (
    <>
      <Nav />
      <div className="frame" style={{ maxWidth: 680, padding: "48px 20px 100px" }}>
        <Crumbs items={[{ name: "首頁", path: "/" }, { name: "更正回報" }]} />
        <div className="page-head">
          <span className="tag">更 正 回 報</span>
          <h1>更正回報</h1>
          <p>發現錯誤了嗎？告訴我們</p>
        </div>

        <h2 style={sec}>逐字稿的正確性</h2>
        <p style={p}>
          每一集的逐字稿都是 AI 語音辨識加上人工粗校產出。雖然已經過檢查，難免還是有錯字或漏字。如果你在逐字稿裡發現某個字念得不對，或整句話要改，歡迎寄信告訴我們。
        </p>

        <h2 style={sec}>來賓資料可能過時</h2>
        <p style={p}>
          集數頁顯示的來賓頭銜與簡介是錄音當時的資訊。如果來賓後來換工作或有新發展，網站上的資料可能就不是最新的了。如果你發現某位來賓的資料需要更新，也可以來信通知。
        </p>

        <h2 style={sec}>怎麼回報</h2>
        <p style={p}>
          寄信到 <a href={`mailto:${SEO.email}?subject=${encodeURIComponent("更正回報")}`} style={{ color: "var(--indigo)", textUnderlineOffset: 4 }}>{SEO.email}</a>，
          註明是哪一集、錯誤在哪裡、你認為應該怎麼改。有出處或證據最好。
          每一封回報都會由主持人親自看，確認後我們會更新，並回信感謝你。
        </p>
      </div>
      <Footer />
    </>
  );
}
