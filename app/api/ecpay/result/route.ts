import { NextRequest, NextResponse } from "next/server";
import db from "@/lib/db";
import { verifyEcpayCallback, ecpayConfig, orderNoFromMtn } from "@/lib/ecpay";
import { sponsorByTradeNo } from "@/lib/sponsor-trade-no";

/*
 * 綠界付款完成後把顧客的瀏覽器 POST 回這裡（OrderResultURL），
 * 轉成 303 導向感謝頁；成功時帶 mode 與金額，讓 GA 的 sponsor_complete 記到轉換價值。
 * 純導頁用：實際入帳與發票由 /api/ecpay/return（背景通知）處理。
 */
export async function POST(req: NextRequest) {
  const site = (process.env.SITE_URL || "https://www.wensong.tw").replace(/\/$/, "");
  const body = Object.fromEntries(new URLSearchParams(await req.text())) as Record<string, string>;
  /*
   * 先驗簽，再決定要不要查資料。
   * 原本 sp 的查詢完全不受驗簽結果影響，於是驗簽失敗時仍會查出該筆贊助，
   * 並把 pay_token 放進導向網址。任何人只要 POST 一份未簽章的 body、
   * 帶上正確的 MerchantTradeNo，就能換到付款權杖，拿去開啟付款頁或改付款方式。
   * 沒通過驗簽的請求一律視為不可信：不查資料、不帶權杖，只給一個中性的失敗頁。
   */
  const verified = ecpayConfig().live && verifyEcpayCallback(body);
  const ok = verified && body.RtnCode === "1";

  /* 商店訂單走商店的感謝頁。權杖同樣只在驗簽通過時才帶，
     否則任何人 POST 一份未簽章的 body 就能換到別人的訂單權杖。 */
  const mtn = body.MerchantTradeNo || "";
  if (mtn.startsWith("YD")) {
    const orderNo = orderNoFromMtn(mtn);
    const od = verified
      ? (db.prepare("SELECT order_no,token FROM orders WHERE order_no=?").get(orderNo) as { order_no: string; token: string } | undefined)
      : undefined;
    const q = new URLSearchParams({ no: orderNo });
    if (od?.token) q.set("k", od.token);
    if (!ok) q.set("pay", "failed");
    return NextResponse.redirect(`${site}/shop/thanks?${q.toString()}`, 303);
  }

  /*
   * 這支只負責把客人的瀏覽器導到感謝頁，不入帳也不寄信。
   * 一樣接上單號歷史：客人用舊的付款連結付完款導回來時，以前這裡查不到贊助，
   * 感謝頁就沒有金額、沒有救援權杖，人會以為自己付款失敗。
   * 這裡刻意不寄「舊帳號入帳」那封信：錢的事由背景通知 /api/ecpay/return 認定，
   * 瀏覽器導回的封包會被重新整理重送，掛在這裡只會讓站長收到一堆重複警報。
   */
  const spHit = verified ? sponsorByTradeNo(body.MerchantTradeNo || "") : undefined;
  const sp = spHit
    ? (db
        .prepare("SELECT id,mode,amount,pay_token FROM sponsorships WHERE id=?")
        .get(spHit.id) as { id: number; mode: string; amount: number; pay_token: string } | undefined)
    : undefined;
  const mode = sp?.mode === "monthly" ? "monthly" : "once";
  /* no＝交易編號：感謝頁的 Purchase 像素靠它去重（重新整理不重複計數）。
     失敗時帶 sid+t：感謝頁能給「換個方式重試（免重填）」按鈕（權杖同提醒信機制） */
  const rescue = sp && mode === "once" ? `&sid=${sp.id}&t=${encodeURIComponent(sp.pay_token)}` : "";
  const url = ok
    ? `${site}/support/thanks?mode=${mode}&pay=paid&amt=${sp?.amount || 0}&no=${encodeURIComponent(body.MerchantTradeNo || "")}`
    : `${site}/support/thanks?mode=${mode}&pay=failed${rescue}`;
  return NextResponse.redirect(url, 303);
}
