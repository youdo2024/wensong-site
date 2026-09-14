import { NextRequest, NextResponse } from "next/server";
import db from "@/lib/db";
import { verifyEcpayCallback, ecpayConfig, orderNoFromMtn } from "@/lib/ecpay";
import { sendSponsorAtmMail } from "@/lib/mail";
import { applyEcpayOrderAtmInfo } from "@/lib/payment-sync";
import { sponsorByTradeNo } from "@/lib/sponsor-trade-no";

/*
 * 綠界 ATM 取號結果通知（RtnCode=2 為取號成功）。
 * 存虛擬帳號與期限，寄轉帳資訊給贊助者；實際入帳後綠界另打 /api/ecpay/return。
 */
export async function POST(req: NextRequest) {
  const body = Object.fromEntries(new URLSearchParams(await req.text())) as Record<string, string>;
  /* 未設正式金鑰時一律拒絕：避免退回公開測試金鑰而被偽造通知 */
  if (!ecpayConfig().live) return new NextResponse("0|not live", { status: 400 });
  if (!verifyEcpayCallback(body)) {
    console.error("[ecpay atm] 驗簽失敗", body.MerchantTradeNo);
    return new NextResponse("0|CheckMacValue Error", { status: 400 });
  }

  const mtn = body.MerchantTradeNo || "";

  /* 商店訂單的取號：把繳費資訊寫進訂單並寄 ATM 通知信。
     applyEcpayOrderAtmInfo 內含「尚未寫過虛擬帳號」的條件，綠界重送不會重寄信。 */
  if (mtn.startsWith("YD")) {
    if (body.RtnCode === "2" && body.vAccount) {
      applyEcpayOrderAtmInfo(orderNoFromMtn(mtn), body.BankCode || "", body.vAccount || "", body.ExpireDate || "");
    }
    return new NextResponse("1|OK");
  }

  /*
   * 一樣先精準比對、對不到才查單號歷史（lib/sponsor-trade-no）。
   * 這裡查歷史只是為了「認得出這是誰的舊取號通知」，好留一行日誌，不是為了寫資料。
   */
  const hit = sponsorByTradeNo(mtn);
  if (!hit) return new NextResponse("1|OK");
  /*
   * 舊單號的取號通知不寫任何東西，維持以前的行為（以前根本比對不到，就是什麼都沒做）。
   * 為什麼刻意不寫：客人已經換過付款方式了，這是他放棄的那一組帳號。
   * 把它的銀行代碼與帳號寫回去、再寄一封繳費信，等於催他去轉一組不該再用的帳號。
   * 錢真的從舊帳號進來時會走 /api/ecpay/return，那裡才有完整的入帳與通知。
   */
  if (hit.stale) {
    console.log("[ecpay atm] 舊單號的取號通知，忽略", mtn, "贊助", hit.id);
    return new NextResponse("1|OK");
  }
  const sp = db
    .prepare("SELECT id,mode,amount,display_name,email,COALESCE(pay_token,'') pay_token FROM sponsorships WHERE id=?")
    .get(hit.id) as { id: number; mode: string; amount: number; display_name: string; email: string; pay_token: string } | undefined;
  if (!sp) return new NextResponse("1|OK");

  if (body.RtnCode === "2" && body.vAccount) {
    /* 綠界會重送取號通知。加上「尚未寫過虛擬帳號」的條件，
       重送時 changes 會是 0，就不會再寄一次繳費信。 */
    db.prepare("UPDATE sponsorships SET atm_bank=?, atm_vaccount=?, atm_expire=?, last_charge_note=? WHERE id=? AND COALESCE(atm_vaccount,'')=''").run(
      body.BankCode || "",
      body.vAccount || "",
      body.ExpireDate || "",
      `ATM 已取號，繳費期限 ${body.ExpireDate || ""}`,
      sp.id
    );
    void sendSponsorAtmMail({
      id: sp.id,
      amount: sp.amount,
      display_name: sp.display_name,
      email: sp.email,
      bank: body.BankCode || "",
      vaccount: body.vAccount || "",
      expire: body.ExpireDate || "",
      token: sp.pay_token,
      mode: sp.mode,
    });
  }
  return new NextResponse("1|OK");
}
