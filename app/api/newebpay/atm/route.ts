import { NextRequest, NextResponse } from "next/server";
import db from "@/lib/db";
import {
  newebpayEnabled, parseNotify,
  isNewebpayOrderMtn, orderNoFromNewebpayMtn,
  isNewebpaySponsorMtn, sponsorIdFromNewebpayMtn,
} from "@/lib/newebpay";
import { applyNewebpayOrderAtmInfo, applyNewebpaySponsorAtmInfo } from "@/lib/payment-sync";

/*
 * 藍新 ATM 取號完成後的瀏覽器跳回（CustomerURL）。這裡才是客人真正看到繳費代碼的地方；
 * 背景通知 /api/newebpay/notify 理論上也會收到同一筆取號資訊，兩邊都呼叫同一個
 * 「尚未寫過虛擬帳號才寫」的函式，先到的那個贏，不會重複寄信（冪等）。
 */
export async function POST(req: NextRequest) {
  const site = (process.env.SITE_URL || "https://www.wensong.tw").replace(/\/$/, "");
  const body = Object.fromEntries(new URLSearchParams(await req.text())) as Record<string, string>;
  const r = newebpayEnabled() ? parseNotify(body) : null;
  const fail = () => NextResponse.redirect(`${site}/shop`, 303);
  if (!r) return fail();
  const mtn = r.merchantOrderNo;

  if (isNewebpayOrderMtn(mtn)) {
    const orderNo = orderNoFromNewebpayMtn(mtn);
    const od = db.prepare("SELECT order_no,token FROM orders WHERE order_no=?").get(orderNo) as
      | { order_no: string; token: string }
      | undefined;
    if (!od) return fail();
    if (r.ok && r.atm) applyNewebpayOrderAtmInfo(orderNo, r.atm.bankCode, r.atm.codeNo, r.atm.expireDate);
    const q = new URLSearchParams({ no: orderNo, k: od.token, pay: r.ok ? "pending" : "failed" });
    return NextResponse.redirect(`${site}/shop/thanks?${q.toString()}`, 303);
  }

  if (isNewebpaySponsorMtn(mtn)) {
    const id = sponsorIdFromNewebpayMtn(mtn);
    const sp = id
      ? (db.prepare("SELECT id,mode,pay_token FROM sponsorships WHERE id=?").get(id) as
          | { id: number; mode: string; pay_token: string }
          | undefined)
      : undefined;
    if (!sp) return fail();
    if (r.ok && r.atm) applyNewebpaySponsorAtmInfo(sp.id, r.atm.bankCode, r.atm.codeNo, r.atm.expireDate);
    const mode = sp.mode === "monthly" ? "monthly" : "once";
    const q = new URLSearchParams({ mode, pay: r.ok ? "pending" : "failed", sid: String(sp.id), t: sp.pay_token });
    return NextResponse.redirect(`${site}/support/thanks?${q.toString()}`, 303);
  }

  return fail();
}
