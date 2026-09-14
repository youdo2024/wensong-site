import { NextRequest, NextResponse } from "next/server";
import db from "@/lib/db";
import { verifyEcpayCallback, ecpayConfig } from "@/lib/ecpay";
import { invoiceForSponsorship } from "@/lib/amego";
import { sendSponsorChargedMail, sendSponsorThanksMail } from "@/lib/mail";
import { notifySponsorship } from "@/lib/notify";
import { onMonthlyChargeFailed, onMonthlyChargeOk } from "@/lib/remind";
import { gaServerEvent } from "@/lib/ga";
import { sponsorByTradeNo, staleSponsorPaymentAction } from "@/lib/sponsor-trade-no";
import { notifySponsorStaleTradeNo } from "@/lib/notify";

/*
 * 綠界定期定額每期授權結果通知。
 * 第 2 期起：記一筆扣款 → 開當期發票 → 寄扣款通知信。
 *
 * 首期（TotalSuccessTimes<=1）原本寫死「交給 /api/ecpay/return 處理」而直接忽略，
 * 但綠界對定期定額不保證會打 ReturnURL——只要它把首期結果送到這裡，
 * 紀錄就會永遠停在待付款：卡其實授權成功、之後每月照扣，
 * 但發票沒開、感謝信沒寄、後台顯示未付款。
 * 改成兩條路都能收首期，用條件式 UPDATE 搶佔，只有先到的那一邊會做後續動作。
 */
