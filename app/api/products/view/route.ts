import { NextRequest, NextResponse } from "next/server";
import db from "@/lib/db";
import { viewPingAllowed } from "@/lib/view-limit";

/* 記一次商品觀看：商品詳情頁載入時由 ViewPing 呼叫一次 */
export async function POST(req: NextRequest) {
  try {
    const { id } = (await req.json()) as { id?: number };
    if (!id || typeof id !== "number") return NextResponse.json({ ok: false }, { status: 400 });
    /* 超過上限就不記這一次，但照實回報 skipped，不假裝有算到（見 lib/view-limit.ts） */
    if (!viewPingAllowed(req.headers, "products"))
      return NextResponse.json({ ok: true, skipped: "rate-limited" });
    db.prepare("UPDATE products SET views = views + 1 WHERE id=? AND published=1").run(id);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
}
