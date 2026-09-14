import { NextRequest, NextResponse } from "next/server";
import db from "@/lib/db";
import { isAdmin } from "@/lib/auth";
import { monthRange } from "@/lib/month";
import { rateLimit, clientIp } from "@/lib/ratelimit";

/*
 * 頁面瀏覽計數（後台總覽用）。
 * 只收白名單區域代號；登入後台的站長不計入（自己看不算流量）。
 * 前端 PageViewPing 已用 sessionStorage 做 30 分鐘去重，這裡再擋一次無效值。
 */
const PAGES = new Set(["home", "episodes", "guests", "articles", "support", "shop"]);

export async function POST(req: NextRequest) {
  /* 擋灌數：正常訪客一小時內頂多逛六個區域各一次，給寬鬆上限 */
  if (!rateLimit(`pv:${clientIp(req.headers)}`, 40, 60 * 60 * 1000))
    return NextResponse.json({ ok: false }, { status: 429 });
  const body = (await req.json().catch(() => null)) as { page?: string } | null;
  const page = String(body?.page || "");
  if (!PAGES.has(page)) return NextResponse.json({ ok: false }, { status: 400 });
  /* 站長自己的瀏覽不計入 */
  if (await isAdmin()) return NextResponse.json({ ok: true, skipped: "admin" });
  db.prepare(
    "INSERT INTO page_views (page,ym,count) VALUES (?,?,1) ON CONFLICT(page,ym) DO UPDATE SET count=count+1"
  ).run(page, monthRange().ym);
  return NextResponse.json({ ok: true });
}
