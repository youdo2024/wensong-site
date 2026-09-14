import { NextRequest, NextResponse } from "next/server";
import { findDiscount, discountLabel } from "@/lib/shop";
import { rateLimit, clientIp } from "@/lib/ratelimit";

/* 結帳頁驗證折扣碼（實際金額仍以建立訂單時伺服器計算為準） */
export async function POST(req: NextRequest) {
  if (!rateLimit(`disc:${clientIp(req.headers)}`, 60, 60 * 60 * 1000))
    return NextResponse.json({ valid: false, error: "嘗試太頻繁，請稍後再試" }, { status: 429 });
  const body = await req.json().catch(() => null);
  const code = String(body?.code || "").trim();
  const d = findDiscount(code);
  if (!d) return NextResponse.json({ valid: false, error: "折扣碼無效或已停用" }, { status: 404 });
  return NextResponse.json({ valid: true, code: d.code, kind: d.kind, value: d.value, label: discountLabel(d) });
}
