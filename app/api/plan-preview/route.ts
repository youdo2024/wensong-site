import { NextRequest, NextResponse } from "next/server";
import { PLAN_PREVIEW_COOKIE, planPreviewKey } from "@/lib/plan-preview";
import { rateLimit, clientIp } from "@/lib/ratelimit";

/*
 * 支持方案說明頁入口：/api/plan-preview?k=<金鑰>
 * 金鑰正確就種 30 天的 httpOnly cookie 並導去說明頁；
 * 錯誤一樣導去說明頁（對方會看到「這個頁面目前沒有開放」，不透露金鑰對錯）。
 */
export async function GET(req: NextRequest) {
  /* 正式站在反向代理後面，req.url 是內部位址，所以優先用 SITE_URL */
  const dest = process.env.SITE_URL
    ? new URL("/support/plan", process.env.SITE_URL)
    : new URL("/support/plan", req.url);
  if (!rateLimit(`planpv:${clientIp(req.headers)}`, 20, 60 * 60 * 1000)) {
    return NextResponse.redirect(dest);
  }
  const k = req.nextUrl.searchParams.get("k") || "";
  const key = planPreviewKey();
  const res = NextResponse.redirect(dest);
  if (key && k === key) {
    res.cookies.set(PLAN_PREVIEW_COOKIE, key, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 30 * 24 * 3600,
      path: "/",
    });
  }
  return res;
}
