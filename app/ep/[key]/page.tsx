import type { Metadata } from "next";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import Nav from "@/components/Nav";
import Footer from "@/components/Footer";
import Crumbs from "@/components/Crumbs";
import JsonLd from "@/components/JsonLd";
import ViewPing from "@/components/ViewPing";
import PageViewPing from "@/components/PageViewPing";
import ArticleImgFx from "@/components/ArticleImgFx";
import ArticleBlocksFx from "@/components/ArticleBlocksFx";
import EpisodePlayer from "@/components/EpisodePlayer";
import EpisodeCard from "@/components/EpisodeCard";
import PlatformLinks from "@/components/PlatformLinks";
import ArticleSupportCta from "@/components/ArticleSupportCta";
import ArticleShopCta from "@/components/ArticleShopCta";
import ArticleStickySupport from "@/components/ArticleStickySupport";
import db, { getSetting, json } from "@/lib/db";
import { renderArticle, renderMarkdown } from "@/lib/markdown";
import { t } from "@/lib/copy";
import { absUrl, articleSeoTitle, buildMetadata, clampDesc } from "@/lib/seo";
import { BRAND } from "@/lib/brand";
import { articleShopCta, supportEnabled } from "@/lib/shop";
import { coverOf, displayTitle, epLabel, fmtDuration, guestsOfEpisode, type EpisodeRow } from "@/lib/episodes";
import { fmtDate } from "@/lib/format";
import { hosts, platformLinks } from "@/lib/site-config";

/*
 * 集數頁（決策定案 Q34 的七塊）：
 *   1 標題資訊  2 播放器＋平台連結  3 節目筆記  4 來賓卡  5 逐字稿（收合）
 *   6 相關集數  7 支持與商店 CTA
 * force-dynamic：ISR（revalidate 300）在這版 Next 的正式模式會因為 layout 讀 cookie 而炸 DYNAMIC_SERVER_USAGE（2026-09-14 實測 500），
 * 集數頁流量不大，每請求 SSR 就好。要改回 ISR 得先把 layout 的 shopViewable() 拿掉。
 */
export const dynamic = "force-dynamic";

function load(key: string): EpisodeRow | undefined {
  return db.prepare("SELECT * FROM episodes WHERE key=? AND published=1").get(key.toLowerCase()) as EpisodeRow | undefined;
}

export async function generateMetadata({ params }: { params: Promise<{ key: string }> }): Promise<Metadata> {
  const { key } = await params;
  const e = load(key);
  if (!e) return { title: "集數" };
  const title = displayTitle(e);
  const cover = coverOf(e);
  return buildMetadata({
    title: `${epLabel(e.series, e.ep_no)}｜${title}`,
    seoTitle: articleSeoTitle(`${title}｜${epLabel(e.series, e.ep_no)}`, e.seo_title),
    description: clampDesc(e.summary || e.notes),
    path: `/ep/${e.key}`,
    ogType: "article",
    ...(cover ? { ogImage: { url: cover, width: 1400, height: 1400, alt: title } } : {}),
  });
}

