import { NextResponse } from "next/server";
import { indexNowKey } from "@/lib/indexnow";

/* IndexNow 金鑰驗證檔（P3-4）：搜尋引擎收到 ping 後會來這裡核對金鑰 */
export async function GET() {
  return new NextResponse(indexNowKey(), { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
