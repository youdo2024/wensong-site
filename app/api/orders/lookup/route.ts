import { NextRequest, NextResponse } from "next/server";
import db from "@/lib/db";
import { rateLimit, clientIp } from "@/lib/ratelimit";

export async function POST(req: NextRequest) {
  if (!rateLimit(`lookup:${clientIp(req.headers)}`, 30, 60 * 60 * 1000))
    return NextResponse.json({ error: "查詢太頻繁，請稍後再試" }, { status: 429 });
  const body = await req.json().catch(() => null);
  const orderNo = String(body?.orderNo || "").trim();
  const email = String(body?.email || "").trim().toLowerCase();
  if (!orderNo || !email)
    return NextResponse.json({ error: "請填訂單編號與 Email" }, { status: 400 });

  const order = db
    .prepare("SELECT order_no,status,items,subtotal,shipping,total,created_at FROM orders WHERE order_no=? AND lower(email)=?")
    .get(orderNo, email) as
    | { order_no: string; status: string; items: string; subtotal: number; shipping: number; total: number; created_at: string }
    | undefined;

  if (!order)
    return NextResponse.json({ error: "查無此訂單，請確認編號與 Email 是否正確" }, { status: 404 });

  return NextResponse.json({
    orderNo: order.order_no,
    status: order.status,
    items: JSON.parse(order.items),
    subtotal: order.subtotal,
    shipping: order.shipping,
    total: order.total,
    createdAt: order.created_at,
  });
}
