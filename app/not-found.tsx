import Link from "next/link";
import Nav from "@/components/Nav";
import NbText from "@/components/NbText";
import Footer from "@/components/Footer";

/*
 * 自訂 404（P0-1）：品牌樣式、回傳真 404 狀態碼（App Router 的 not-found 天生就是 404，
 * 不會是軟 404），並給訪客兩條活路，不讓死路流失。
 */
export default function NotFound() {
  return (
    <>
      <Nav />
      <div className="frame" style={{ maxWidth: 560, padding: "72px 20px 120px" }}>
        <div className="box center">
          <div className="band" />
          <div className="inner" style={{ paddingTop: 44, paddingBottom: 44 }}>
            <span className="tag">4 0 4</span>
            <h2 style={{ fontSize: 24, fontWeight: 900, letterSpacing: ".14em", marginTop: 14 }}>這一頁不在地圖上</h2>
            <p style={{ color: "var(--grey)", fontSize: 14.5, marginTop: 12, lineHeight: 2 }}>
              <NbText text="網址可能打錯了，或這篇內容已經搬家。別擔心，問爽的還在，慢慢逛。" />
            </p>
            <p style={{ marginTop: 22, display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
              <Link className="btn fill" href="/">回首頁</Link>
              <Link className="btn" href="/articles">看全部文章</Link>
            </p>
          </div>
          <div className="band" />
        </div>
      </div>
      <Footer />
    </>
  );
}
