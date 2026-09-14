import { NextRequest, NextResponse } from "next/server";
import db from "@/lib/db";
import {
  newebpayEnabled, parseNotify,
  isNewebpayOrderMtn, orderNoFromNewebpayMtn,
  isNewebpaySponsorMtn, sponsorIdFromNewebpayMtn,
} from "@/lib/newebpay";

/*
 * 藍新付款完成後，把顧客的瀏覽器 POST 回這裡（ReturnURL）。
 * 純導頁用：只讀資料庫取回訂單權杖／贊助權杖組導向網址，不在這裡寫入任何付款結果，
 * 實際入帳一律交給背景通知 /api/newebpay/notify（比照 app/api/ecpay/result/route.ts 的分工）。
 * ATM 取號的跳轉走 CustomerURL（/api/newebpay/atm），理論上不會落到這支，
 * 但驗簽失敗或解不出編號時一律給中性的失敗導頁，不猜、不洩漏任何細節。
 */
export async function POST(req: NextRequest) {
  const site = (process.env.SITE_URL || "https://www.wensong.tw").replace(/\/$/, "");
  const body = Object.fromEntries(new URLSearchParams(await req.text())) as Record<string, string>;
  const r = newebpayEnabled() ? parseNotify(body) : null;
  const ok = Boolean(r?.ok);
  const mtn = r?.merchantOrderNo || "";

  if (isNewebpayOrderMtn(mtn)) {
    const orderNo = orderNoFromNewebpayMtn(mtn);
    const od = db.prepare("SELECT order_no,token FROM orders WHERE order_no=?").get(orderNo) as
      | { order_no: string; token: string }
      | undefined;
    const q = new URLSearchParams({ no: orderNo });
    if (od?.token) q.set("k", od.token);
    if (!ok) q.set("pay", "failed");
    return NextResponse.redirect(`${site}/shop/thanks?${q.toString()}`, 303);
  }

  if (isNewebpaySponsorMtn(mtn)) {
    const id = sponsorIdFromNewebpayMtn(mtn);
    const sp = id
      ? (db.prepare("SELECT id,mode,amount,pay_token FROM sponsorships WHERE id=?").get(id) as
          | { id: number; mode: string; amount: number; pay_token: string }
          | undefined)
      : undefined;
    const mode = sp?.mode === "monthly" ? "monthly" : "once";
    const rescue = sp && mode === "once" ? `&sid=${sp.id}&t=${encodeURIComponent(sp.pay_token)}` : "";
    const url = ok
      ? `${site}/support/thanks?mode=${mode}&pay=paid&amt=${sp?.amount || 0}&no=${encodeURIComponent(mtn)}`
      : `${site}/support/thanks?mode=${mode}&pay=failed${rescue}`;
    return NextResponse.redirect(url, 303);
  }

  /* 查無編號（驗簽失敗、金鑰未設、或根本不是我們發出去的交易）：不洩漏任何細節，導回商店首頁 */
  return NextResponse.redirect(`${site}/shop`, 303);
}
