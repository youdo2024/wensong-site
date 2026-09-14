import { NextRequest, NextResponse } from "next/server";
import db from "@/lib/db";
import { queryByOrderNo, tappayEnabled } from "@/lib/tappay";
import { settleTappayFromQuery } from "@/lib/payment-sync";

/*
 * 3D 驗證完把顧客的瀏覽器導回這裡（frontend_redirect_url），轉去感謝頁。
 * 正常情況背景通知已先入帳；若通知還沒到（或掉了），這裡主動回查一次補上，
 * 顧客看到的畫面永遠與真實付款狀態一致。
 *
 * 這支是沒有簽章的 GET，所以權杖驗證是唯一的門。原本它會無條件把資料庫裡的
 * 訂單權杖放進導向網址，而訂單編號可以枚舉，等於任何人都能換到別人的權杖，
 * 再拿去感謝頁看金額與繳費資訊，把防枚舉的設計整個繞過。
 * 現在權杖改由請款階段寫進導回網址，這裡只做比對，不主動發放。
 */
export async function GET(req: NextRequest) {
  const site = (process.env.SITE_URL || "https://www.wensong.tw").replace(/\/$/, "");
  const orderNo = req.nextUrl.searchParams.get("no") || "";
  const k = req.nextUrl.searchParams.get("k") || "";
  if (!orderNo.startsWith("YD")) return NextResponse.redirect(`${site}/shop`, 303);

  const ordRow = db.prepare("SELECT id,status,token FROM orders WHERE order_no=?").get(orderNo) as
    | { id: number; status: string; token: string }
    | undefined;
  if (!ordRow) return NextResponse.redirect(`${site}/shop`, 303);

  /* 權杖相符才算本人。舊訂單（token 為空）維持原行為，否則它們會突然無法完成導回 */
  const trusted = !ordRow.token || (Boolean(k) && k === ordRow.token);

  let status = ordRow.status;
  if (status === "pending" && tappayEnabled()) {
    const q = await queryByOrderNo(orderNo);
    if (q) {
      const settled = settleTappayFromQuery(orderNo, q);
      if (settled === "paid") status = "paid";
      /* 明確的授權失敗（RecordStatus ERROR）會被標成 cancelled，顧客要看到失敗頁而不是待付款 */
      else if (settled === "failed") status = "cancelled";
      /* 顧客已經從銀行頁回來、而且沒有付成功：放掉請款鎖讓他能立刻換卡重試，
         不必等鎖自然過期。狀態不明的仍維持待付款，交給對帳判斷。 */
      if (!q.paid) {
        db.prepare("UPDATE orders SET charge_lock_at='' WHERE id=? AND status='pending'").run(ordRow.id);
      }
    }
  }

  const pay = status === "paid" ? "paid" : status === "cancelled" ? "failed" : "pending";
  const tokQs = trusted && ordRow.token ? `&k=${encodeURIComponent(ordRow.token)}` : "";
  return NextResponse.redirect(`${site}/shop/thanks?no=${encodeURIComponent(orderNo)}&pay=${pay}${tokQs}`, 303);
}
