import type { Metadata } from "next";
import { buildMetadata } from "@/lib/seo";
import { renderMarkdown } from "@/lib/markdown";
import Nav from "@/components/Nav";
import Footer from "@/components/Footer";
import { getSetting } from "@/lib/db";

export const metadata: Metadata = buildMetadata({ title: "隱私權保護", path: "/privacy" });
export const dynamic = "force-dynamic";

export default function PrivacyPage() {
  const html = renderMarkdown(getSetting("privacy_md", ""));
  return (
    <>
      <Nav />
      <div className="frame" style={{ maxWidth: 680, padding: "56px 20px 100px" }}>
        <div className="page-head">
          <span className="tag">隱 私 權 保 護</span>
          <h1>我們怎麼對待你的資料</h1>
        </div>
        <article className="post" style={{ maxWidth: "none" }} dangerouslySetInnerHTML={{ __html: html }} />
      </div>
      <Footer />
    </>
  );
}
