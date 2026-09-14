import { NextRequest, NextResponse } from "next/server";
import { SHOP_PREVIEW_COOKIE, shopPreviewKey } from "@/lib/shop-preview";
import { rateLimit, clientIp } from "@/lib/ratelimit";

/*
 * 商店預覽入口：/api/shop-preview?k=<金鑰>
 * 金鑰正確就種 30 天的 httpOnly cookie 並導去商店；錯誤就導去商店
 * （訪客會看到「商店暫時休息中」，不透露金鑰對錯）。
 */
export async function GET(req: NextRequest) {
  /* 正式站在反向代理後面，req.url 是內部位址（localhost:8080），
     所以優先用 SITE_URL；本機沒設 SITE_URL 就用請求本身的網域 */
  const dest = process.env.SITE_URL
    ? new URL("/shop", process.env.SITE_URL)
    : new URL("/shop", req.url);
  if (!rateLimit(`shoppv:${clientIp(req.headers)}`, 20, 60 * 60 * 1000)) {
    return NextResponse.redirect(dest);
  }
  const k = req.nextUrl.searchParams.get("k") || "";
  const key = shopPreviewKey();
  const res = NextResponse.redirect(dest);
  if (key && k === key) {
    res.cookies.set(SHOP_PREVIEW_COOKIE, key, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 30 * 24 * 3600,
      path: "/",
    });
  }
  return res;
}
