import type { Metadata } from "next";
import { buildMetadata } from "@/lib/seo";
import { renderMarkdown } from "@/lib/markdown";
import Nav from "@/components/Nav";
import Footer from "@/components/Footer";
import { getSetting } from "@/lib/db";

export const metadata: Metadata = buildMetadata({ title: "退換貨與退款政策", path: "/returns" });
export const dynamic = "force-dynamic";

export default function ReturnsPage() {
  const html = renderMarkdown(getSetting("returns_md", ""));
  return (
    <>
      <Nav />
      <div className="frame" style={{ maxWidth: 680, padding: "56px 20px 100px" }}>
        <div className="page-head">
          <span className="tag">退 換 貨 與 退 款</span>
          <h1>退換貨與退款政策</h1>
        </div>
        <article className="post" style={{ maxWidth: "none" }} dangerouslySetInnerHTML={{ __html: html }} />
      </div>
      <Footer />
    </>
  );
}
