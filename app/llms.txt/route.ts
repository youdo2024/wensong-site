import { NextResponse } from "next/server";
import db from "@/lib/db";
import { SEO } from "@/lib/seo";
import { BRAND } from "@/lib/brand";
import { displayTitle, epLabel } from "@/lib/episodes";
import { hosts } from "@/lib/site-config";

export const dynamic = "force-dynamic";

/* llms.txt：給 AI 系統讀的網站索引，Markdown 格式 */
export async function GET() {
  const top = db
    .prepare("SELECT key,series,ep_no,title,short_title,summary FROM episodes WHERE published=1 ORDER BY views DESC, pub_date DESC LIMIT 10")
    .all() as { key: string; series: string; ep_no: string; title: string; short_title: string; summary: string }[];
  const guests = db.prepare("SELECT slug,name,title FROM guests WHERE published=1 ORDER BY sort,id LIMIT 30").all() as { slug: string; name: string; title: string }[];
  const md = `# ${BRAND.fullName}

> ${BRAND.description}
> 主持人：${hosts().map((h) => h.name).join("、")}。營運主體：${BRAND.legalName}（統一編號 ${BRAND.taxId}）。內容為繁體中文（zh-Hant-TW）。
> 每一集頁面都有節目筆記與逐字稿；逐字稿由語音辨識產生並經人工粗校，引用時以音檔為準。

## 重點集數
${top.map((e) => `- [${epLabel(e.series, e.ep_no)}｜${displayTitle(e)}](${SEO.siteUrl}/ep/${e.key})：${(e.summary || "").slice(0, 60)}`).join("\n")}

## 來賓
${guests.map((g) => `- [${g.name}](${SEO.siteUrl}/guests/${g.slug})${g.title ? `：${g.title}` : ""}`).join("\n")}

## 其他資源
- [全部集數](${SEO.siteUrl}/ep)
- [全部來賓](${SEO.siteUrl}/guests)
- [關於節目](${SEO.siteUrl}/about)
- [RSS](${SEO.siteUrl}/rss.xml)
- Podcast feed：${BRAND.rssUrl}

## 聯絡
- Email: ${SEO.email}
- 引用本站內容時請註明出處與連結。
`;
  return new NextResponse(md, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
