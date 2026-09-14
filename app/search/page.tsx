import type { Metadata } from "next";
import Link from "next/link";
import Nav from "@/components/Nav";
import Footer from "@/components/Footer";
import Crumbs from "@/components/Crumbs";
import ArticleGrid, { type ArticleCard } from "@/components/ArticleGrid";
import db from "@/lib/db";
import { buildMetadata } from "@/lib/seo";

export const metadata: Metadata = buildMetadata({
  title: "站內搜尋",
  path: "/search",
  description: "搜尋問爽的的全部集數與文章。",
  noindex: true,
});

export const dynamic = "force-dynamic";

/* 站內搜尋：文章（標題／摘要／內文）與集數（標題／筆記／逐字稿） */
export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q = "" } = await searchParams;
  const query = q.trim().slice(0, 50);
  const like = `%${query}%`;

  const articles = query
    ? (db
        .prepare(
          `SELECT id,slug,title,category,tags,date,summary,author,cover FROM articles
           WHERE published=1 AND (title LIKE ? OR summary LIKE ? OR body LIKE ?)
           ORDER BY (title LIKE ?) DESC, views DESC LIMIT 30`
        )
        .all(like, like, like, like) as ArticleCard[])
    : [];

  return (
    <>
      <Nav />
      <div className="frame" style={{ padding: "48px 20px 100px" }}>
        <Crumbs items={[{ name: "首頁", path: "/" }, { name: "搜尋" }]} />
        <div className="page-head">
          <span className="tag">站 內 搜 尋</span>
          <h1>找文章</h1>
        </div>

        <form className="search-form" action="/search" method="get" style={{ display: "flex", gap: 10, maxWidth: 560, marginBottom: 34 }}>
          <input
            type="search"
            name="q"
            defaultValue={query}
            placeholder="輸入關鍵字，例如：創業、坪林"
            autoFocus
            style={{ flex: 1, border: "2px solid var(--ink)", background: "var(--rice-lt)", padding: "12px 16px", fontSize: 16, minWidth: 0 }}
          />
          <button className="btn fill" type="submit" style={{ flex: "none" }}>搜尋</button>
        </form>

        {query && (
          <p style={{ color: "var(--grey)", fontSize: 14, marginBottom: 22 }}>
            「{query}」找到 {articles.length} 篇文章
          </p>
        )}


        {query ? <ArticleGrid list={articles} /> : <p style={{ color: "var(--grey)" }}>輸入關鍵字開始搜尋。</p>}
      </div>
      <Footer />
    </>
  );
}
