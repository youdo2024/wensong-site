import { NextRequest, NextResponse } from "next/server";
import { linepayProbe } from "@/lib/linepay";
import { rateLimit, clientIp } from "@/lib/ratelimit";

/*
 * LINE Pay 連線探測（公開、唯讀、限流）。只回「金鑰通不通」與 LINE 的錯誤碼，
 * 不回任何金鑰內容。用途：換完金鑰後不用登入、不用下單就能確認；Claude 也能從外面幫站長驗。
 */
export const dynamic = "force-dynamic";
export async function GET(req: NextRequest) {
  if (!rateLimit(`lpprobe:${clientIp(req.headers)}`, 5, 60_000)) return NextResponse.json({ error: "too many" }, { status: 429 });
  const r = await linepayProbe();
  return NextResponse.json(r, { headers: { "Cache-Control": "no-store" } });
}
