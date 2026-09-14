import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Nav from "@/components/Nav";
import Footer from "@/components/Footer";
import Crumbs from "@/components/Crumbs";
import JsonLd from "@/components/JsonLd";
import ArticleGrid, { type ArticleCard } from "@/components/ArticleGrid";
import db, { json } from "@/lib/db";
import { buildMetadata, absUrl } from "@/lib/seo";
import { tagBySlug } from "@/lib/seo-data";
import PageViewPing from "@/components/PageViewPing";

export const dynamic = "force-dynamic";

/* 標籤頁（P1-4）：只建文章數達 3 篇的標籤（目前 3 個），避免索引膨脹 */
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const t = tagBySlug(slug);
  if (!t) return { title: "標籤" };
  return buildMetadata({
    title: `${t.name}相關文章`,
    path: `/articles/tag/${slug}`,
    description: `「問爽的」關於${t.name}的所有文章。`,
  });
}

export default async function TagPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const t = tagBySlug(slug);
  if (!t) notFound();

  const all = db
    .prepare("SELECT id,slug,title,category,tags,date,summary,author,cover FROM articles WHERE published=1 ORDER BY sort, id")
    .all() as ArticleCard[];
  const list = all.filter((a) => json<string[]>(a.tags, []).includes(t.name));

  const collection = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: `${t.name}相關文章`,
    url: absUrl(`/articles/tag/${slug}`),
    inLanguage: "zh-Hant-TW",
    mainEntity: {
      "@type": "ItemList",
      itemListElement: list.map((a, i) => ({ "@type": "ListItem", position: i + 1, name: a.title, url: absUrl(`/articles/${a.slug}`) })),
    },
  };

  return (
    <>
      <PageViewPing page="articles" />
      <JsonLd data={collection} />
      <Nav />
      <div className="frame" style={{ padding: "48px 20px 100px" }}>
        <Crumbs items={[{ name: "首頁", path: "/" }, { name: "文章", path: "/articles" }, { name: t.name }]} />
        <div className="page-head">
          <span className="tag">標 籤</span>
          <h1>{t.name}相關文章</h1>
        </div>
        <ArticleGrid list={list} />
      </div>
      <Footer />
    </>
  );
}
