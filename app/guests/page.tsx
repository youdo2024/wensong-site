import type { Metadata } from "next";
import Link from "next/link";
import Nav from "@/components/Nav";
import Footer from "@/components/Footer";
import Crumbs from "@/components/Crumbs";
import JsonLd from "@/components/JsonLd";
import NbText from "@/components/NbText";
import PageViewPing from "@/components/PageViewPing";
import db from "@/lib/db";
import { buildMetadata, absUrl } from "@/lib/seo";
import { BRAND } from "@/lib/brand";

export const metadata: Metadata = buildMetadata({
  title: "來賓",
  path: "/guests",
  description: `${BRAND.fullName}問過的人：每一位來賓上過哪幾集、店在哪裡、怎麼找到他。`,
});
export const dynamic = "force-dynamic";

type Row = { id: number; slug: string; name: string; title: string; photo: string; n: number; last: string };

export default function GuestsPage() {
  const list = db
    .prepare(
      `SELECT g.id,g.slug,g.name,g.title,g.photo,COUNT(e.id) AS n,COALESCE(MAX(e.pub_date),'') AS last
       FROM guests g LEFT JOIN episode_guests eg ON eg.guest_id=g.id LEFT JOIN episodes e ON e.id=eg.episode_id AND e.published=1
       WHERE g.published=1 GROUP BY g.id ORDER BY g.featured DESC, last DESC, g.sort, g.id`
    )
    .all() as Row[];

  const collection = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: `${BRAND.name} 來賓`,
    url: absUrl("/guests"),
    inLanguage: "zh-Hant-TW",
    mainEntity: {
      "@type": "ItemList",
      itemListElement: list.map((g, i) => ({ "@type": "ListItem", position: i + 1, name: g.name, url: absUrl(`/guests/${g.slug}`) })),
    },
  };

  return (
    <>
      <JsonLd data={collection} />
      <PageViewPing page="guests" />
      <Nav />
      <div className="frame" style={{ padding: "48px 20px 100px" }}>
        <Crumbs items={[{ name: "首頁", path: "/" }, { name: "來賓" }]} />
        <div className="page-head">
          <span className="tag">來 賓</span>
          <h1>被我們問過的人</h1>
          <p><NbText text={`目前 ${list.length} 位，點進去看他上過哪幾集`} /></p>
        </div>
        {list.length === 0 ? (
          <p className="empty">還沒有來賓資料</p>
        ) : (
          <div className="guest-grid list">
            {list.map((g) => (
              <Link className="guest-card" key={g.id} href={`/guests/${g.slug}`}>
                <div className={`ava${g.photo ? "" : " ph"}`}>
                  {g.photo ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img src={g.photo} alt={g.name} loading="lazy" />
                  ) : (
                    <span>{g.name.replace(/^.*[\s：:]/, "").slice(0, 1)}</span>
                  )}
                </div>
                <b>{g.name}</b>
                {g.title && <small>{g.title}</small>}
                <span className="cnt sans">{g.n} 集</span>
              </Link>
            ))}
          </div>
        )}
      </div>
      <Footer />
    </>
  );
}
