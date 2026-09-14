import { NextRequest, NextResponse } from "next/server";
import { safeEqual } from "@/lib/safe-equal";

/* 查這台伺服器對外打 API 時的來源 IP（藍新 IP 白名單要填的那個）。
   Zeabur 沒給固定 IP 的保證，所以直接從容器裡問一次外部服務最準。只認 IMPORT_TOKEN。 */
export async function GET(req: NextRequest) {
  const token = process.env.IMPORT_TOKEN || "";
  const given = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token || !given || !safeEqual(given, token)) return NextResponse.json({ ok: false }, { status: 404 });
  const results: Record<string, string> = {};
  for (const url of ["https://api.ipify.org", "https://ifconfig.me/ip", "https://icanhazip.com"]) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(8000), headers: { "User-Agent": "curl/8" } });
      results[url] = (await r.text()).trim();
    } catch (e) {
      results[url] = `error: ${e instanceof Error ? e.message : String(e)}`;
    }
  }
  return NextResponse.json({ ok: true, results });
}
