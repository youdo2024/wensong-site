import Link from "next/link";
import { notFound } from "next/navigation";
import Nav from "@/components/Nav";
import Footer from "@/components/Footer";
import ArticleSupportCta from "@/components/ArticleSupportCta";
import ArticleShopCta from "@/components/ArticleShopCta";
import ReadingProgress from "@/components/ReadingProgress";
import ArticleImgFx from "@/components/ArticleImgFx";
import ArticleBlocksFx from "@/components/ArticleBlocksFx";
import ArticleView from "@/components/ArticleView";
import db, { json } from "@/lib/db";
import { supportEnabled, articleShopCta } from "@/lib/shop";
import { renderArticle } from "@/lib/markdown";
import { t } from "@/lib/copy";
import PageViewPing from "@/components/PageViewPing";
import { articleSeoTitle, absUrl, SEO } from "@/lib/seo";
import { authorOf, categoryByName } from "@/lib/seo-data";
import Crumbs from "@/components/Crumbs";
import ArticleStickySupport from "@/components/ArticleStickySupport";
import ArticleSources from "@/components/ArticleSources";
import { imgSrc, SIZES } from "@/lib/img-src";
import { BRAND } from "@/lib/brand";

/*
 * 文章詳情：force-dynamic（同集數頁，ISR 在正式模式會炸 DYNAMIC_SERVER_USAGE，見 app/ep/[key]/page.tsx）。
 * 一頁式（bespoke）機制沒有搬過來：問爽的第 1 版沒有這種文章，要用再從佑在幹嘛抄註冊表那套。
 */
export const dynamic = "force-dynamic";

type ArticleRow = {
  id: number; slug: string; title: string; category: string; tags: string;
  date: string; read_min: number; location: string; summary: string; body: string;
  author: string; cta_text: string; cover: string; seo_title?: string; updated_at?: string; entities?: string; sources?: string;
  cta_shop?: number; cta_support?: number;
};

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const a = db.prepare("SELECT title,seo_title,summary,cover,date FROM articles WHERE slug=? AND published=1").get(slug) as
    | { title: string; seo_title: string; summary: string; cover: string; date: string }
    | undefined;
  if (!a) return { title: "文章" };
  const site = SEO.siteUrl;
  const ogImage = a.cover
    ? a.cover.startsWith("/") ? `${site}${a.cover}` : `${site}/api/images/${a.cover}`
    : `${site}${BRAND.ogImage}`;
  return {
    title: articleSeoTitle(a.title, a.seo_title),
    description: a.summary,
    alternates: { canonical: `${site}/articles/${slug}` },
    openGraph: {
      title: `${a.title}｜${BRAND.fullName}`,
      description: a.summary,
      url: `${site}/articles/${slug}`,
      type: "article",
      publishedTime: a.date,
      locale: "zh_TW",
      images: [{ url: ogImage, alt: a.title }],
    },
    twitter: { card: "summary_large_image", title: a.title, description: a.summary, images: [ogImage] },
  };
}

