import { NextRequest, NextResponse } from "next/server";
import db from "@/lib/db";
import { viewPingAllowed } from "@/lib/view-limit";

/* 記一次文章觀看：前台文章頁載入時由 ArticleView 呼叫一次 */
export async function POST(req: NextRequest) {
  try {
    const { slug } = (await req.json()) as { slug?: string };
    if (!slug || typeof slug !== "string") return NextResponse.json({ ok: false }, { status: 400 });
    /* 超過上限就不記這一次，但照實回報 skipped，不假裝有算到（見 lib/view-limit.ts） */
    if (!viewPingAllowed(req.headers, "articles"))
      return NextResponse.json({ ok: true, skipped: "rate-limited" });
    db.prepare("UPDATE articles SET views = views + 1 WHERE slug=? AND published=1").run(slug);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
}
