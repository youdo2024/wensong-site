import { NextRequest, NextResponse } from "next/server";
import { ecpayConfig } from "@/lib/ecpay";
import { genpayDecrypt, orderNoFromGenpayMtn, sponsorIdFromGenpayMtn } from "@/lib/ecpay-genpay";
import { settleSponsorOncePaid } from "@/lib/sponsor-settle";
import { applyEcpayOrderResult } from "@/lib/payment-sync";

/*
 * 綠界幕後取號的付款結果通知（文件 28010）：JSON POST，Data 用我們的 HashKey/HashIV 加密。
 * 解得開就是綠界打的（別人沒有金鑰）；再對一次 MerchantID。RtnCode 1 才入帳。
 * 一定要回純文字 1|OK，否則綠界每 5 到 15 分鐘重送、一天四次。
 */
export async function POST(req: NextRequest) {
  const cfg = ecpayConfig();
  if (!cfg.live) return new NextResponse("0|not live", { status: 400 });
  let body: { MerchantID?: string; TransCode?: number; Data?: string } = {};
  try { body = (await req.json()) as typeof body; } catch { return new NextResponse("0|bad json", { status: 400 }); }
  if (!body.Data) return new NextResponse("0|no data", { status: 400 });
  let d: { RtnCode?: number; RtnMsg?: string; MerchantID?: string; OrderInfo?: { MerchantTradeNo?: string; TradeNo?: string; TradeAmt?: number; PaymentType?: string; PaymentDate?: string } };
  try { d = genpayDecrypt(body.Data, cfg.hashKey, cfg.hashIV); } catch (e) {
    console.error("[genpay return] 解密失敗", e);
    return new NextResponse("0|decrypt", { status: 400 });
  }
  if (String(d.MerchantID || body.MerchantID || "") !== cfg.merchantId) return new NextResponse("0|merchant", { status: 400 });
  const mtn = d.OrderInfo?.MerchantTradeNo || "";
  if (!mtn || mtn.startsWith("PROBE")) return new NextResponse("1|OK");
  if (d.RtnCode !== 1) {
    /* 非 1 不是付款成功，文件明說不可出貨；記下來就好，訂單維持待付款等到期 */
    console.warn("[genpay return] RtnCode", d.RtnCode, d.RtnMsg, mtn);
    return new NextResponse("1|OK");
  }
  /* 贊助（YO 前綴）與商店訂單（YD／YG）靠前綴分流 */
  const spId = sponsorIdFromGenpayMtn(mtn);
  if (spId) {
    settleSponsorOncePaid(spId, mtn, "");
    return new NextResponse("1|OK");
  }
  applyEcpayOrderResult(orderNoFromGenpayMtn(mtn), "paid", d.OrderInfo?.TradeNo || "", "ATM 轉帳", "綠界付款成功（ATM 幕後取號）", Number(d.OrderInfo?.TradeAmt) || undefined);
  return new NextResponse("1|OK");
}
