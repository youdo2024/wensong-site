import { NextRequest, NextResponse } from "next/server";
import db from "@/lib/db";
import { rateLimit, clientIp } from "@/lib/ratelimit";

/*
 * 文章互動投票（:::投票 區塊）。
 * POST {key, opt}＝投一票並回傳最新統計；GET ?key=＝只看統計。
 * 防重複靠瀏覽器 localStorage（輕量誠實制）＋每 IP 頻率限制擋灌票。
 */

function counts(key: string): number[] {
  const rows = db.prepare("SELECT opt, count FROM poll_votes WHERE key=? ORDER BY opt").all(key) as { opt: number; count: number }[];
  const out: number[] = [];
  for (const r of rows) out[r.opt] = r.count;
  for (let i = 0; i < out.length; i++) out[i] = out[i] || 0;
  return out;
}

export async function GET(req: NextRequest) {
  const key = (req.nextUrl.searchParams.get("key") || "").slice(0, 120);
  if (!key) return NextResponse.json({ error: "missing key" }, { status: 400 });
  return NextResponse.json({ counts: counts(key) });
}

export async function POST(req: NextRequest) {
  if (!rateLimit(`poll:${clientIp(req.headers)}`, 30, 60 * 60 * 1000))
    return NextResponse.json({ error: "太頻繁" }, { status: 429 });
  const body = (await req.json().catch(() => null)) as { key?: string; opt?: number } | null;
  const key = String(body?.key || "").slice(0, 120);
  const opt = Math.floor(Number(body?.opt));
  if (!key || !Number.isFinite(opt) || opt < 0 || opt > 19)
    return NextResponse.json({ error: "格式錯誤" }, { status: 400 });
  db.prepare(
    "INSERT INTO poll_votes (key,opt,count) VALUES (?,?,1) ON CONFLICT(key,opt) DO UPDATE SET count=count+1"
  ).run(key, opt);
  return NextResponse.json({ counts: counts(key) });
}