export async function POST(req: NextRequest) {
  const body = Object.fromEntries(new URLSearchParams(await req.text())) as Record<string, string>;
  /* 未設正式金鑰時一律拒絕：避免退回公開測試金鑰而被偽造通知 */
  if (!ecpayConfig().live) return new NextResponse("0|not live", { status: 400 });
  if (!verifyEcpayCallback(body)) {
    console.error("[ecpay period] 驗簽失敗", body.MerchantTradeNo);
    return new NextResponse("0|CheckMacValue Error", { status: 400 });
  }

  const mtn = body.MerchantTradeNo || "";
  const times = Number(body.TotalSuccessTimes || 0);
  const amount = Number(body.amount || body.Amount || 0);
  /*
   * 這支也接單號歷史，而且理由比單筆更硬：
   * 定期定額的每一期通知，綠界從頭到尾都用「當初委託成立的那組 MerchantTradeNo」。
   * 客人只要在授權成功後又進過一次付款頁（trade_no 就被重生覆寫），
   * 之後每個月的扣款通知帶的都是舊單號，全部比對不到：
   * 卡照扣、發票沒開、扣款紀錄一筆都沒有、後台看起來像沒在收錢。
   *
   * 為什麼這裡用歷史比對是明確安全的：單號本身帶著贊助編號（YO<id>T…），
   * 同一串嘗試的所有單號都指向同一筆贊助，不會認錯人；
   * mode='monthly' 的限制照舊留著，定期定額的通知不會掉到單筆贊助上。
   */
  const hit = sponsorByTradeNo(mtn, { monthly: true });
  if (!hit) return new NextResponse("1|OK");
  const sp = db
    .prepare("SELECT id,amount,display_name,email,ga_cid,ga_sid,ga_snum,status FROM sponsorships WHERE id=?")
    .get(hit.id) as { id: number; amount: number; display_name: string; email: string; ga_cid: string; ga_sid: string; ga_snum: string; status: string } | undefined;
  if (!sp) return new NextResponse("1|OK");

  const now = new Date().toISOString();
  if (body.RtnCode === "1") {
    /* ── 首期授權 ── */
    if (times <= 1) {
      /*
       * 首期是「錢第一次進來」。已經 active／paid 的絕對不能再入帳一次
       * （重複開發票、重複道謝），下面那道條件式 UPDATE 本來就擋著，這裡不另外開路。
       */
      const already = staleSponsorPaymentAction(sp.status) === "duplicate";
      /* 只有把 pending 搶成 active 的那一邊負責開發票與寄信；
         /api/ecpay/return 先到就換它做，這裡直接回 OK 不重複 */
      const win = db
        .prepare("UPDATE sponsorships SET status='active', last_charge_note=? WHERE id=? AND status='pending'")
        .run(`首期授權成功 ${now.slice(0, 10)}`, sp.id);
      /*
       * 舊單號進來的首期才通知站長，而且只有「這一邊真的入帳成功」才寄。
       * 為什麼要這個條件：首期通知會同時打 ReturnURL 與這裡，兩邊搶同一筆。
       * 沒搶到的那一邊看到的狀態已經是 active，如果照狀態判就會寄出一封
       * 「重複付款、請退款」的假警報，而錢其實只收了一次。
       * 真的搶輸給「同一筆已經付過款的贊助」時，該通知的是先到的那一邊（/api/ecpay/return），
       * 它自己會寄，這裡保持安靜。
       */
      if (hit.stale && win.changes > 0) {
        void notifySponsorStaleTradeNo({
          spId: sp.id, mtn, amount: amount || sp.amount, duplicate: false, status: sp.status,
        }).catch((e) => console.error("[ecpay period] 舊單號通知", sp.id, e));
      } else if (hit.stale && already) {
        console.error("[ecpay period] 舊單號的首期通知，但這筆已經收過款", mtn, "贊助", sp.id, sp.status);
      }
      if (win.changes === 0) return new NextResponse("1|OK");
      const c = db
        .prepare("INSERT INTO sponsor_charges (sponsorship_id,mer_trade_no,trade_no,amount,status,note,created_at) VALUES (?,?,?,?,?,?,?)")
        .run(sp.id, mtn, body.Gwsr || body.gwsr || "", amount || sp.amount, "paid", "定期定額第 1 期", now);
      void invoiceForSponsorship(sp.id, `${mtn}-1`, amount || sp.amount, Number(c.lastInsertRowid));
      void sendSponsorThanksMail({ id: sp.id, mode: "monthly", amount: sp.amount, display_name: sp.display_name, email: sp.email });
      void notifySponsorship(sp.id, "monthly-first");
      gaServerEvent(sp.ga_cid, "sponsor_complete", { mode: "monthly", value: sp.amount, currency: "TWD", transaction_id: mtn }, { sid: sp.ga_sid, snum: sp.ga_snum });
      return new NextResponse("1|OK");
    }
    /* 第 2 期起走到這裡：舊單號是常態不是意外（委託成立之後客人只要再進過一次付款頁，
       trade_no 就被覆寫，而綠界往後每個月都還是用當初那組單號）。
       這種每月都會發生的事不寄信，寄了只會變成每月一封警報；留一行日誌就夠。 */
    if (hit.stale) console.log("[ecpay period] 舊單號的續期通知，照常入帳", mtn, "贊助", sp.id, "第", times, "期");
    /* 同一期重送不重複入帳 */
    const dup = db
      .prepare("SELECT COUNT(*) AS n FROM sponsor_charges WHERE sponsorship_id=? AND note=?")
      .get(sp.id, `定期定額第 ${times} 期`) as { n: number };
    if (dup.n > 0) return new NextResponse("1|OK");
    const c = db
      .prepare("INSERT INTO sponsor_charges (sponsorship_id,mer_trade_no,trade_no,amount,status,note,created_at) VALUES (?,?,?,?,?,?,?)")
      .run(sp.id, mtn, body.Gwsr || body.gwsr || "", amount || sp.amount, "paid", `定期定額第 ${times} 期`, now);
    db.prepare("UPDATE sponsorships SET last_charge_note=? WHERE id=?").run(`最近一次扣款成功 ${now.slice(0, 10)}（第 ${times} 期）`, sp.id);
    void invoiceForSponsorship(sp.id, `${mtn}-${times}`, amount || sp.amount, Number(c.lastInsertRowid));
    onMonthlyChargeOk(sp.id);
    void sendSponsorChargedMail({ id: sp.id, amount: amount || sp.amount, display_name: sp.display_name, email: sp.email });
    void notifySponsorship(sp.id, "monthly-charge", amount || sp.amount);
    gaServerEvent(sp.ga_cid, "sponsor_complete", { mode: "monthly_charge", value: amount || sp.amount, currency: "TWD", transaction_id: `${mtn}-${times}` }, { sid: sp.ga_sid, snum: sp.ga_snum });
  } else {
    db.prepare("UPDATE sponsorships SET last_charge_note=? WHERE id=?").run(`本期扣款失敗（${body.RtnCode} ${body.RtnMsg || ""}），綠界將自動重試`, sp.id);
    /* 通知整合：第一次失敗通知客人，連續兩次暫停並通知（docs/notify-spec.md 第五章） */
    void onMonthlyChargeFailed(sp.id).catch((e) => console.error("[period] 扣款失敗通知", sp.id, e));
  }
  return new NextResponse("1|OK");
}
