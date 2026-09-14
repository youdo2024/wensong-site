import { NextRequest, NextResponse } from "next/server";
import db from "@/lib/db";
import { linepayEnabled, linepayRequest } from "@/lib/linepay";
import { payItemName } from "@/lib/item-name";
import { rememberSponsorTradeNo } from "@/lib/sponsor-trade-no";

/* 建立 LINE Pay 付款請求並跳轉到 LINE 授權頁。
   sp＝贊助、od＝商店訂單，兩邊共用同一組 LINE Pay 商家金鑰。 */
export async function GET(req: NextRequest) {
  const spId = Number(req.nextUrl.searchParams.get("sp"));
  const orderNo = req.nextUrl.searchParams.get("od") || "";
  const token = req.nextUrl.searchParams.get("t") || "";
  const site = (process.env.SITE_URL || "https://www.wensong.tw").replace(/\/$/, "");

  /* ── 商店訂單 ── */
  if (orderNo) {
    if (!linepayEnabled()) return NextResponse.redirect(`${site}/cart?error=1`);
    const od = db
      .prepare("SELECT order_no,token,status,total,items FROM orders WHERE order_no=?")
      .get(orderNo) as { order_no: string; token: string; status: string; total: number; items: string } | undefined;
    if (!od || od.status !== "pending" || !token || token !== od.token)
      return NextResponse.redirect(`${site}/cart?error=1`);

    /* LINE Pay 的 orderId 必須唯一，重試要換新號；被換掉的寫進備註供對帳 */
    const lpOrderId = `${od.order_no}L${Date.now().toString(36).toUpperCase()}`;
    const prev = (db.prepare("SELECT trade_no FROM orders WHERE order_no=?").get(od.order_no) as { trade_no: string } | undefined)?.trade_no;
    if (prev && prev !== lpOrderId) {
      db.prepare("UPDATE orders SET trade_no=?, pay_note=trim(COALESCE(pay_note,'') || ' ' || ?) WHERE order_no=?")
        .run(lpOrderId, `（前次 LINE Pay 單號 ${prev}，對帳查無新單號時請一併查這組）`, od.order_no);
    } else {
      db.prepare("UPDATE orders SET trade_no=? WHERE order_no=?").run(lpOrderId, od.order_no);
    }

    /* 商品名稱顯示在 LINE 的付款確認畫面，讓顧客知道自己在付什麼 */
    let prodName = "問爽的 商店訂單";
    try {
      const items = JSON.parse(od.items || "[]") as { name: string; qty: number }[];
      if (items.length) prodName = items.map((i) => `${i.name}x${i.qty}`).join("、").slice(0, 40);
    } catch { /* 名稱組不出來就用預設 */ }

    const r = await linepayRequest({
      orderId: lpOrderId,
      amount: od.total,
      productName: prodName,
      confirmUrl: `${site}/api/linepay/confirm?od=${encodeURIComponent(od.order_no)}&t=${od.token}`,
      cancelUrl: `${site}/shop/thanks?no=${encodeURIComponent(od.order_no)}&k=${od.token}&pay=failed`,
    });
    if (!r.ok || !r.paymentUrl) {
      db.prepare("UPDATE orders SET pay_note=trim(COALESCE(pay_note,'') || ' ' || ?) WHERE order_no=? AND status='pending'")
        .run(`LINE Pay 建立失敗：${r.msg}`, od.order_no);
      return NextResponse.redirect(`${site}/shop/thanks?no=${encodeURIComponent(od.order_no)}&k=${od.token}&pay=failed`);
    }
    if (r.transactionId) {
      db.prepare("UPDATE orders SET pay_note=trim(COALESCE(pay_note,'') || ' ' || ?) WHERE order_no=?")
        .run(`LINEPAYREQ:${r.transactionId}`, od.order_no);
    }
    return NextResponse.redirect(r.paymentUrl);
  }

  if (!linepayEnabled()) return NextResponse.redirect(`${site}/support?error=1`);
  const sp = db
    .prepare("SELECT id,amount,status,pay_token FROM sponsorships WHERE id=? AND provider='linepay'")
    .get(spId) as { id: number; amount: number; status: string; pay_token: string } | undefined;
  if (!sp || sp.status !== "pending" || !token || token !== sp.pay_token)
    return NextResponse.redirect(`${site}/support?error=1`);

  /*
   * 每次進來都會產生新的 orderId 並覆寫 trade_no（LINE Pay 的 orderId 必須唯一）。
   * 但對帳只拿最新的 trade_no 去查，顧客若用前一個連結完成付款，那筆錢就查不到，
   * 訂單會被判成未付款。orderId 只有一欄存不下歷史，所以至少把被換掉的那組
   * 寫進備註，人工對帳時查得到。
   */
  const orderId = `YOL${sp.id}T${Date.now().toString(36).toUpperCase()}`;
  const prev = (db.prepare("SELECT trade_no FROM sponsorships WHERE id=?").get(sp.id) as { trade_no: string } | undefined)?.trade_no;
  /* 備註那一行留著給人看；真正能被程式比對回來的是 sponsor_trade_nos 這張歷史表。
     舊的那組也一起補記：這筆贊助先前可能走過綠界，那組虛擬帳號到現在都還收得到錢。 */
  db.transaction(() => {
    if (prev && prev !== orderId) {
      db.prepare("UPDATE sponsorships SET trade_no=?, last_charge_note=trim(COALESCE(last_charge_note,'') || ' ' || ?) WHERE id=?")
        .run(orderId, `（前次 LINE Pay 單號 ${prev}，對帳查無新單號時請一併查這組）`, sp.id);
      rememberSponsorTradeNo(sp.id, prev);
    } else {
      db.prepare("UPDATE sponsorships SET trade_no=? WHERE id=?").run(orderId, sp.id);
    }
    rememberSponsorTradeNo(sp.id, orderId);
  })();

  const r = await linepayRequest({
    orderId,
    amount: sp.amount,
    productName: payItemName("once"),
    confirmUrl: `${site}/api/linepay/confirm?sp=${sp.id}&t=${sp.pay_token}`,
    cancelUrl: `${site}/support?mode=once`,
  });
  if (!r.ok || !r.paymentUrl) {
    db.prepare("UPDATE sponsorships SET status='failed', last_charge_note=? WHERE id=? AND status='pending'").run(`LINE Pay 建立失敗：${r.msg}`, sp.id);
    return NextResponse.redirect(`${site}/support?error=1`);
  }
  /* 存下交易編號：顧客在 LINE 授權完卻沒導回我們網站時，對帳才有依據補請款。
     請款成功後這欄會被 confirm 覆寫成 LINEPAY:<id> */
  if (r.transactionId) {
    db.prepare("UPDATE sponsorships SET credit_token=? WHERE id=?").run(`LINEPAYREQ:${r.transactionId}`, sp.id);
  }
  return NextResponse.redirect(r.paymentUrl);
}
