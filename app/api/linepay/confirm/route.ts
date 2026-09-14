import { NextRequest, NextResponse } from "next/server";
import db from "@/lib/db";
import { linepayConfirm, linepayQueryByOrderId } from "@/lib/linepay";
import { invoiceForSponsorship } from "@/lib/amego";
import { sendSponsorThanksMail } from "@/lib/mail";
import { notifySponsorship } from "@/lib/notify";
import { notifySponsorLine } from "@/lib/sponsor-settle";
import { gaServerEvent } from "@/lib/ga";
import { applyEcpayOrderResult } from "@/lib/payment-sync";

/* 使用者在 LINE 完成授權後回來這裡請款；成功即開發票、寄感謝信。
   sp＝贊助、od＝商店訂單。 */
export async function GET(req: NextRequest) {
  const spId = Number(req.nextUrl.searchParams.get("sp"));
  const orderNo = req.nextUrl.searchParams.get("od") || "";
  const token = req.nextUrl.searchParams.get("t") || "";
  const transactionId = req.nextUrl.searchParams.get("transactionId") || "";
  const site = (process.env.SITE_URL || "https://www.wensong.tw").replace(/\/$/, "");

  /* ── 商店訂單 ── */
  if (orderNo) {
    const od = db
      .prepare("SELECT order_no,token,status,total,trade_no FROM orders WHERE order_no=?")
      .get(orderNo) as { order_no: string; token: string; status: string; total: number; trade_no: string } | undefined;
    const thanks = (extra: string) => `${site}/shop/thanks?no=${encodeURIComponent(orderNo)}&k=${od?.token || ""}${extra}`;
    if (!od || !token || token !== od.token) return NextResponse.redirect(`${site}/cart?error=1`);
    if (od.status === "paid") return NextResponse.redirect(thanks(""));
    if (!transactionId) return NextResponse.redirect(thanks("&pay=failed"));

    /* 請款失敗不等於沒扣款：連線出錯先回查，查得到就照成功走（同贊助那條的教訓） */
    let r: { ok: boolean; msg: string };
    try {
      r = await linepayConfirm(transactionId, od.total);
    } catch (e) {
      console.error("[linepay confirm] 商店訂單請款呼叫失敗，改回查確認", orderNo, e);
      const q = await linepayQueryByOrderId(od.trade_no || "");
      if (q.found) {
        r = { ok: true, msg: "" };
      } else {
        db.prepare("UPDATE orders SET pay_note=trim(COALESCE(pay_note,'') || ' ' || ?) WHERE order_no=? AND status='pending'")
          .run(`LINE Pay 請款結果未確認（${e instanceof Error ? e.message : "unknown"}），請至 LINE Pay 後台核對`, orderNo);
        return NextResponse.redirect(thanks("&pay=pending"));
      }
    }
    if (!r.ok) {
      /* applyEcpayOrderResult 的失敗分支只動 pending：並發的另一次 confirm 已入帳時不會被蓋掉 */
      const res = applyEcpayOrderResult(orderNo, "failed", `LINEPAY:${transactionId}`, "LINE Pay", `LINE Pay 請款失敗：${r.msg}`);
      return NextResponse.redirect(thanks(res.kind === "order" && res.outcome === "failed" ? "&pay=failed" : ""));
    }
    applyEcpayOrderResult(orderNo, "paid", `LINEPAY:${transactionId}`, "LINE Pay", "LINE Pay 付款成功", od.total);
    return NextResponse.redirect(thanks(""));
  }

  const sp = db
    .prepare("SELECT id,mode,amount,display_name,email,status,pay_token,trade_no,ga_cid,ga_sid,ga_snum FROM sponsorships WHERE id=? AND provider='linepay'")
    .get(spId) as { id: number; mode: string; amount: number; display_name: string; email: string; status: string; pay_token: string; trade_no: string; ga_cid: string; ga_sid: string; ga_snum: string } | undefined;
  if (!sp || !token || token !== sp.pay_token) return NextResponse.redirect(`${site}/support?error=1`);
  if (sp.status === "paid") return NextResponse.redirect(`${site}/support/thanks?mode=once&pay=paid&amt=${sp.amount}&no=${encodeURIComponent(sp.trade_no || `YOL${sp.id}`)}`);
  if (!transactionId) return NextResponse.redirect(`${site}/support/thanks?mode=once&pay=failed&sid=${sp.id}&t=${encodeURIComponent(sp.pay_token)}`);

  /*
   * 請款呼叫一定要包起來。連線逾時或回應無法解析「不等於」沒扣到錢，
   * LINE Pay 那邊可能已經請款成功。原本沒有 try/catch，例外會直接變成 500，
   * 顧客剛在 LINE 授權完就看到錯誤頁，很可能再付一次。
   * 這裡改成先回查確認真實狀態：查到已請款就照常走成功流程，
   * 查不到才讓他停在待付款並留下人工核對的線索。
   */
  let r: { ok: boolean; msg: string };
  try {
    r = await linepayConfirm(transactionId, sp.amount);
  } catch (e) {
    console.error("[linepay confirm] 請款呼叫失敗，改回查確認", sp.trade_no, e);
    const q = await linepayQueryByOrderId(sp.trade_no || "");
    if (q.found) {
      r = { ok: true, msg: "" };
    } else {
      db.prepare("UPDATE sponsorships SET last_charge_note=? WHERE id=? AND status='pending'")
        .run(`LINE Pay 請款結果未確認（${e instanceof Error ? e.message : "unknown"}），請至 LINE Pay 後台核對`, sp.id);
      return NextResponse.redirect(
        `${site}/support/thanks?mode=once&pay=pending&no=${encodeURIComponent(sp.trade_no || `YOL${sp.id}`)}`
      );
    }
  }
  if (!r.ok) {
    /* 條件式更新：並發的另一個 confirm 可能已請款成功寫入 paid，
       這裡的失敗（LINE 回「已請款」）不能把 paid 蓋成 failed */
    const ch = db.prepare("UPDATE sponsorships SET status='failed', last_charge_note=? WHERE id=? AND status='pending'").run(`LINE Pay 請款失敗：${r.msg}`, sp.id);
    const failRescue = ch.changes > 0 ? `&sid=${sp.id}&t=${encodeURIComponent(sp.pay_token)}` : "";
    return NextResponse.redirect(`${site}/support/thanks?mode=once&pay=${ch.changes > 0 ? "failed" : "paid"}&no=${encodeURIComponent(sp.trade_no || `YOL${sp.id}`)}${failRescue}`);
  }
  /* 同樣條件式：兩個並發 confirm 只有一個負責開發票與寄信 */
  const win = db.prepare("UPDATE sponsorships SET status='paid', credit_token=? WHERE id=? AND status='pending'").run(`LINEPAY:${transactionId}`, sp.id);
  if (win.changes === 0) return NextResponse.redirect(`${site}/support/thanks?mode=once&pay=paid&amt=${sp.amount}&no=${encodeURIComponent(sp.trade_no || `YOL${sp.id}`)}`);
  void invoiceForSponsorship(sp.id, sp.trade_no || `YOL${sp.id}`, sp.amount);
  void sendSponsorThanksMail({ id: sp.id, mode: sp.mode, amount: sp.amount, display_name: sp.display_name, email: sp.email });
  void notifySponsorship(sp.id, "once");
  void notifySponsorLine("paid", sp.id).catch((e) => console.error("[line] sponsor paid", e));
  gaServerEvent(sp.ga_cid, "sponsor_complete", { mode: "once", value: sp.amount, currency: "TWD", transaction_id: sp.trade_no || `YOL${sp.id}` }, { sid: sp.ga_sid, snum: sp.ga_snum });
  return NextResponse.redirect(`${site}/support/thanks?mode=once&pay=paid&amt=${sp.amount}&no=${encodeURIComponent(sp.trade_no || `YOL${sp.id}`)}`);
}
