import { NextRequest, NextResponse } from "next/server";
import db from "@/lib/db";
import { newebpayEnabled } from "@/lib/newebpay";
import { parsePeriodNotify, isNewebpayPeriodMtn, sponsorIdFromNewebpayPeriodMtn } from "@/lib/newebpay-period";
import { settleSponsorOncePaid } from "@/lib/sponsor-settle";
import { invoiceForSponsorship } from "@/lib/amego";
import { sendSponsorChargedMail } from "@/lib/mail";
import { notifySponsorship } from "@/lib/notify";
import { onMonthlyChargeFailed, onMonthlyChargeOk } from "@/lib/remind";
import { addOneMonth } from "@/lib/month";

/*
 * 藍新定期定額背景通知（NotifyURL）。首期授權成功與之後每期扣款都會打這裡，
 * 靠 AlreadyTimes 分辨是哪一種：委託還在 pending，或 AlreadyTimes<=1 都當首期；
 * 其餘是續期扣款。MerOrderNo 本身就帶著贊助 id（WP<id>X…，見 lib/newebpay-period.ts），
 * 不用查表就能還原身分——這裡假設同一份委託之後每期通知都沿用同一組 MerOrderNo
 * （規格沒有明講，但比照綠界定期定額的實際行為，見 docs/newebpay-spec.md 的假設清單）。
 *
 * 藍新只認 HTTP 200，任何情況（未設金鑰、解密失敗、查無此單、不是定期定額編號）
 * 一律回 200 純文字，錯誤只記 log 不對外洩漏。
 */
export async function POST(req: NextRequest) {
  const OK = () => new NextResponse("OK");
  if (!newebpayEnabled()) return OK();

  const body = Object.fromEntries(new URLSearchParams(await req.text())) as Record<string, string>;
  const r = parsePeriodNotify(body);
  if (!r) {
    console.error("[newebpay period notify] 解密失敗");
    return OK();
  }
  if (!isNewebpayPeriodMtn(r.merOrderNo)) return OK();
  const id = sponsorIdFromNewebpayPeriodMtn(r.merOrderNo);
  if (!id) return OK();

  const sp = db
    .prepare("SELECT id,mode,status,amount,display_name,email FROM sponsorships WHERE id=?")
    .get(id) as { id: number; mode: string; status: string; amount: number; display_name: string; email: string } | undefined;
  if (!sp || sp.mode !== "monthly") return OK();

  const now = new Date().toISOString();
  const isFirst = sp.status === "pending" || r.alreadyTimes <= 1;

  /* ── 授權／扣款失敗 ── */
  if (!r.ok) {
    if (isFirst) {
      db.prepare("UPDATE sponsorships SET status='failed', last_charge_note=? WHERE id=? AND status='pending'")
        .run(`首期授權失敗（${r.status} ${r.message}）`.trim(), sp.id);
      return OK();
    }
    /* 續期失敗：藍新自己會重試（不像 PayUni 那條要我方主動發動扣款），這裡只記錄與通知客人 */
    const dup = r.tradeNo
      ? db.prepare("SELECT 1 FROM sponsor_charges WHERE sponsorship_id=? AND trade_no=? AND trade_no<>''").get(sp.id, r.tradeNo)
      : null;
    if (!dup) {
      db.prepare(
        "INSERT INTO sponsor_charges (sponsorship_id,mer_trade_no,trade_no,amount,status,note,created_at) VALUES (?,?,?,?,?,?,?)"
      ).run(sp.id, r.merOrderNo, r.tradeNo, r.amt || sp.amount, "failed", `本期扣款失敗（${r.status} ${r.message})`.trim(), now);
    }
    db.prepare("UPDATE sponsorships SET last_charge_note=? WHERE id=? AND status='active'")
      .run(`本期扣款失敗（${r.status} ${r.message}），藍新將自動重試`.trim(), sp.id);
    void onMonthlyChargeFailed(sp.id).catch((e) => console.error("[newebpay period] 扣款失敗通知", sp.id, e));
    return OK();
  }

  /* ── 首期授權成功：交給既有的贊助入帳唯一實作（開發票、寄感謝信、通知站長、GA 都在裡面） ── */
  if (isFirst) {
    const ok = settleSponsorOncePaid(sp.id, r.tradeNo, `首期授權成功 ${now.slice(0, 10)}`, { gatewayTradeNo: r.tradeNo });
    if (ok) {
      /* credit_token 欄位沿用來存 PeriodNo（解約要靠它），trade_no 換成這一期的 TradeNo；
         provider 這裡再寫一次是保險，正常從 createSponsorship 就已經是 newebpay 了 */
      db.prepare("UPDATE sponsorships SET provider='newebpay', trade_no=?, credit_token=?, next_charge_at=? WHERE id=?")
        .run(r.tradeNo, r.periodNo, addOneMonth(new Date()).toISOString(), sp.id);
    }
    return OK();
  }

  /* ── 續期扣款成功 ── */
  const dup = r.tradeNo
    ? db.prepare("SELECT 1 FROM sponsor_charges WHERE sponsorship_id=? AND trade_no=? AND trade_no<>''").get(sp.id, r.tradeNo)
    : null;
  if (dup) return OK();
  const c = db
    .prepare("INSERT INTO sponsor_charges (sponsorship_id,mer_trade_no,trade_no,amount,status,note,created_at) VALUES (?,?,?,?,?,?,?)")
    .run(sp.id, r.merOrderNo, r.tradeNo, r.amt || sp.amount, "paid", `定期定額第 ${r.alreadyTimes} 期`, now);
  db.prepare("UPDATE sponsorships SET next_charge_at=?, last_charge_note=? WHERE id=? AND status='active'")
    .run(addOneMonth(new Date()).toISOString(), `最近一次扣款成功 ${now.slice(0, 10)}（第 ${r.alreadyTimes} 期）`, sp.id);
  onMonthlyChargeOk(sp.id);
  void invoiceForSponsorship(sp.id, `${r.tradeNo || r.merOrderNo}-${r.alreadyTimes}`, r.amt || sp.amount, Number(c.lastInsertRowid))
    .catch((e) => console.error("[newebpay period] 開發票", sp.id, e));
  void sendSponsorChargedMail({ id: sp.id, amount: r.amt || sp.amount, display_name: sp.display_name, email: sp.email })
    .catch((e) => console.error("[newebpay period] 扣款通知信", sp.id, e));
  void notifySponsorship(sp.id, "monthly-charge", r.amt || sp.amount).catch((e) => console.error("[newebpay period] 站長通知", sp.id, e));
  return OK();
}
