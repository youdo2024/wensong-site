import type { Metadata, Viewport } from "next";
import { Noto_Serif_TC, Noto_Sans_TC } from "next/font/google";
import "./globals.css";
import "./podcast.css";
import "./theme.css";
import { CartProvider } from "@/components/CartProvider";
import { SiteConfigProvider } from "@/components/SiteConfig";
import SocialFloat from "@/components/SocialFloat";
import { GoogleAnalytics } from "@/components/Analytics";
import { isReviewSite } from "@/lib/review-mode";
import SponsorClickTracker from "@/components/SponsorClickTracker";
import { getSetting } from "@/lib/db";
import { shopViewable } from "@/lib/shop-preview";
import JsonLd from "@/components/JsonLd";
import { memberEnabled } from "@/lib/member";
import { supportEnabled, supportHref, supportIsExternal } from "@/lib/shop";
import { BRAND } from "@/lib/brand";
import { SEO } from "@/lib/seo";
import { articlesEnabled, hosts, platformLinks } from "@/lib/site-config";

const serif = Noto_Serif_TC({
  weight: ["400", "700"],
  subsets: ["latin"],
  variable: "--font-serif",
  display: "swap",
});
const sans = Noto_Sans_TC({
  weight: ["400", "500", "700", "900"],
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

/*
 * 快取政策下放到各頁：商店、購物車、後台一律 force-dynamic；
 * 集數與文章詳情 revalidate 300（後台存檔會主動失效）。
 * 新增頁面必須明寫其中一種，別依賴預設。
 */

export const metadata: Metadata = {
  metadataBase: new URL(SEO.siteUrl),
  title: {
    default: BRAND.fullName,
    template: `%s${SEO.titleSuffix}`,
  },
  description: BRAND.description,
  openGraph: {
    title: BRAND.fullName,
    description: BRAND.tagline,
    url: SEO.siteUrl,
    siteName: BRAND.fullName,
    locale: "zh_TW",
    type: "website",
    images: [{ url: BRAND.ogImage, width: BRAND.ogImageWidth, height: BRAND.ogImageHeight, alt: BRAND.fullName }],
  },
  twitter: {
    card: "summary_large_image",
    title: BRAND.fullName,
    images: [BRAND.ogImage],
  },
  alternates: { types: { "application/rss+xml": "/rss.xml" } },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: BRAND.themeColor,
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const config = {
    shopEnabled: await shopViewable(),
    supportEnabled: supportEnabled(),
    supportHref: supportHref(),
    supportExternal: supportIsExternal(),
    memberEnabled: memberEnabled(),
    articlesEnabled: articlesEnabled(),
    social: {
      fb: getSetting("social_fb", ""),
      ig: getSetting("social_ig", ""),
      yt: getSetting("social_yt", ""),
    },
    platforms: platformLinks(),
  };
  const hostList = hosts();
  const sameAs = [config.social.ig, config.social.fb, config.social.yt, ...config.platforms.map((p) => p.url)].filter(Boolean);

  return (
    <html lang="zh-Hant-TW" data-scroll-behavior="smooth" suppressHydrationWarning>
      <body className={`${serif.variable} ${sans.variable}`}>
        {/* 全站結構化資料：Organization／WebSite／PodcastSeries／主持人 Person */}
        <JsonLd
          data={[
            {
              "@context": "https://schema.org",
              "@type": "Organization",
              name: BRAND.name,
              legalName: BRAND.legalName,
              url: SEO.siteUrl,
              logo: `${SEO.siteUrl}${BRAND.logo}`,
              email: BRAND.email,
              address: { "@type": "PostalAddress", addressCountry: "TW", addressRegion: BRAND.address.region, addressLocality: BRAND.address.locality, streetAddress: BRAND.address.street },
              sameAs,
            },
            {
              "@context": "https://schema.org",
              "@type": "WebSite",
              name: BRAND.fullName,
              url: SEO.siteUrl,
              inLanguage: "zh-Hant-TW",
              potentialAction: {
                "@type": "SearchAction",
                target: { "@type": "EntryPoint", urlTemplate: `${SEO.siteUrl}/search?q={search_term_string}` },
                "query-input": "required name=search_term_string",
              },
            },
            {
              "@context": "https://schema.org",
              "@type": "PodcastSeries",
              name: BRAND.fullName,
              url: SEO.siteUrl,
              description: BRAND.description,
              inLanguage: "zh-Hant-TW",
              webFeed: getSetting("podcast_rss_url", BRAND.rssUrl),
              image: getSetting("podcast_cover", `${SEO.siteUrl}${BRAND.ogImage}`),
              author: hostList.map((h) => ({ "@type": "Person", name: h.name, url: `${SEO.siteUrl}/about` })),
              publisher: { "@type": "Organization", name: BRAND.name, url: SEO.siteUrl },
            },
          ]}
        />
        {/* 標記「JS 有跑」：捲動動畫的初始隱藏都掛在 .js-fx 底下，JS 壞掉時內容照常顯示 */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "var e=document.documentElement;e.classList.add('js-fx');setTimeout(function(){if(!e.classList.contains('fx-ready'))e.classList.remove('js-fx')},4000)",
          }}
        />
        <SiteConfigProvider value={config}>
          <CartProvider>
            {children}
            <SocialFloat />
          </CartProvider>
        </SiteConfigProvider>
        {/* 審核站不送 GA。Meta Pixel 第 1 版不裝（決策定案 Q36） */}
        {!isReviewSite() && <GoogleAnalytics />}
        <SponsorClickTracker />
      </body>
    </html>
  );
}