export default async function ArticlePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const a = db.prepare("SELECT * FROM articles WHERE slug=? AND published=1").get(slug) as ArticleRow | undefined;
  if (!a) notFound();

  const { html, toc } = renderArticle(a.body);

  /* 延伸閱讀：先比標籤，標籤打平才看分類，最後才看日期。四篇 */
  const relPool = db
    .prepare("SELECT slug,title,category,tags,date FROM articles WHERE published=1 AND slug!=?")
    .all(a.slug) as { slug: string; title: string; category: string; tags: string; date: string }[];
  const myTags = new Set(json<string[]>(a.tags, []));
  const related = relPool
    .map((r) => ({ ...r, score: json<string[]>(r.tags, []).filter((tg) => myTags.has(tg)).length }))
    .sort((x, y) => y.score - x.score || Number(y.category === a.category) - Number(x.category === a.category) || String(y.date).localeCompare(String(x.date)))
    .slice(0, 4);
  const topViewed = db.prepare("SELECT slug,title FROM articles WHERE published=1 ORDER BY views DESC, date DESC LIMIT 5").all() as { slug: string; title: string }[];
  const mayLike = db
    .prepare("SELECT slug,title FROM articles WHERE published=1 AND slug!=? ORDER BY (category=?) DESC, views DESC, date DESC LIMIT 4")
    .all(a.slug, a.category) as { slug: string; title: string }[];

  const author = authorOf(a.author);
  const entities = json<{ name: string; sameAs: string; type?: string }[]>(a.entities || "[]", []);
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: articleSeoTitle(a.title, a.seo_title),
    datePublished: a.date,
    ...(a.updated_at ? { dateModified: a.updated_at } : {}),
    author: { "@type": "Person", name: author.name, url: absUrl("/about") },
    publisher: { "@type": "Organization", name: BRAND.name, url: absUrl("/") },
    description: a.summary,
    articleSection: a.category,
    keywords: json<string[]>(a.tags, []).join(","),
    inLanguage: "zh-Hant-TW",
    mainEntityOfPage: absUrl(`/articles/${a.slug}`),
    ...(a.cover ? { image: [absUrl(a.cover)] } : {}),
    ...(entities.length ? { about: entities.map((e) => ({ "@type": e.type || "Thing", name: e.name, sameAs: e.sameAs })) } : {}),
  };

  const shopCtaHere = articleShopCta() && a.cta_shop !== 0;
  const supportCtaHere = supportEnabled() && a.cta_support !== 0;
  const catSlug = categoryByName(a.category)?.slug || "";

  return (
    <>
      <ReadingProgress ids={toc.map((x) => x.id)} />
      <ArticleImgFx />
      <ArticleBlocksFx />
      <ArticleView slug={a.slug} />
      <PageViewPing page="articles" />
      <Nav />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      <div className="art-layout">
        <aside className="toc">
          <div className="h">本 篇 目 錄</div>
          {toc.map((x) => (
            <a key={x.id} href={`#${x.id}`}>{x.text}</a>
          ))}
          {topViewed.length > 0 && (
            <div className="side-block">
              <div className="h">熱 門 文 章</div>
              <ol className="side-rank">
                {topViewed.map((r, i) => (
                  <li key={r.slug}>
                    <span className="rk">{i + 1}</span>
                    <Link href={`/articles/${r.slug}`}>{r.title}</Link>
                  </li>
                ))}
              </ol>
            </div>
          )}
          {mayLike.length > 0 && (
            <div className="side-block">
              <div className="h">你 可 能 有 興 趣</div>
              <ul className="side-list">
                {mayLike.map((r) => (
                  <li key={r.slug}><Link href={`/articles/${r.slug}`}>{r.title}</Link></li>
                ))}
              </ul>
            </div>
          )}
        </aside>

        <article className="post">
          <Crumbs
            items={[
              { name: "首頁", path: "/" },
              { name: "文章", path: "/articles" },
              ...(catSlug ? [{ name: a.category, path: `/articles/category/${catSlug}` }] : [{ name: a.category }]),
              { name: a.title },
            ]}
          />
          <span className="cat-tag">{a.category}</span>
          <h1>{a.title}</h1>
          <div className="meta">
            {a.location && <span>{a.location}</span>}
            <span>{a.author || BRAND.name}</span>
          </div>

          {a.cover && (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              {...imgSrc(a.cover, SIZES.article)}
              alt={a.title}
              fetchPriority="high"
              style={{ width: "100%", height: "auto", border: "2px solid var(--ink)", margin: "6px 0 10px" }}
            />
          )}

          <div className="post-body" dangerouslySetInnerHTML={{ __html: html }} />

          {shopCtaHere && <ArticleShopCta />}
          {a.cta_text === "off" ? null : supportCtaHere && <ArticleSupportCta ctaText={a.cta_text || t("article_cta_default")} />}

          <ArticleSources sources={a.sources} />

          {related.length > 0 && (
            <div className="related">
              <div className="h">延 伸 閱 讀</div>
              <div className="rel-grid">
                {related.map((r) => (
                  <Link className="rel" key={r.slug} href={`/articles/${r.slug}`}>
                    <small>{r.category}</small>
                    <b>{r.title}</b>
                  </Link>
                ))}
              </div>
            </div>
          )}
        </article>
      </div>

      {supportCtaHere && <ArticleStickySupport />}
      <Footer />
    </>
  );
}
