import { NextRequest, NextResponse } from "next/server";
import db from "@/lib/db";
import { rateLimit, clientIp } from "@/lib/ratelimit";
import { safeEqual } from "@/lib/safe-equal";
import { applePayOnsiteEnabled } from "@/lib/shop";
import { chargeApplePay } from "@/lib/newebpay-applepay";
import { applyNewebpayOrderResult, applyNewebpaySponsorResult } from "@/lib/payment-sync";

/*
 * Apple Pay JS 的 onpaymentauthorized 打這支：帶著訂單／贊助的身分（先由原本的表單／
 * /api/orders 建立成 pending，拿到 id 與權杖）與 Apple 給的付款 token，本站驗過權杖後
 * 呼叫 chargeApplePay() 送藍新扣款，成功就走既有的 applyNewebpayOrderResult／
 * applyNewebpaySponsorResult（狀態、通知、發票都沿用 NotifyURL 那條路的實作，不另外
 * 寫一套）。
 *
 * 藍新目前沒有公開扣款 API 的技術文件（見 lib/newebpay-applepay.ts 開頭的查證說明），
 * chargeApplePay() 一律回「未取得技術文件」，這裡對應回 501，不會假裝扣款成功、
 * 不會把訂單／贊助標成已付款。
 *
 * 冪等：先看目前狀態，不是 pending 就直接回對應結果，不會對同一筆重複扣款或重複改狀態。
 */
export async function POST(req: NextRequest) {
  if (!rateLimit(`applepay-pay:${clientIp(req.headers)}`, 20, 60 * 60 * 1000))
    return NextResponse.json({ ok: false, error: "操作太頻繁，請稍後再試" }, { status: 429 });
  if (!applePayOnsiteEnabled()) return NextResponse.json({ ok: false, error: "Apple Pay 尚未開放" }, { status: 501 });

  const body = (await req.json().catch(() => null)) as
    | { kind?: "order" | "sponsor"; id?: string; token?: string; paymentToken?: unknown }
    | null;
  if (!body?.kind || !body.id || !body.token || !body.paymentToken)
    return NextResponse.json({ ok: false, error: "格式錯誤" }, { status: 400 });

  if (body.kind === "order") {
    const o = db
      .prepare("SELECT id,order_no,token,status,total,email FROM orders WHERE order_no=?")
      .get(body.id) as { id: number; order_no: string; token: string; status: string; total: number; email: string } | undefined;
    if (!o || !safeEqual(body.token, o.token)) return NextResponse.json({ ok: false, error: "查無此訂單" }, { status: 404 });
    if (o.status !== "pending") {
      const paid = o.status === "paid";
      return NextResponse.json({
        ok: paid,
        redirect: `/shop/thanks?no=${encodeURIComponent(o.order_no)}&k=${o.token}${paid ? "" : "&pay=failed"}`,
      });
    }
    const r = await chargeApplePay({
      kind: "order",
      id: o.order_no,
      amount: o.total,
      email: o.email,
      itemDesc: `訂單 ${o.order_no}`,
      paymentToken: body.paymentToken,
    });
    if (!r.ok) return NextResponse.json({ ok: false, error: "Apple Pay 尚未開放（尚未取得藍新技術文件）", reason: r.reason }, { status: 501 });
    /* 直接傳 r.amt，不要用 `|| undefined`：見 app/api/newebpay/notify/route.ts 的說明，
       0 是異常不是「欄位缺席」，用 || undefined 會讓金額比對被整段跳過 */
    applyNewebpayOrderResult(o.order_no, "paid", r.tradeNo, "信用卡", "藍新 Apple Pay 幕後付款成功", r.amt);
    return NextResponse.json({ ok: true, redirect: `/shop/thanks?no=${encodeURIComponent(o.order_no)}&k=${o.token}` });
  }

  const sp = db
    .prepare("SELECT id,mode,amount,email,pay_token,status FROM sponsorships WHERE id=?")
    .get(Number(body.id) || 0) as
    | { id: number; mode: string; amount: number; email: string; pay_token: string; status: string }
    | undefined;
  if (!sp || !safeEqual(body.token, sp.pay_token)) return NextResponse.json({ ok: false, error: "查無此贊助" }, { status: 404 });
  if (sp.status !== "pending") {
    const paid = sp.status === "paid" || sp.status === "active";
    return NextResponse.json({
      ok: paid,
      redirect: `/support/thanks?mode=${sp.mode}${paid ? "" : "&pay=failed"}&sid=${sp.id}&t=${encodeURIComponent(sp.pay_token)}`,
    });
  }
  const r = await chargeApplePay({
    kind: "sponsor",
    id: String(sp.id),
    amount: sp.amount,
    email: sp.email,
    itemDesc: "贊助 問爽的",
    paymentToken: body.paymentToken,
  });
  if (!r.ok) return NextResponse.json({ ok: false, error: "Apple Pay 尚未開放（尚未取得藍新技術文件）", reason: r.reason }, { status: 501 });
  applyNewebpaySponsorResult(sp.id, "paid", r.tradeNo, "藍新 Apple Pay 幕後付款成功", r.amt);
  return NextResponse.json({ ok: true, redirect: `/support/thanks?mode=${sp.mode}&sid=${sp.id}&t=${encodeURIComponent(sp.pay_token)}` });
}
