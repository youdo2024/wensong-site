import { NextResponse } from "next/server";
import { lookupTaxId } from "@/lib/taxid";
import { rateLimit, clientIp } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";

/*
 * 統編查名稱（結帳頁「打統編」用）。由伺服器代打經濟部：
 * 對方沒有 CORS，前端直接打不會成功；而且經濟部逾時的時候，
 * 這裡可以決定「查不到就算了」，不會把結帳卡住。
 */
export async function GET(req: Request) {
  if (!rateLimit(`taxid:${clientIp(req.headers)}`, 60, 60 * 60 * 1000))
    return NextResponse.json({ ok: false, reason: "rate" }, { status: 429 });
  const no = (new URL(req.url).searchParams.get("no") || "").trim();
  return NextResponse.json(await lookupTaxId(no), { status: 200 });
}
