import { NextRequest, NextResponse } from "next/server";
import db from "@/lib/db";
import { portalyEnabled, verifyPortalyCallback } from "@/lib/portaly";
import { sendSponsorThanksMail, sendSponsorChargedMail } from "@/lib/mail";
import { rememberSponsorTradeNo } from "@/lib/sponsor-trade-no";

/*
 * Portaly Payment 簽名回呼（贊助專用）
 * 事件（x-portaly-event）：
 *  - creator_subscription.checkout.completed  首次結帳完成（單筆與每月的第一期都走這裡）
 *  - creator_subscription.payment.succeeded / .failed  每月續扣結果
 *  - creator_subscription.cancel_requested / .canceled  取消生命週期
 * 冪等：checkout 用 trade_no 是否已寫入判斷；續扣用 sponsor_charges.mer_trade_no 排重
 */

type SponsorRow = { id: number; mode: string; status: string; amount: number; display_name: string; email: string; trade_no: string };

function findSponsorship(payload: Record<string, unknown>): SponsorRow | undefined {
  const orderNo = String(payload.merchantOrderNumber || "");
  const m = orderNo.match(/^SP(\d+)$/);
  let id = m ? Number(m[1]) : 0;
  if (!id) {
    const meta = payload.metadata as Record<string, string> | undefined;
    id = Number(meta?.sponsorshipId) || 0;
  }
  if (!id) {
    /* 續扣事件沒有 merchantOrderNumber：用 subscriptionId（=sessionId）反查 */
    const subId = String(payload.subscriptionId || payload.sessionId || "");
    if (!subId) return undefined;
    return db.prepare("SELECT id,mode,status,amount,display_name,email,trade_no FROM sponsorships WHERE credit_token=?")
      .get(`PORTALY:${subId}`) as SponsorRow | undefined;
  }
  return db.prepare("SELECT id,mode,status,amount,display_name,email,trade_no FROM sponsorships WHERE id=?")
    .get(id) as SponsorRow | undefined;
}

export async function POST(req: NextRequest) {
  if (!portalyEnabled()) return new NextResponse("portaly disabled", { status: 400 });
  try {
    const payload = (await req.json()) as Record<string, unknown>;
    const timestamp = req.headers.get("x-portaly-timestamp") || "";
    const signature = req.headers.get("x-portaly-signature") || "";
    if (!verifyPortalyCallback(payload, timestamp, signature)) {
      return NextResponse.json({ error: "invalid signature" }, { status: 401 });
    }

    const event = req.headers.get("x-portaly-event") || String(payload.event || "");
    const testTag = payload.mode === "test" ? "（測試模式）" : "";
    const now = new Date().toISOString();
    const sp = findSponsorship(payload);
    if (!sp) return NextResponse.json({ ok: true, note: "no matching sponsorship" });

    if (event === "creator_subscription.checkout.completed") {
      if (String(payload.status) !== "completed") return NextResponse.json({ ok: true });
      if (sp.trade_no) return NextResponse.json({ ok: true, note: "already processed" });
      const sessionId = String(payload.sessionId || "");
      /* 加上 status='pending'：Portaly 也會重送 webhook，
         先讀 trade_no 再無條件 UPDATE 一樣有競態，會重複寄感謝信 */
      const payRef = String(payload.paymentReference || sessionId);
      /* 寫 trade_no 就一起記歷史（同一個 transaction），全站只有這一套規則，不留例外 */
      db.transaction(() => {
        const w = db.prepare(
          `UPDATE sponsorships SET status=?, trade_no=?, credit_token=?, pay_method='Portaly', last_charge_note=? WHERE id=? AND status='pending'`
        ).run(
          sp.mode === "monthly" ? "active" : "paid",
          payRef,
          `PORTALY:${sessionId}`,
          `Portaly 付款完成 ${now.slice(0, 10)}${testTag}`,
          sp.id
        );
        if (w.changes > 0) rememberSponsorTradeNo(sp.id, payRef);
      })();
      if (sp.status === "pending") {
        void sendSponsorThanksMail({ id: sp.id, mode: sp.mode, amount: Number(payload.amount) || sp.amount, display_name: sp.display_name, email: sp.email });
      }
      return NextResponse.json({ ok: true });
    }

    if (event === "creator_subscription.payment.succeeded") {
      const ref = String(payload.paymentId || payload.paymentReference || "");
      const dup = db.prepare("SELECT COUNT(*) AS n FROM sponsor_charges WHERE mer_trade_no=?").get(ref) as { n: number };
      if (ref && dup.n > 0) return NextResponse.json({ ok: true, note: "duplicate" });
      db.prepare(
        `INSERT INTO sponsor_charges (sponsorship_id,mer_trade_no,trade_no,amount,status,note,created_at) VALUES (?,?,?,?,?,?,?)`
      ).run(sp.id, ref, String(payload.paymentReference || ""), Number(payload.amount) || sp.amount, "paid", `Portaly 續扣${testTag}`, now);
      db.prepare("UPDATE sponsorships SET last_charge_note=? WHERE id=?")
        .run(`最近一次扣款成功 ${now.slice(0, 10)}（Portaly）${testTag}`, sp.id);
      void sendSponsorChargedMail({ id: sp.id, amount: Number(payload.amount) || sp.amount, display_name: sp.display_name, email: sp.email });
      return NextResponse.json({ ok: true });
    }

    if (event === "creator_subscription.payment.failed") {
      const ref = String(payload.paymentReference || "");
      db.prepare(
        `INSERT INTO sponsor_charges (sponsorship_id,mer_trade_no,trade_no,amount,status,note,created_at) VALUES (?,?,?,?,?,?,?)`
      ).run(sp.id, ref, ref, Number(payload.amount) || sp.amount, "failed", String(payload.failureReason || "扣款失敗"), now);
      const willCancel = payload.willCancel === true;
      db.prepare("UPDATE sponsorships SET last_charge_note=? WHERE id=?")
        .run(willCancel ? "續扣連續失敗，訂閱已由 Portaly 取消" : `續扣失敗（${payload.failureReason || ""}），Portaly 將自動重試`, sp.id);
      return NextResponse.json({ ok: true });
    }

    if (event === "creator_subscription.cancel_requested") {
      db.prepare("UPDATE sponsorships SET last_charge_note=? WHERE id=?")
        .run(`贊助者已排定取消，本期結束後停止（Portaly）${testTag}`, sp.id);
      return NextResponse.json({ ok: true });
    }

    if (event === "creator_subscription.canceled") {
      db.prepare("UPDATE sponsorships SET status='cancelled', last_charge_note=? WHERE id=?")
        .run(`訂閱已取消 ${now.slice(0, 10)}（Portaly）${testTag}`, sp.id);
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ ok: true, note: `unhandled event ${event}` });
  } catch (e) {
    console.error("[portaly callback]", e);
    return new NextResponse("error", { status: 500 });
  }
}
