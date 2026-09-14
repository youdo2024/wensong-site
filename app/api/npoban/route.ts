import { NextResponse } from "next/server";
import { npobanFormatOk, npobanName } from "@/lib/npoban";
import { rateLimit, clientIp } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";

/*
 * 捐贈碼查名稱。結帳頁客人打字時即時顯示「你要捐給誰」。
 *
 * 為什麼是 API 而不是把整份清單送到前端：2,022 筆、107KB，
 * 而九成九的人用預設的 8585 完全不會查。為了那一成的人讓每個人都多下載 107KB
 * 不划算，何況購物車頁的載入速度直接影響成交。
 *
 * 只回名稱，不回統編也不回縣市：前端只需要「這個碼是誰」，
 * 多送的欄位都是不必要的外洩面。
 */
export async function GET(req: Request) {
  if (!rateLimit(`npoban:${clientIp(req.headers)}`, 120, 60 * 60 * 1000))
    return NextResponse.json({ error: "查詢太頻繁，請稍後再試" }, { status: 429 });

  const code = (new URL(req.url).searchParams.get("code") || "").trim();
  if (!npobanFormatOk(code))
    return NextResponse.json({ ok: false, reason: "format", msg: "捐贈碼是 3 到 7 位數字" }, { status: 200 });

  const name = npobanName(code);
  if (!name)
    return NextResponse.json({ ok: false, reason: "notfound", msg: "查不到這個捐贈碼" }, { status: 200 });

  return NextResponse.json({ ok: true, code, name }, { status: 200 });
}
