import { NextRequest, NextResponse } from "next/server";
import { memberSiteUrl } from "@/lib/member";
import { clientIp, rateLimit } from "@/lib/ratelimit";
import { articleSlugExists, parseUtmCode, utmQuery } from "@/lib/utm-link";

/*
 * /s/<slug>-<管道> → 301 → /articles/<slug>?utm_source=…&utm_medium=…&utm_campaign=<slug>
 * 規則與管道表在 lib/utm-link.ts（那裡才測得到）。
 * 限流跟 /l/ 一樣：公開入口，不限流會被拿去掃。
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ code: string }> }) {
  const { code } = await ctx.params;
  if (!rateLimit(`utm:${clientIp(req.headers)}`, 60, 60_000)) {
    return new NextResponse("太多次了，請過一分鐘再試。", {
      status: 429,
      headers: { "Content-Type": "text/plain; charset=utf-8", "Retry-After": "60" },
    });
  }
  const p = parseUtmCode(code);
  if (!p || !articleSlugExists(p.slug)) {
    return new NextResponse("找不到這個連結。", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }
  const q = utmQuery(p.slug, p.channel, req.nextUrl.searchParams);
  return NextResponse.redirect(`${memberSiteUrl()}/articles/${p.slug}?${q}`, 301);
}
