import { NextRequest, NextResponse } from "next/server";
import { PARTNER_PIN_COOKIE, currentPartner } from "@/lib/partner";
import { rateLimit, clientIp } from "@/lib/ratelimit";
import { cookieSecure } from "@/lib/cookie-secure";

/*
 * 工作台密碼驗證。前提是連結金鑰那關已經過（cookie 在），
 * 密碼只是第二道鎖：連結被轉傳或信箱被翻時，光有連結進不來。
 * cookie 值綁目前金鑰，後台重新產生金鑰時兩關一起失效。
 * 同 IP 每小時 10 次，四位數也夠擋暴力嘗試。
 */
export async function POST(req: NextRequest) {
  const site = (process.env.SITE_URL || "https://www.wensong.tw").replace(/\/$/, "");
  const back = (q: string) => NextResponse.redirect(`${site}/partner${q}`, 303);

  const partner = await currentPartner();
  if (!partner) return back("");
  if (!rateLimit(`ppin:${clientIp(req.headers)}`, 10, 60 * 60 * 1000)) return back("?pin=err");

  const form = await req.formData().catch(() => null);
  const pin = String(form?.get("pin") || "").trim();
  if (!pin || pin !== partner.pin) return back("?pin=err");

  const res = back("");
  /* pin cookie 綁這位夥伴的金鑰：換金鑰時密碼授權一起失效 */
  res.cookies.set(PARTNER_PIN_COOKIE, partner.key, {
    httpOnly: true,
    sameSite: "lax",
    secure: cookieSecure(),
    maxAge: 90 * 24 * 3600,
    path: "/",
  });
  return res;
}
