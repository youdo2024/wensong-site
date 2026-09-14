import { NextRequest, NextResponse } from "next/server";
import { queryByOrderNo, tappayEnabled } from "@/lib/tappay";
import { settleTappayFromQuery } from "@/lib/payment-sync";
import { rateLimit, clientIp } from "@/lib/ratelimit";

/*
 * TapPay 3D 驗證完成後的背景通知（backend_notify_url）。
 * 通知本身沒有簽章，所以「不信通知、只信回查」：
 * 拿通知裡的訂單編號去 Record API 回查（TLS＋partner key，可信來源），
 * 查到已付款才入帳。查詢暫時失敗就維持 pending 並回非 200，TapPay 會重送。
 *
 * 注意「不信通知只信回查」解決的是入帳正確性，不是存取控制：
 * 這支端點誰都能打，帶任意訂單編號就能驅使我們去呼叫 TapPay，所以要有流量限制。
 */
export async function POST(req: NextRequest) {
  if (!tappayEnabled()) return new NextResponse("disabled", { status: 400 });
  /* 放寬到每小時 300 次：TapPay 正常重送遠低於這個量，但擋得住被拿來當放大器 */
  if (!rateLimit(`tappay-notify:${clientIp(req.headers)}`, 300, 60 * 60 * 1000))
    return new NextResponse("too many requests", { status: 429 });

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const orderNo = String(body.order_number || "");
  if (!orderNo.startsWith("YD")) {
    /* TapPay 目前只用於商店訂單，收到非 YD 就代表有異常。
       原本直接回 OK 且不留痕跡，等於靜靜丟掉。 */
    console.warn("[tappay notify] 收到非商店訂單的通知，已忽略", orderNo.slice(0, 40));
    return new NextResponse("OK");
  }

  const q = await queryByOrderNo(orderNo);
  if (!q) return new NextResponse("query failed, retry", { status: 500 });
  settleTappayFromQuery(orderNo, q);
  return new NextResponse("OK");
}
