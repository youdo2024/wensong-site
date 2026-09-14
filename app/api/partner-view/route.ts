import { NextRequest, NextResponse } from "next/server";
import { PARTNER_COOKIE, partnerByKey } from "@/lib/partner";
import { rateLimit, clientIp } from "@/lib/ratelimit";
import { cookieSecure } from "@/lib/cookie-secure";

/*
 * 出貨夥伴頁入口：/api/partner-view?k=<金鑰>
 * 金鑰正確就種 90 天的 httpOnly cookie 並導去 /partner；
 * 錯誤一樣導去 /partner（會看到「沒有開放」，不透露金鑰對錯）。
 * 90 天：整個中秋檔期點一次連結就好，夥伴不用每週重新開信找連結。
 */
export async function GET(req: NextRequest) {
  const dest = process.env.SITE_URL
    ? new URL("/partner", process.env.SITE_URL)
    : new URL("/partner", req.url);
  if (!rateLimit(`partner:${clientIp(req.headers)}`, 20, 60 * 60 * 1000)) {
    return NextResponse.redirect(dest);
  }
  const k = req.nextUrl.searchParams.get("k") || "";
  /* 一人一把：查 partners 表，停用的夥伴等同金鑰不存在 */
  const partner = partnerByKey(k);
  const res = NextResponse.redirect(dest);
  if (partner) {
    res.cookies.set(PARTNER_COOKIE, partner.key, {
      httpOnly: true,
      sameSite: "lax",
      secure: cookieSecure(),
      maxAge: 90 * 24 * 3600,
      path: "/",
    });
  }
  return res;
}
