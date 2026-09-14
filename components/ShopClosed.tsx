import Link from "next/link";
import Nav from "./Nav";
import Footer from "./Footer";
import { t } from "@/lib/copy";
import { navSupportShop } from "@/lib/shop";

/* 商店總開關關閉時的頁面。
   這頁也屬於商店動線，導覽列的贊助按鈕同樣受 navSupportShop 控制。
   容易漏掉的是：商店關閉時 /shop 與 /cart 走的是這個元件而不是它們自己的頁面，
   只改那兩個頁面的話，這裡的按鈕會照樣出現。 */
export default function ShopClosed() {
  return (
    <>
      <Nav hideSupport={!navSupportShop()} />
      <div className="frame" style={{ maxWidth: 560, padding: "72px 20px 120px" }}>
        <div className="box center">
          <div className="band" />
          <div className="inner" style={{ paddingTop: 44, paddingBottom: 44 }}>
            <span className="tag" style={{ display: "inline-block", border: "1.5px solid var(--indigo)", color: "var(--indigo)", fontSize: 12, letterSpacing: ".4em", padding: "4px 16px" }}>
              商 店 公 告
            </span>
            <h2 style={{ fontSize: 24, fontWeight: 900, letterSpacing: ".14em", marginTop: 14 }}>{t("closed_title")}</h2>
            <p style={{ color: "var(--grey)", fontSize: 14.5, marginTop: 12, lineHeight: 2 }}>{t("closed_text")}</p>
            <div style={{ marginTop: 24, display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
              <Link className="btn" href="/ep">聽一集</Link>
              <Link className="btn fill" href="/guests">看來賓</Link>
            </div>
          </div>
          <div className="band" />
        </div>
      </div>
      <Footer hideBusinessModel={!navSupportShop()} />
    </>
  );
}
