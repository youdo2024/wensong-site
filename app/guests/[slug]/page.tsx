import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Nav from "@/components/Nav";
import Footer from "@/components/Footer";
import Crumbs from "@/components/Crumbs";
import JsonLd from "@/components/JsonLd";
import ViewPing from "@/components/ViewPing";
import PageViewPing from "@/components/PageViewPing";
import EpisodeCard from "@/components/EpisodeCard";
import db, { getSetting, json } from "@/lib/db";
import { renderMarkdown } from "@/lib/markdown";
import { buildMetadata, absUrl, clampDesc } from "@/lib/seo";
import { BRAND } from "@/lib/brand";
import { episodesOfGuest } from "@/lib/episodes";

export const dynamic = "force-dynamic";

type Guest = { id: number; slug: string; name: string; title: string; intro: string; photo: string; links: string; published: number };

function load(slug: string): Guest | undefined {
  return db.prepare("SELECT * FROM guests WHERE slug=? AND published=1").get(slug.toLowerCase()) as Guest | undefined;
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const g = load(slug);
  if (!g) return { title: "來賓" };
  return buildMetadata({
    title: `${g.name}${g.title ? `｜${g.title}` : ""}`,
    path: `/guests/${g.slug}`,
    description: clampDesc(g.intro) || `${g.name} 在${BRAND.name} Podcast 上過的集數與相關連結。`,
    ...(g.photo ? { ogImage: { url: g.photo, alt: g.name } } : {}),
  });
}

export default async function GuestPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const g = load(slug);
  if (!g) notFound();
  const eps = episodesOfGuest(g.id);
  const links = json<{ label: string; url: string }[]>(g.links, []);
  const introHtml = g.intro ? renderMarkdown(g.intro) : "";
  const cover = getSetting("podcast_cover", "");

  const person = {
    "@context": "https://schema.org",
    "@type": "ProfilePage",
    mainEntity: {
      "@type": "Person",
      name: g.name,
      ...(g.title ? { jobTitle: g.title } : {}),
      ...(g.intro ? { description: clampDesc(g.intro, 200) } : {}),
      url: absUrl(`/guests/${g.slug}`),
      ...(g.photo ? { image: g.photo } : {}),
      ...(links.length ? { sameAs: links.map((l) => l.url) } : {}),
    },
  };

  return (
    <>
      <JsonLd data={person} />
      <ViewPing endpoint="/api/guests/view" id={g.id} />
      <PageViewPing page="guests" />
      <Nav />
      <div className="frame guest-page" style={{ padding: "48px 20px 100px" }}>
        <Crumbs items={[{ name: "首頁", path: "/" }, { name: "來賓", path: "/guests" }, { name: g.name }]} />
        <header className="guest-head">
          <div className={`ava big${g.photo ? "" : " ph"}`}>
            {g.photo ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img src={g.photo} alt={g.name} />
            ) : (
              <span>{g.name.replace(/^.*[\s：:]/, "").slice(0, 1)}</span>
            )}
          </div>
          <div className="info">
            <span className="tag">來 賓</span>
            <h1>{g.name}</h1>
            {g.title && <p className="sub">{g.title}</p>}
            {links.length > 0 && (
              <div className="links">
                {links.map((l, i) => (
                  <a key={i} className="btn" href={l.url} target="_blank" rel="noopener">{l.label || l.url}</a>
                ))}
              </div>
            )}
          </div>
        </header>
        {introHtml && (
          <article className="post guest-intro"><div className="post-body" dangerouslySetInnerHTML={{ __html: introHtml }} /></article>
        )}
        <section className="guest-eps">
          <h2 className="sec-t">{g.name} 上 過 的 集 數</h2>
          {eps.length === 0 ? (
            <p className="empty">還沒有掛上任何一集</p>
          ) : (
            <div className="ep-grid">
              {eps.map((e) => (
                <EpisodeCard key={e.id} e={e} fallbackCover={cover} />
              ))}
            </div>
          )}
        </section>
      </div>
      <Footer />
    </>
  );
}