export default async function EpisodePage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  let e = load(key);
  if (!e) {
    /* 英文別名 → 301 到主網址（決策定案 Q14） */
    const alias = db.prepare("SELECT key FROM episodes WHERE slug_alias=? AND published=1").get(key.toLowerCase()) as { key: string } | undefined;
    if (alias) permanentRedirect(`/ep/${alias.key}`);
    notFound();
  }
  e = e as EpisodeRow;
  const title = displayTitle(e);
  const cover = coverOf(e);
  const notes = renderArticle(e.notes || "");
  const transcriptHtml = e.transcript ? renderMarkdown(e.transcript) : "";
  const chapters = json<{ t: number; label: string }[]>(e.chapters, []);
  const guests = guestsOfEpisode(e.id);
  const platforms = platformLinks();
  const hostList = hosts();

  /* 相關集數：同來賓優先，再來是最新的其他集 */
  const sameGuest = guests.length
    ? (db
        .prepare(
          `SELECT DISTINCT e.* FROM episodes e JOIN episode_guests eg ON eg.episode_id=e.id
           WHERE e.published=1 AND e.id!=? AND eg.guest_id IN (${guests.map(() => "?").join(",")}) ORDER BY e.pub_date DESC LIMIT 3`
        )
        .all(e.id, ...guests.map((g) => g.id)) as EpisodeRow[])
    : [];
  const fill = db
    .prepare(`SELECT * FROM episodes WHERE published=1 AND id!=? ${sameGuest.length ? `AND id NOT IN (${sameGuest.map(() => "?").join(",")})` : ""} ORDER BY pub_date DESC LIMIT 3`)
    .all(e.id, ...sameGuest.map((r) => r.id)) as EpisodeRow[];
  const related = [...sameGuest, ...fill].slice(0, 3);
  const podcastCover = getSetting("podcast_cover", "");

  const iso = (sec: number) => `PT${Math.floor(sec / 3600) ? `${Math.floor(sec / 3600)}H` : ""}${Math.floor((sec % 3600) / 60)}M${sec % 60}S`;
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "PodcastEpisode",
    name: title,
    url: absUrl(`/ep/${e.key}`),
    datePublished: e.pub_date,
    ...(e.updated_at ? { dateModified: e.updated_at } : {}),
    description: e.summary || clampDesc(e.notes, 200),
    ...(e.duration ? { timeRequired: iso(e.duration) } : {}),
    ...(e.ep_no && e.series === "main" ? { episodeNumber: Number(e.ep_no) } : {}),
    ...(cover ? { image: cover } : {}),
    inLanguage: "zh-Hant-TW",
    associatedMedia: { "@type": "AudioObject", contentUrl: e.audio_url, encodingFormat: e.audio_type || "audio/mpeg", ...(e.duration ? { duration: iso(e.duration) } : {}) },
    partOfSeries: { "@type": "PodcastSeries", name: BRAND.fullName, url: absUrl("/") },
    actor: [...hostList.map((h) => ({ "@type": "Person", name: h.name })), ...guests.map((g) => ({ "@type": "Person", name: g.name, url: absUrl(`/guests/${g.slug}`) }))],
    ...(transcriptHtml ? { transcript: e.transcript.slice(0, 5000) } : {}),
  };

  const shopCtaHere = articleShopCta();
  const supportCtaHere = supportEnabled();

  return (
    <>
      <JsonLd data={jsonLd} />
      <ArticleImgFx />
      <ArticleBlocksFx />
      <ViewPing endpoint="/api/episodes/view" id={e.id} />
      <PageViewPing page="episodes" />
      <Nav />

      <div className="ep-page">
        <Crumbs items={[{ name: "首頁", path: "/" }, { name: "集數", path: "/ep" }, { name: epLabel(e.series, e.ep_no) }]} />

        {/* 1 標題資訊 */}
        <header className="ep-head">
          <div className="cover">
            {cover ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img src={cover} alt={title} fetchPriority="high" />
            ) : (
              <div className="ph">?</div>
            )}
          </div>
          <div className="info">
            <span className="cat-tag">{epLabel(e.series, e.ep_no)}</span>
            <h1>{title}</h1>
            <div className="meta sans">
              {e.pub_date && <span>{fmtDate(e.pub_date)}</span>}
              {e.duration > 0 && <span>{fmtDuration(e.duration)}</span>}
              {guests.length > 0 && <span>feat. {guests.map((g) => g.name).join("、")}</span>}
            </div>
            {e.summary && <p className="dek">{e.summary}</p>}
          </div>
        </header>

        {/* 2 播放器＋平台連結 */}
        <section className="ep-play">
          <EpisodePlayer src={e.audio_url} type={e.audio_type} title={title} chapters={chapters} />
          <PlatformLinks platforms={platforms} small />
        </section>

        {/* 3 節目筆記 */}
        {notes.html && (
          <section className="ep-notes">
            <h2 className="sec-t">{t("ep_notes_h")}</h2>
            <article className="post"><div className="post-body" dangerouslySetInnerHTML={{ __html: notes.html }} /></article>
          </section>
        )}

        {/* 4 來賓卡 */}
        {guests.length > 0 && (
          <section className="ep-guests">
            <h2 className="sec-t">{t("ep_guests_h")}</h2>
            <div className="guest-grid">
              {guests.map((g) => (
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
                </Link>
              ))}
            </div>
          </section>
        )}

        {/* 5 逐字稿（收合；標 AI 辨識） */}
        {transcriptHtml && (
          <section className="ep-transcript">
            <details>
              <summary>
                <span className="sec-t">{t("ep_transcript_h")}</span>
                <i>▸</i>
              </summary>
              <p className="ai-note">{t("ep_transcript_note")}</p>
              <article className="post"><div className="post-body transcript" dangerouslySetInnerHTML={{ __html: transcriptHtml }} /></article>
            </details>
          </section>
        )}

        {/* 7 支持與商店 CTA（站長模式下兩個都關，這段就不出現） */}
        {shopCtaHere && <ArticleShopCta />}
        {supportCtaHere && <ArticleSupportCta ctaText={t("ep_cta_line")} />}

        {/* 6 相關集數 */}
        {related.length > 0 && (
          <section className="ep-related">
            <h2 className="sec-t">{t("ep_related_h")}</h2>
            <div className="ep-grid">
              {related.map((r) => (
                <EpisodeCard key={r.id} e={r} fallbackCover={podcastCover} />
              ))}
            </div>
          </section>
        )}
      </div>

      {supportCtaHere && <ArticleStickySupport />}
      <Footer />
    </>
  );
}
