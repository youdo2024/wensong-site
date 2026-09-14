import { NextRequest, NextResponse } from "next/server";
import db from "@/lib/db";
import { viewPingAllowed } from "@/lib/view-limit";

/* 記一次來賓頁觀看 */
export async function POST(req: NextRequest) {
  try {
    const { id } = (await req.json()) as { id?: number };
    if (!id || typeof id !== "number") return NextResponse.json({ ok: false }, { status: 400 });
    if (!viewPingAllowed(req.headers, "guests")) return NextResponse.json({ ok: true, skipped: "rate-limited" });
    db.prepare("UPDATE guests SET views = views + 1 WHERE id=? AND published=1").run(id);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
}
