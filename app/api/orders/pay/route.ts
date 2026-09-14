import { NextRequest, NextResponse } from "next/server";
import db from "@/lib/db";
import { buildCheckoutFields, ecpayEnabled, retryTradeNo, type EcpayMethod } from "@/lib/ecpay";
import { ecpayBackstageAtmOn, takeAtmNumberForOrder } from "@/lib/ecpay-genpay";
import { resetRound } from "@/lib/remind";
import { linepayEnabled } from "@/lib/linepay";
import { rateLimit, clientIp } from "@/lib/ratelimit";
import { reopenFailedOrderForRetry } from "@/lib/payment-sync";
import { isPayMethodOff } from "@/lib/shop";
import { safeEqual } from "@/lib/safe-equal";

/*
 * 待付款訂單的「免重填再付一次」入口：/api/orders/pay?no=<訂單編號>&t=<權杖>&m=<方式>
 *
 * 為什麼需要：綠界對信用卡「只有授權成功才回呼」，刷卡被發卡行擋下時我們什麼都收不到，
 * 訂單就停在待付款。顧客想再試一次只能整張表重填，多數人就這樣走掉了。
 * 提醒信裡放這條連結，點開直接跳金流，資料一個都不用重打。
 *
 * m 沒帶就沿用原本的付款方式；帶了就換一種（提醒信優先推 ATM，成功率最高）。
 * 訂單編號本身可被枚舉，所以一定要比對權杖才放行。
 */
