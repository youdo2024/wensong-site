import { NextRequest, NextResponse } from "next/server";
import {
  newebpayEnabled, parseNotify, newebpayPayLabel,
  isNewebpayOrderMtn, orderNoFromNewebpayMtn,
  isNewebpaySponsorMtn, sponsorIdFromNewebpayMtn,
} from "@/lib/newebpay";
import {
  applyNewebpayOrderResult, applyNewebpayOrderAtmInfo,
  applyNewebpaySponsorResult, applyNewebpaySponsorAtmInfo,
} from "@/lib/payment-sync";

/*
 * 藍新背景通知（NotifyURL）。商店訂單（WO 前綴）與贊助（WS 前綴）共用同一支，靠編號分流。
 *
 * 藍新只認 HTTP 200，回別的狀態碼會被當成失敗而一路重送轟炸，所以任何情況
 * （未設金鑰、驗簽失敗、查無此單）一律回 200 純文字，錯誤只寫進 log 不對外洩漏。
 *
 * ATM 取號成功但尚未真的付款時 Status 也是 SUCCESS，只是 PayTime 是空字串；
 * 真正入帳的那次通知 PayTime 才有值。同一筆可能因為「先取號、後入帳」被通知兩次，
 * 底下兩支 applyNewebpay*AtmInfo／applyNewebpay*Result 都有各自的條件式 UPDATE 守門，
 * 重複呼叫是安全的（冪等）。
 */
export async function POST(req: NextRequest) {
  const OK = () => new NextResponse("OK");
  if (!newebpayEnabled()) return OK();

  const body = Object.fromEntries(new URLSearchParams(await req.text())) as Record<string, string>;
  const r = parseNotify(body);
  if (!r) {
    console.error("[newebpay notify] 驗簽或解密失敗");
    return OK();
  }
  const mtn = r.merchantOrderNo;
  const label = newebpayPayLabel(r.paymentType);

  if (isNewebpayOrderMtn(mtn)) {
    const orderNo = orderNoFromNewebpayMtn(mtn);
    if (r.ok && r.payTime) {
      applyNewebpayOrderResult(orderNo, "paid", r.tradeNo, label, `藍新付款成功（${label}）`, r.amt || undefined);
    } else if (r.ok && r.atm) {
      applyNewebpayOrderAtmInfo(orderNo, r.atm.bankCode, r.atm.codeNo, r.atm.expireDate);
    } else if (!r.ok) {
      applyNewebpayOrderResult(orderNo, "failed", r.tradeNo, label, `付款未完成（${r.status} ${r.message}）`.trim());
    }
    return OK();
  }

  if (isNewebpaySponsorMtn(mtn)) {
    const id = sponsorIdFromNewebpayMtn(mtn);
    if (!id) return OK();
    if (r.ok && r.payTime) {
      applyNewebpaySponsorResult(id, "paid", r.tradeNo, `藍新付款成功（${label}）`, r.amt || undefined);
    } else if (r.ok && r.atm) {
      applyNewebpaySponsorAtmInfo(id, r.atm.bankCode, r.atm.codeNo, r.atm.expireDate);
    } else if (!r.ok) {
      applyNewebpaySponsorResult(id, "failed", r.tradeNo, `付款未完成（${r.status} ${r.message}）`.trim());
    }
    return OK();
  }

  return OK();
}
