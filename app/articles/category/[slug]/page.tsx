import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Nav from "@/components/Nav";
import NbText from "@/components/NbText";
import Footer from "@/components/Footer";
import Crumbs from "@/components/Crumbs";
import JsonLd from "@/components/JsonLd";
import ArticleGrid, { type ArticleCard } from "@/components/ArticleGrid";
import db from "@/lib/db";
import { buildMetadata, absUrl } from "@/lib/seo";
import { categoryBySlug, CATEGORIES } from "@/lib/seo-data";
import PageViewPing from "@/components/PageViewPing";

export const dynamic = "force-dynamic";

/* 分類支柱頁（P1-1）：每個分類一個靜態網址、獨立 H1 與 metadata、
   定義段落（精選摘要誘餌）、CollectionPage＋ItemList schema、麵包屑 */
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const c = categoryBySlug(slug);
  if (!c) return { title: "分類" };
  return buildMetadata({
    title: `${c.name}的故事`,
    path: `/articles/category/${slug}`,
    description: c.blurb,
  });
}

export default async function CategoryPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const c = categoryBySlug(slug);
  if (!c) notFound();

  const list = db
    .prepare("SELECT id,slug,title,category,tags,date,summary,author,cover FROM articles WHERE published=1 AND category=? ORDER BY sort, id")
    .all(c.name) as ArticleCard[];

  const collection = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: `${c.name}的故事`,
    description: c.blurb,
    url: absUrl(`/articles/category/${slug}`),
    inLanguage: "zh-Hant-TW",
    mainEntity: {
      "@type": "ItemList",
      itemListElement: list.map((a, i) => ({
        "@type": "ListItem",
        position: i + 1,
        name: a.title,
        url: absUrl(`/articles/${a.slug}`),
      })),
    },
  };

  return (
    <>
      <PageViewPing page="articles" />
      <JsonLd data={collection} />
      <Nav />
      <div className="frame" style={{ padding: "48px 20px 100px" }}>
        <Crumbs items={[{ name: "首頁", path: "/" }, { name: "文章", path: "/articles" }, { name: c.name }]} />
        <div className="page-head">
          <span className="tag">{c.name.split("").join(" ")}</span>
          <h1>{c.name}的故事</h1>
          {/* 分類定義段落：直接、完整、可獨立成立的一句話定義（snippet bait） */}
          <p><NbText text={c.blurb} /></p>
        </div>

        <div className="cats">
          {CATEGORIES.map((x) => (
            <a key={x.slug} className={`c${x.slug === slug ? " on" : ""}`} href={`/articles/category/${x.slug}`}>{x.name}</a>
          ))}
          <a className="c" href="/articles">全部</a>
        </div>

        <ArticleGrid list={list} />
      </div>
      <Footer />
    </>
  );
}
