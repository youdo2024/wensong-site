import type { Metadata } from "next";
import { buildMetadata } from "@/lib/seo";
import Link from "next/link";
import Nav from "@/components/Nav";
import NbText from "@/components/NbText";
import Footer from "@/components/Footer";
import db, { json } from "@/lib/db";
import PageViewPing from "@/components/PageViewPing";
import { permanentRedirect } from "next/navigation";
import { categoryByName, CATEGORIES } from "@/lib/seo-data";
import { imgSrc, SIZES } from "@/lib/img-src";

export const metadata: Metadata = buildMetadata({ title: "文章", path: "/articles", description: "問爽的的全部文章：節目幕後、來賓延伸、餐飲與創業，聽完一集還想多知道一點的都在這裡。" });
export const dynamic = "force-dynamic";

const CATS = ["all", "節目幕後", "餐飲", "創業", "生活", "來賓延伸"];

type ArticleRow = {
  id: number; slug: string; title: string; category: string;
  tags: string; date: string; summary: string; author: string; cover: string;
};

export default async function ArticlesPage({
  searchParams,
}: {
  searchParams: Promise<{ cat?: string }>;
}) {
  const { cat = "all" } = await searchParams;
  /* 舊的 ?cat= 網址 308 永久導向新的分類靜態頁（P1-1），舊分享連結不失效 */
  if (cat !== "all") {
    const c = categoryByName(cat);
    if (c) permanentRedirect(`/articles/category/${c.slug}`);
  }

  /* 排序（站長指示）：前 10 名照後台自訂 sort，第 11 名起改照點擊數（views）高低 */
  const bySort = db
    .prepare("SELECT id,slug,title,category,tags,date,summary,author,cover,views FROM articles WHERE published=1 ORDER BY sort, id")
    .all() as (ArticleRow & { views: number })[];
  const all = [...bySort.slice(0, 10), ...bySort.slice(10).sort((a, b) => (b.views || 0) - (a.views || 0))];

  /* 標籤只顯示在文章卡片下方幫助理解，不做整排的標籤篩選雲 */
  const list = all.filter((a) => cat === "all" || a.category === cat);


  const qs = (c: string) => (c === "all" ? "/articles" : `/articles/category/${categoryByName(c)?.slug || ""}`);

  return (
    <>
      <PageViewPing page="articles" />
      <Nav />
      <div className="frame" style={{ padding: "48px 20px 100px" }}>
        <div className="page-head">
          <span className="tag">文 章</span>
          <h1>聽完還想多知道一點的</h1>
          <p><NbText text="每一篇獨立存在，從任何一篇開始都可以" /></p>
        </div>

        <div className="cats">
          {/* 還沒有文章的分類先不顯示 tab（例如佑去吃飯，第一篇上了自動出現） */}
          {CATS.filter((c) => c === "all" || all.some((a) => a.category === c)).map((c) => (
            <Link key={c} className={`c${cat === c ? " on" : ""}`} href={qs(c)}>
              {c === "all" ? "全部" : c}
            </Link>
          ))}
        </div>
        <div className="art-grid">
          {list.length === 0 && <div className="empty">這個組合還沒有文章，換個分類看看</div>}
          {list.map((a) => (
            <Link className="card" key={a.id} href={`/articles/${a.slug}`}>
              <span className="cat-tag">{a.category}</span>
              {a.cover ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img {...imgSrc(a.cover, SIZES.card)} alt={a.title} className="cover img-fill" loading="lazy" style={{ borderBottom: "2px solid var(--ink)" }} />
              ) : (
                <div className="cover ph">封面圖</div>
              )}
              <div className="body">
                <h2>{a.title}</h2>
                <p>{a.summary}</p>
                <div className="meta">
                  <div className="tt">
                    {json<string[]>(a.tags, []).map((t) => (
                      <span key={t}>{t}</span>
                    ))}
                  </div>
                  <span>{a.author || "問爽的"}</span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </div>
      <Footer />
    </>
  );
}
