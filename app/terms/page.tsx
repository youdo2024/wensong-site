import type { Metadata } from "next";
import { buildMetadata } from "@/lib/seo";
import { renderMarkdown } from "@/lib/markdown";
import Nav from "@/components/Nav";
import Footer from "@/components/Footer";
import { getSetting } from "@/lib/db";

export const metadata: Metadata = buildMetadata({ title: "使用條款", path: "/terms" });
export const dynamic = "force-dynamic";

export default function TermsPage() {
  const html = renderMarkdown(getSetting("terms_md", ""));
  return (
    <>
      <Nav />
      <div className="frame" style={{ maxWidth: 680, padding: "56px 20px 100px" }}>
        <div className="page-head">
          <span className="tag">使 用 條 款</span>
          <h1>使用本網站的約定</h1>
        </div>
        <article className="post" style={{ maxWidth: "none" }} dangerouslySetInnerHTML={{ __html: html }} />
      </div>
      <Footer />
    </>
  );
}
