import type { MetadataRoute } from "next";
import { isReviewSite } from "@/lib/review-mode";

/* 必須是動態的：robots.txt 預設在建置時就產好，而 REVIEW_SITE 是執行時才有的
   環境變數。靜態的話審核站會吐出正式站那份「歡迎來爬」的內容（實測踩到）。
   sitemap.ts 早就是 force-dynamic，這裡漏了。 */
export const dynamic = "force-dynamic";

export default function robots(): MetadataRoute.Robots {
  const site = (process.env.SITE_URL || "https://www.wensong.tw").replace(/\/$/, "");
  /*
   * 審核站全站禁爬。它跟正式站長得一模一樣，被收錄就是整站重複內容，
   * 傷的是正式站的排名。每一頁的 meta 已經有 noindex，這裡是第二道——
   * 兩道的作用不同：noindex 是「收了也別顯示」，robots 是「根本別來爬」。
   */
  if (isReviewSite()) {
    return { rules: [{ userAgent: "*", disallow: "/" }] };
  }
  const disallow = ["/admin", "/api", "/cart", "/checkout", "/account"];
  /* 明確允許 AI 爬蟲（P3-2）：本站目標是被 AI 搜尋正確引用，不要擋 */
  const aiBots = ["GPTBot", "ClaudeBot", "PerplexityBot", "Google-Extended", "CCBot", "Applebot-Extended"];
  return {
    rules: [
      { userAgent: "*", allow: "/", disallow },
      ...aiBots.map((userAgent) => ({ userAgent, allow: "/", disallow })),
    ],
    sitemap: `${site}/sitemap.xml`,
  };
}
