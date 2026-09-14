import { NextRequest, NextResponse } from "next/server";
import db from "@/lib/db";
import { newebpayEnabled } from "@/lib/newebpay";
import { parsePeriodNotify, isNewebpayPeriodMtn, sponsorIdFromNewebpayPeriodMtn } from "@/lib/newebpay-period";

/*
 * 藍新定期定額委託建立完成後，顧客的瀏覽器 POST 回這裡（ReturnURL）。
 * 純導頁用：只讀資料庫取回金額顯示，不在這裡寫入任何委託結果，
 * 實際入帳（開發票、寄感謝信、寫 credit_token）一律交給背景通知
 * /api/newebpay/period/notify，比照 app/api/newebpay/return 對單筆付款的分工。
 */
export async function POST(req: NextRequest) {
  const site = (process.env.SITE_URL || "https://www.wensong.tw").replace(/\/$/, "");
  const body = Object.fromEntries(new URLSearchParams(await req.text())) as Record<string, string>;
  const r = newebpayEnabled() ? parsePeriodNotify(body) : null;
  const ok = Boolean(r?.ok);
  const mtn = r?.merOrderNo || "";
  const id = isNewebpayPeriodMtn(mtn) ? sponsorIdFromNewebpayPeriodMtn(mtn) : 0;
  const sp = id
    ? (db.prepare("SELECT id,amount FROM sponsorships WHERE id=?").get(id) as { id: number; amount: number } | undefined)
    : undefined;

  const url = ok
    ? `${site}/support/thanks?mode=monthly&pay=paid&amt=${sp?.amount || 0}`
    : `${site}/support/thanks?mode=monthly&pay=failed`;
  return NextResponse.redirect(url, 303);
}
