import { NextResponse } from "next/server";
import db from "@/lib/db";
import { SEO } from "@/lib/seo";
import { BRAND } from "@/lib/brand";
import { displayTitle, epLabel } from "@/lib/episodes";

export const dynamic = "force-dynamic";

/*
 * 站內 RSS：集數頁與文章混流，給 AI 爬蟲與訂閱器看的內容入口。
 * 這不是 Podcast feed（那份在 SoundOn），所以不放 enclosure；連結指向本站的集數頁。
 */
export async function GET() {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const eps = db
    .prepare("SELECT key,series,ep_no,title,short_title,summary,pub_date,updated_at FROM episodes WHERE published=1 ORDER BY pub_date DESC LIMIT 50")
    .all() as { key: string; series: string; ep_no: string; title: string; short_title: string; summary: string; pub_date: string; updated_at: string }[];
  const arts = db
    .prepare("SELECT slug,title,summary,date,author,category,updated_at FROM articles WHERE published=1 ORDER BY date DESC, id DESC LIMIT 30")
    .all() as { slug: string; title: string; summary: string; date: string; author: string; category: string; updated_at: string }[];

  type Item = { title: string; url: string; desc: string; cat: string; creator: string; date: Date };
  const items: Item[] = [
    ...eps.map((e) => ({
      title: `${epLabel(e.series, e.ep_no)}｜${displayTitle(e)}`,
      url: `${SEO.siteUrl}/ep/${e.key}`,
      desc: e.summary || "",
      cat: "集數",
      creator: BRAND.name,
      date: new Date(e.pub_date || 0),
    })),
    ...arts.map((a) => ({
      title: a.title,
      url: `${SEO.siteUrl}/articles/${a.slug}`,
      desc: a.summary || "",
      cat: a.category,
      creator: (a.author || BRAND.name).split("／")[0],
      date: new Date(`${a.updated_at || a.date}T08:00:00+08:00`),
    })),
  ]
    .filter((i) => !Number.isNaN(i.date.getTime()))
    .sort((a, b) => b.date.getTime() - a.date.getTime())
    .slice(0, 50);

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
  <title>${esc(BRAND.fullName)}</title>
  <link>${SEO.siteUrl}</link>
  <atom:link href="${SEO.siteUrl}/rss.xml" rel="self" type="application/rss+xml" />
  <description>${esc(BRAND.description)}</description>
  <language>zh-Hant-TW</language>
${items
  .map(
    (i) => `  <item>
    <title>${esc(i.title)}</title>
    <link>${i.url}</link>
    <guid isPermaLink="true">${i.url}</guid>
    <description>${esc(i.desc)}</description>
    <category>${esc(i.cat)}</category>
    <dc:creator>${esc(i.creator)}</dc:creator>
    <pubDate>${i.date.toUTCString()}</pubDate>
  </item>`
  )
  .join("\n")}
</channel>
</rss>`;
  return new NextResponse(xml, { headers: { "Content-Type": "application/rss+xml; charset=utf-8" } });
}
