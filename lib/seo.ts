import type { Metadata } from "next";
import { isReviewSite } from "./review-mode";
import { BRAND } from "./brand";

/*
 * 全站 SEO 常數與 metadata 產生器。
 * 所有公開頁面一律透過 buildMetadata() 產生 metadata，不各頁散寫，
 * 才能保證每頁有指向自己的 canonical 與 og:url、og:locale、完整的 og:image。
 */

export const SEO = {
  siteName: BRAND.name,
  siteUrl: (process.env.SITE_URL || BRAND.siteUrl).replace(/\/$/, ""),
  locale: "zh_TW",
  htmlLang: "zh-Hant-TW",
  /* 品牌後綴統一單一：雙後綴會把搜尋結果的標題吃掉一半 */
  titleSuffix: `｜${BRAND.name}`,
  defaultTitle: BRAND.fullName,
  defaultOgImage: BRAND.ogImage,
  defaultOgImageWidth: BRAND.ogImageWidth,
  defaultOgImageHeight: BRAND.ogImageHeight,
  legalName: BRAND.legalName,
  email: BRAND.email,
} as const;

/* 站台預設描述：頁面沒提供自己的 description 時的退回值 */
export const DEFAULT_DESCRIPTION = BRAND.description;

export type BuildMetadataInput = {
  title?: string;
  seoTitle?: string;
  description?: string;
  path: string;
  ogImage?: { url: string; width?: number; height?: number; alt?: string };
  ogType?: "website" | "article";
  noindex?: boolean;
};

export function absUrl(path: string): string {
  return `${SEO.siteUrl}${path.startsWith("/") ? path : `/${path}`}`;
}

export function buildMetadata(inp: BuildMetadataInput): Metadata {
  const url = absUrl(inp.path);
  const description = inp.description || DEFAULT_DESCRIPTION;
  const img = inp.ogImage || {
    url: SEO.defaultOgImage,
    width: SEO.defaultOgImageWidth,
    height: SEO.defaultOgImageHeight,
    alt: SEO.defaultTitle,
  };
  const ogImages = [{ url: img.url, width: img.width ?? 1200, height: img.height ?? 630, alt: img.alt ?? inp.title ?? SEO.siteName }];
  const fullTitle = inp.title ? `${inp.title}${SEO.titleSuffix}` : SEO.defaultTitle;

  return {
    ...(inp.seoTitle || inp.title ? { title: inp.seoTitle || inp.title } : {}),
    description,
    alternates: { canonical: url },
    openGraph: {
      title: fullTitle,
      description,
      url,
      siteName: SEO.defaultTitle,
      locale: SEO.locale,
      type: inp.ogType || "website",
      images: ogImages,
    },
    twitter: {
      card: "summary_large_image",
      title: fullTitle,
      description,
      images: [img.url],
    },
    ...(inp.noindex || isReviewSite() ? { robots: { index: false, follow: false } } : {}),
  };
}

/*
 * 摘要截斷：能切在句號就切在句號；句號太靠前（不到一半）寧可硬切補省略號。
 */
export function clampDesc(text: string, max = 110): string {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const head = t.slice(0, max);
  const cut = Math.max(head.lastIndexOf("。"), head.lastIndexOf("！"), head.lastIndexOf("？"));
  if (cut >= max * 0.5) return head.slice(0, cut + 1);
  return `${head.slice(0, max - 1)}…`;
}

/*
 * <title> 的退回機制：seo_title 有填就用；沒填把原標題截到 26 個全形字，
 * H1 與 og:title 永遠用完整原標題。
 */
export function articleSeoTitle(title: string, seoTitle?: string | null): string {
  if (seoTitle && seoTitle.trim()) return seoTitle.trim();
  const t = title.trim();
  return t.length > 26 ? `${t.slice(0, 25)}…` : t;
}
