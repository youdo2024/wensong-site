import type { Metadata } from "next";
import Link from "next/link";
import Nav from "@/components/Nav";
import Footer from "@/components/Footer";
import Crumbs from "@/components/Crumbs";
import JsonLd from "@/components/JsonLd";
import PlatformLinks from "@/components/PlatformLinks";
import db from "@/lib/db";
import { buildMetadata, absUrl } from "@/lib/seo";
import { t } from "@/lib/copy";
import { BRAND } from "@/lib/brand";
import { hosts, platformLinks } from "@/lib/site-config";
import { supportEnabled } from "@/lib/shop";

export const metadata: Metadata = buildMetadata({
  title: "關於問爽的",
  path: "/about",
  description: `${BRAND.fullName}是維尼與安妮主持的 Podcast：問東問西，餐飲、創業、生活，一集一集問到爽。這一頁介紹節目、主持人，以及怎麼聯絡我們。`,
});

export const dynamic = "force-dynamic";

/*
 * 關於頁：節目是什麼、主持人是誰、怎麼聯絡。給三種讀者：想合作的品牌、想當來賓的人、
 * 以及評估權威性的搜尋引擎與 AI。主持人資料從 settings 讀（後台「設定・內容」可改）。
 */
export default function AboutPage() {
  const hostList = hosts();
  const platforms = platformLinks();
  const count = (db.prepare("SELECT COUNT(*) AS n FROM episodes WHERE published=1").get() as { n: number }).n;
  const first = (db.prepare("SELECT MIN(pub_date) AS d FROM episodes WHERE published=1").get() as { d: string | null }).d;
  const sec = { fontSize: 18, fontWeight: 900 as const, letterSpacing: ".1em", margin: "30px 0 10px" };
  const p = { fontSize: 15, lineHeight: 2.1, color: "var(--ink)" };

  const people = hostList.map((h) => ({
    "@context": "https://schema.org",
    "@type": "Person",
    name: h.name,
    jobTitle: `${BRAND.name} 主持人`,
    ...(h.intro ? { description: h.intro } : {}),
    url: absUrl("/about"),
    ...(h.link ? { sameAs: [h.link] } : {}),
    worksFor: { "@type": "Organization", name: BRAND.name, legalName: BRAND.legalName, url: absUrl("/") },
  }));

  return (
    <>
      <JsonLd data={people} />
      <Nav />
      <div className="frame" style={{ maxWidth: 680, padding: "48px 20px 100px" }}>
        <Crumbs items={[{ name: "首頁", path: "/" }, { name: "關於" }]} />
        <div className="page-head">
          <span className="tag">關 於</span>
          <h1>問爽的，是在問什麼？</h1>
          <p>{t("footer_line")}</p>
        </div>

        <h2 style={sec}>這個節目</h2>
        <p style={p}>
          {BRAND.name}是維尼跟安妮的聊天節目。一個問題很多，一個開餐廳，每一集找一個人或一件事，問到兩個人都覺得夠了為止。
          {first ? `從 ${first.slice(0, 4)} 年 ${Number(first.slice(5, 7))} 月開始，` : ""}目前 {count} 集，正篇之外還有聽眾投稿的特集。
        </p>
        <p style={p}>
          這個網站是節目的家：每一集都有節目筆記、逐字稿跟來賓資料，聽不完可以先看，想找某一集講過什麼也搜得到。
        </p>
        <PlatformLinks platforms={platforms} small />

        <h2 style={sec}>主持人</h2>
        <div className="hosts-grid" style={{ gridTemplateColumns: "1fr" }}>
          {hostList.map((h) => (
            <div className="host-card" key={h.key}>
              <div className={`photo${h.photo ? "" : " ph"}`}>
                {h.photo ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img src={h.photo} alt={h.name} loading="lazy" />
                ) : (
                  <span>{h.name.slice(0, 1)}</span>
                )}
              </div>
              <div className="body">
                <small>{h.title}</small>
                <b>{h.name}</b>
                <p>{h.intro}</p>
                {h.link && <a href={h.link} target="_blank" rel="noopener">追蹤 {h.name} →</a>}
              </div>
            </div>
          ))}
        </div>

        <h2 style={sec}>逐字稿怎麼來的</h2>
        <p style={p}>
          逐字稿由 AI 語音辨識產生，我們人工校過店名、人名與明顯錯字，但不逐句精校。看到怪字請以音檔為準，也歡迎到
          <Link href="/corrections" style={{ color: "var(--teal)", textUnderlineOffset: 4 }}>更正回報</Link>告訴我們。
        </p>

        <h2 style={sec}>誰在營運</h2>
        <p style={p}>
          本站由{BRAND.legalName}（統一編號 {BRAND.taxId}）營運。
          {supportEnabled() ? <>主要收入來自聽眾的<Link href="/support" style={{ color: "var(--teal)", textUnderlineOffset: 4 }}>支持方案</Link>；</> : null}
          想上節目、想合作，或有想問的題目，歡迎
          <a href={`mailto:${BRAND.email}`} style={{ color: "var(--teal)", textUnderlineOffset: 4 }}>來信 {BRAND.email}</a>。
        </p>

        <p style={{ marginTop: 30, display: "flex", gap: 10, flexWrap: "wrap" }}>
          <Link className="btn fill" href="/ep">看全部集數</Link>
          <Link className="btn" href="/guests">看全部來賓</Link>
        </p>
      </div>
      <Footer />
    </>
  );
}
