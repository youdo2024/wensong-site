import { NextRequest, NextResponse } from "next/server";
import db from "@/lib/db";
import { memberSiteUrl } from "@/lib/member";
import { BIND_COOKIE, makeBindCookie } from "@/lib/line-bind";
import { lineNotifyOn } from "@/lib/line";

/*
 * 綁定入口：/line/bind?no=訂單編號&t=訂單權杖（&src=thanks|mail|sms）
 * 贊助：/line/bind?sp=贊助編號&t=付款權杖（&src=sponsor），cookie 裡的 orderNo 寫成 SP:編號
 * 驗過權杖後把「這次登入是為了綁哪張訂單」放進短效 cookie，轉去 LINE 登入（順便加好友），
 * 回呼那邊讀 cookie 完成綁定。客人只按兩下，不打字。
 * 權杖一定要驗：訂單編號可枚舉，不驗的話任何人都能把別人的訂單綁到自己的 LINE。
 */
export async function GET(req: NextRequest) {
  const site = memberSiteUrl();
  const no = (req.nextUrl.searchParams.get("no") || "").trim();
  const t = req.nextUrl.searchParams.get("t") || "";
  const src = (req.nextUrl.searchParams.get("src") || "thanks").replace(/[^a-z_]/g, "").slice(0, 20) || "thanks";
  const spId = Number(req.nextUrl.searchParams.get("sp") || 0) || 0;
  if (spId) {
    const sp = db.prepare("SELECT id,mode,pay_token FROM sponsorships WHERE id=?").get(spId) as { id: number; mode: string; pay_token: string } | undefined;
    if (!sp || !sp.pay_token || t !== sp.pay_token) return NextResponse.redirect(`${site}/support`, 303);
    const thanks = `${site}/support/thanks?mode=${sp.mode}&pay=paid&sid=${sp.id}&t=${encodeURIComponent(sp.pay_token)}`;
    if (!lineNotifyOn()) return NextResponse.redirect(thanks, 303);
    const res = NextResponse.redirect(`${site}/api/auth/line?bind=1`, 303);
    res.cookies.set(BIND_COOKIE, makeBindCookie(`SP:${sp.id}`, sp.pay_token, src), {
      httpOnly: true, sameSite: "lax", path: "/", maxAge: 600, secure: process.env.NODE_ENV === "production",
    });
    return res;
  }
  const o = no
    ? (db.prepare("SELECT order_no,token FROM orders WHERE order_no=?").get(no) as { order_no: string; token: string } | undefined)
    : undefined;
  /* 總開關關著：舊信裡的按鈕點進來也不綁，回感謝頁 */
  if (!o || !o.token || t !== o.token) return NextResponse.redirect(`${site}/orders`, 303);
  if (!lineNotifyOn()) return NextResponse.redirect(`${site}/shop/thanks?no=${encodeURIComponent(o.order_no)}&k=${encodeURIComponent(o.token)}`, 303);

  const res = NextResponse.redirect(`${site}/api/auth/line?bind=1`, 303);
  res.cookies.set(BIND_COOKIE, makeBindCookie(o.order_no, o.token, src), {
    httpOnly: true, sameSite: "lax", path: "/", maxAge: 600, secure: process.env.NODE_ENV === "production",
  });
  return res;
}
