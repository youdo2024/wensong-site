import { NextRequest, NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import { buildAdminMail } from "@/lib/admin-mail";

/*
 * 寄信頁的即時預覽。
 *
 * 預覽刻意走伺服器並用同一支 buildAdminMail，不在前端重畫一份版型。
 * 前端自己畫的話，兩份遲早會不一樣，然後你看到的跟收件人收到的就不同了。
 */
export async function POST(req: NextRequest) {
  if (!(await isAdmin())) return new NextResponse("unauthorized", { status: 401 });
  const b = (await req.json().catch(() => ({}))) as Record<string, string>;
  const html = buildAdminMail({
    title: b.title || "",
    body: b.body || "",
    btnText: b.btnText,
    btnUrl: b.btnUrl,
    footnote: b.footnote,
  });
  return new NextResponse(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}
