import type { MetadataRoute } from "next";
import db from "@/lib/db";
import { shopEnabled, supportEnabled } from "@/lib/shop";
import { CATEGORIES, TAGS, AUTHORS } from "@/lib/seo-data";
import { isReviewSite } from "@/lib/review-mode";
import { SEO } from "@/lib/seo";
import { articlesEnabled } from "@/lib/site-config";

export const dynamic = "force-dynamic";

/*
 * 全站 sitemap：集數、來賓、文章（含分類、標籤、作者）、靜態頁。
 * lastmod 用真實更新時間，沒有更新紀錄的用發布日，絕不用 build 時間。noindex 頁一律不進。
 * 站長模式鎖住的商店與支持頁不進（對外 404 或隱藏的東西不該出現在 sitemap）。
 */
export default function sitemap(): MetadataRoute.Sitemap {
  if (isReviewSite()) return [];
  const site = SEO.siteUrl;

  const staticPages: MetadataRoute.Sitemap = [
    { url: `${site}/`, changeFrequency: "weekly", priority: 1 },
    { url: `${site}/ep`, changeFrequency: "weekly", priority: 0.9 },
    { url: `${site}/guests`, changeFrequency: "monthly", priority: 0.8 },
    { url: `${site}/about`, changeFrequency: "monthly", priority: 0.7 },
    ...(supportEnabled() ? [{ url: `${site}/support`, changeFrequency: "monthly" as const, priority: 0.8 }] : []),
    { url: `${site}/corrections`, changeFrequency: "yearly", priority: 0.3 },
    { url: `${site}/privacy`, changeFrequency: "yearly", priority: 0.2 },
    { url: `${site}/terms`, changeFrequency: "yearly", priority: 0.2 },
    { url: `${site}/returns`, changeFrequency: "yearly", priority: 0.2 },
  ];

  const episodes = (
    db.prepare("SELECT key,pub_date,updated_at,cover,image FROM episodes WHERE published=1").all() as {
      key: string; pub_date: string; updated_at: string; cover: string; image: string;
    }[]
  ).map((e) => ({
    url: `${site}/ep/${e.key}`,
    lastModified: e.updated_at || e.pub_date || undefined,
    changeFrequency: "monthly" as const,
    priority: 0.8,
    ...(e.cover && e.cover.startsWith("/") ? { images: [`${site}${e.cover}`] } : {}),
  }));

  const guests = (db.prepare("SELECT slug,updated_at,created_at FROM guests WHERE published=1").all() as { slug: string; updated_at: string; created_at: string }[]).map((g) => ({
    url: `${site}/guests/${g.slug}`,
    lastModified: g.updated_at || g.created_at,
    changeFrequency: "monthly" as const,
    priority: 0.6,
  }));

  const hasArticles = articlesEnabled();
  const articles = hasArticles
    ? (db.prepare("SELECT slug,date,updated_at,cover FROM articles WHERE published=1").all() as { slug: string; date: string; updated_at: string; cover: string }[]).map((a) => ({
        url: `${site}/articles/${a.slug}`,
        lastModified: a.updated_at || a.date,
        changeFrequency: "monthly" as const,
        priority: 0.7,
        ...(a.cover && a.cover.startsWith("/") ? { images: [`${site}${a.cover}`] } : {}),
      }))
    : [];
  const usedCats = new Set((db.prepare("SELECT DISTINCT category FROM articles WHERE published=1").all() as { category: string }[]).map((c) => c.category));
  const categories = hasArticles
    ? [
        { url: `${site}/articles`, changeFrequency: "weekly" as const, priority: 0.7 },
        ...CATEGORIES.filter((c) => usedCats.has(c.name)).map((c) => ({ url: `${site}/articles/category/${c.slug}`, changeFrequency: "weekly" as const, priority: 0.6 })),
        ...TAGS.map((t) => ({ url: `${site}/articles/tag/${t.slug}`, changeFrequency: "monthly" as const, priority: 0.4 })),
        ...AUTHORS.map((a) => ({ url: `${site}/authors/${a.slug}`, changeFrequency: "monthly" as const, priority: 0.4 })),
      ]
    : [];

  const products = shopEnabled()
    ? [
        { url: `${site}/shop`, changeFrequency: "weekly" as const, priority: 0.7 },
        ...(db.prepare("SELECT id FROM products WHERE published=1").all() as { id: number }[]).map((p) => ({
          url: `${site}/shop/${p.id}`,
          changeFrequency: "weekly" as const,
          priority: 0.6,
        })),
      ]
    : [];

  return [...staticPages, ...episodes, ...guests, ...categories, ...articles, ...products];
}
