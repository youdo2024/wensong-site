import { NextRequest, NextResponse } from "next/server";
import { memberSiteUrl } from "@/lib/member";
import { clientIp, rateLimit } from "@/lib/ratelimit";
import { recordShortBlocked, recordShortClick, resolveShortPath } from "@/lib/short-link";

/*
 * 簡訊用的短網址：/l/<碼> → 站內某一頁。簡訊只有 268 字，放不下完整網址。
 *
 * 這條路現在認兩種碼，順序不能反：
 *   1. short_links 的 8 碼（2026-09-07 起發的，見 lib/short-link.ts）。
 *   2. 24 碼的訂單權杖（舊制，只轉到 /line/bind）。
 *      客人手機裡的舊簡訊還躺著這種連結，而且沒有有效期。
 *      新表查不到才走這一條，行為與 2026-09-07 之前一模一樣。
 *
 * 為什麼要限流（每分鐘 30 次）：這是公開入口，沒有登入也沒有 referer 檢查，
 * 任何人都能拿字典去掃。8 碼有 56^8 種組合，掃不完，但不限流的話
 * 對方可以用全速去掃，順便把資料庫打滿。擋下來的次數記在那一條上，
 * 站長在發送頁看得到「這條連結有人在狂打」。
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ code: string }> }) {
  const site = memberSiteUrl();
  const { code } = await ctx.params;

  if (!rateLimit(`short:${clientIp(req.headers)}`, 30, 60_000)) {
    recordShortBlocked(code);
    return new NextResponse("太多次了，請過一分鐘再試。", {
      status: 429,
      headers: { "Content-Type": "text/plain; charset=utf-8", "Retry-After": "60" },
    });
  }

  /* 判斷全在 lib/short-link.ts 的 resolveShortPath（那樣才測得到） */
  const hit = resolveShortPath(code);
  if (hit.kind === "short") recordShortClick(hit.code);
  /* path 一定以 / 開頭（建表時就擋掉了 // 與外部網域），接上站台網域就是完整網址 */
  return NextResponse.redirect(`${site}${hit.path}`, 303);
}
