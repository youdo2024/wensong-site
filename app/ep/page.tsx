import type { Metadata } from "next";
import Link from "next/link";
import Nav from "@/components/Nav";
import Footer from "@/components/Footer";
import Crumbs from "@/components/Crumbs";
import JsonLd from "@/components/JsonLd";
import NbText from "@/components/NbText";
import PageViewPing from "@/components/PageViewPing";
import EpisodeCard from "@/components/EpisodeCard";
import PlatformLinks from "@/components/PlatformLinks";
import db, { getSetting } from "@/lib/db";
import { buildMetadata, absUrl } from "@/lib/seo";
import { BRAND } from "@/lib/brand";
import { displayTitle, type EpisodeRow } from "@/lib/episodes";
import { platformLinks } from "@/lib/site-config";

export const metadata: Metadata = buildMetadata({
  title: "全部集數",
  path: "/ep",
  description: `${BRAND.fullName}的全部集數：每一集都有節目筆記、逐字稿與來賓資料，從任何一集開始都可以。`,
});
export const dynamic = "force-dynamic";

const SERIES: { key: string; label: string }[] = [
  { key: "all", label: "全部" },
  { key: "main", label: "正篇" },
  { key: "submit", label: "投稿" },
];

export default async function EpisodesPage({ searchParams }: { searchParams: Promise<{ s?: string }> }) {
  const { s = "all" } = await searchParams;
  const series = SERIES.some((x) => x.key === s) ? s : "all";
  const all = db
    .prepare("SELECT * FROM episodes WHERE published=1 ORDER BY pub_date DESC, id DESC")
    .all() as EpisodeRow[];
  const list = series === "all" ? all : all.filter((e) => e.series === series);
  const cover = getSetting("podcast_cover", "");
  const platforms = platformLinks();

  const collection = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: `${BRAND.name} 全部集數`,
    url: absUrl("/ep"),
    inLanguage: "zh-Hant-TW",
    mainEntity: {
      "@type": "ItemList",
      itemListElement: list.slice(0, 50).map((e, i) => ({ "@type": "ListItem", position: i + 1, name: displayTitle(e), url: absUrl(`/ep/${e.key}`) })),
    },
  };

  return (
    <>
      <JsonLd data={collection} />
      <PageViewPing page="episodes" />
      <Nav />
      <div className="frame" style={{ padding: "48px 20px 100px" }}>
        <Crumbs items={[{ name: "首頁", path: "/" }, { name: "集數" }]} />
        <div className="page-head">
          <span className="tag">全 部 集 數</span>
          <h1>問到爽為止</h1>
          <p><NbText text={`目前 ${all.length} 集，每一集都有節目筆記跟逐字稿`} /></p>
        </div>
        <PlatformLinks platforms={platforms} small />

        <div className="cats" style={{ marginTop: 26 }}>
          {SERIES.filter((x) => x.key === "all" || all.some((e) => e.series === x.key)).map((x) => (
            <Link key={x.key} className={`c${series === x.key ? " on" : ""}`} href={x.key === "all" ? "/ep" : `/ep?s=${x.key}`}>
              {x.label}
            </Link>
          ))}
        </div>

        {list.length === 0 ? (
          <p className="empty">這裡還沒有集數</p>
        ) : (
          <div className="ep-grid list">
            {list.map((e) => (
              <EpisodeCard key={e.id} e={e} fallbackCover={cover} />
            ))}
          </div>
        )}
      </div>
      <Footer />
    </>
  );
}
