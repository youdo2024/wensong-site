import { NextRequest, NextResponse } from "next/server";
import { rateLimit, clientIp } from "@/lib/ratelimit";
import { applePayOnsiteEnabled } from "@/lib/shop";
import { buildMerchantSessionRequest } from "@/lib/newebpay-applepay";
import { BRAND } from "@/lib/brand";

/*
 * Apple Pay JS 的 onvalidatemerchant 打這支：前端把瀏覽器給的 validationURL 轉送過來，
 * 本站再轉打藍新的 Apple Pay 幕後 API 換回 Apple 要的 merchant session JSON，
 * 原封不動回給前端餵給 session.completeMerchantValidation()。
 *
 * 藍新目前沒有公開這支 API 的技術文件（見 lib/newebpay-applepay.ts 開頭的查證說明），
 * 所以 buildMerchantSessionRequest() 一律回「未取得技術文件」，這裡對應回 501，
 * 前端（components/ApplePayButton.tsx）收到後會 abort 這次 Apple Pay 流程並顯示訊息，
 * 讓客人改選其他付款方式，不會卡在「按下去沒反應」。
 */
export async function POST(req: NextRequest) {
  if (!rateLimit(`applepay-session:${clientIp(req.headers)}`, 30, 60 * 60 * 1000))
    return NextResponse.json({ error: "操作太頻繁，請稍後再試" }, { status: 429 });
  if (!applePayOnsiteEnabled()) return NextResponse.json({ error: "Apple Pay 尚未開放" }, { status: 501 });

  const body = (await req.json().catch(() => null)) as { validationURL?: string } | null;
  if (!body?.validationURL) return NextResponse.json({ error: "格式錯誤" }, { status: 400 });

  const site = (process.env.SITE_URL || "https://www.wensong.tw").replace(/\/$/, "");
  const domain = site.replace(/^https?:\/\//, "");
  const r = await buildMerchantSessionRequest({
    validationURL: body.validationURL,
    domainName: domain,
    displayName: BRAND.fullName,
  });
  if (!r.ok) return NextResponse.json({ error: "Apple Pay 尚未開放（尚未取得藍新技術文件）", reason: r.reason }, { status: 501 });
  return NextResponse.json(r.session);
}