export async function GET(req: NextRequest) {
  const site = (process.env.SITE_URL || "https://www.wensong.tw").replace(/\/$/, "");
  const no = (req.nextUrl.searchParams.get("no") || "").trim();
  const token = req.nextUrl.searchParams.get("t") || "";
  const want = (req.nextUrl.searchParams.get("m") || "").trim();

  const bad = () => NextResponse.redirect(`${site}/orders`, 303);
  if (!rateLimit(`opay:${clientIp(req.headers)}`, 30, 60 * 60 * 1000)) return bad();
  if (!no || !token) return bad();

  const o = db
    .prepare("SELECT id,order_no,token,status,total,pay_method,items FROM orders WHERE order_no=?")
    .get(no) as { id: number; order_no: string; token: string; status: string; total: number; pay_method: string; items: string } | undefined;
  /* 權杖不符一律當作查無此單，不透露訂單是否存在。
     用定時比較：這條連結可以無限次重試，字串比較的時間差夠人把權杖一個字元一個字元試出來 */
  if (!o || !safeEqual(token, o.token)) return bad();
  /*
   * 後台停用的付款方式，這裡也要擋。
   * 老提醒信裡的「再刷一次信用卡」按鈕、或原單本來就是信用卡的「原方式重試」，
   * 都可能指向一個已經被停用的方式；前台清單有濾、這條路先前沒有。
   * 擋下來導去感謝頁的失敗畫面，那裡的救援按鈕只列還開著的方式。
   * 放在訂單復原之前：為一個走不通的方式把已取消的單翻回待付款，只是白鎖一輪庫存。
   */
  if (isPayMethodOff(want || o.pay_method || "信用卡"))
    return NextResponse.redirect(`${site}/shop/thanks?no=${encodeURIComponent(no)}&k=${o.token}&pay=failed`, 303);
  /*
   * 刷卡失敗被取消的訂單，顧客點這條連結就是要再試一次，這時候才把它復原。
   * 庫存在復原的當下重新檢查與扣回：不夠就明講，不能默默扣成負數。
   * 不在失敗當下保留庫存，是因為那會讓每一次刷卡失敗都白鎖一批貨。
   */
  if (o.status === "cancelled") {
    const r = reopenFailedOrderForRetry(o.order_no);
    if (!r.ok)
      return NextResponse.redirect(
        `${site}/shop/thanks?no=${encodeURIComponent(no)}&k=${o.token}&pay=failed&why=${encodeURIComponent(r.reason || "")}`,
        303
      );
    o.status = "pending";
  }
  /* 已付款就沒有再付一次這回事，直接看訂單狀態 */
  if (o.status !== "pending") return NextResponse.redirect(`${site}/shop/thanks?no=${encodeURIComponent(no)}&k=${o.token}`, 303);

  const method = want || o.pay_method || "信用卡";
  /* 客人自己換了付款方式：提醒重算一輪（最多一次） */
  if (want && want !== o.pay_method) resetRound("order", o.id);

  /* LINE Pay 走官方金流的 request 端點（每次都要重新建立付款請求） */
  if (method === "LINE Pay") {
    if (!linepayEnabled()) return NextResponse.redirect(`${site}/shop/thanks?no=${encodeURIComponent(no)}&k=${o.token}&pay=failed`, 303);
    return NextResponse.redirect(`${site}/api/linepay/request?od=${encodeURIComponent(no)}&t=${o.token}`, 303);
  }

  if (!ecpayEnabled()) return NextResponse.redirect(`${site}/shop/thanks?no=${encodeURIComponent(no)}&k=${o.token}&pay=failed`, 303);

  /* ATM 幕後取號（後台開關）：已取過號且沒到期就沿用，否則重取；成功直接回感謝頁看帳號。失敗退回綠界頁 */
  if (method === "ATM 轉帳" && ecpayBackstageAtmOn()) {
    const took = await takeAtmNumberForOrder(o.order_no);
    if (took.ok) return NextResponse.redirect(`${site}/shop/thanks?no=${encodeURIComponent(no)}&k=${o.token}&pay=pending`, 303);
  }

  /* 綠界需要 POST 一整包帶簽章的欄位，GET 轉不過去，
     所以回一張只做自動送出的極簡頁（與贊助的 /support/pay 同一招）。 */
  const ecMethod: EcpayMethod =
    method === "Apple Pay" ? "applepay"
    : method === "ATM 轉帳" ? "atm"
    : method === "多元支付" ? "twqr"
    : "credit";

  let itemName = "問爽的訂單"; /* 品名組不出來時的備援，不寫死某一樣商品 */
  try {
    const items = JSON.parse(o.items || "[]") as { name: string; choice: string | null; qty: number }[];
    if (items.length) itemName = items.map((i) => `${i.name}x${i.qty}`).join("#").slice(0, 400);
  } catch { /* 組不出來就用預設，不要因為品名擋住付款 */ }

  /* 綠界不收重複的 MerchantTradeNo，重試一定要換新號。
     新號寫回 trade_no，對帳回查才知道要去問哪一筆。 */
  const mtn = retryTradeNo(o.order_no);
  db.prepare("UPDATE orders SET trade_no=? WHERE order_no=? AND status='pending'").run(mtn, o.order_no);

  const ec = buildCheckoutFields({
    merchantTradeNo: mtn,
    amount: o.total,
    method: ecMethod,
    itemName,
    clientBackUrl: `${site}/shop/thanks?no=${encodeURIComponent(no)}&k=${o.token}`,
  });

  const inputs = Object.entries(ec.fields)
    .map(([k, v]) => `<input type="hidden" name="${k}" value="${String(v).replace(/"/g, "&quot;")}">`)
    .join("");
  const html = `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>前往付款…</title></head>
<body style="margin:0;background:#EFE3C4;font-family:'Noto Serif TC',serif;color:#3A3226;">
<div style="max-width:420px;margin:0 auto;padding:96px 20px;text-align:center;">
  <p style="font-size:15px;letter-spacing:.1em;">正在前往付款頁，請稍候…</p>
  <form id="f" method="post" action="${ec.action}">${inputs}
    <noscript><button type="submit" style="margin-top:16px;padding:12px 28px;font-size:15px;">按這裡繼續</button></noscript>
  </form>
</div>
<script>document.getElementById('f').submit();</script>
</body></html>`;
  return new NextResponse(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}
