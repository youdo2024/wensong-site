import db from "./db";
import { payItemName } from "./item-name";
import { PAYUNI, callPayuni, payuniEnabled } from "./payuni";
import { sendSponsorChargedMail } from "./mail";
import { addOneMonth } from "./month";
import { onMonthlyChargeFailed, onMonthlyChargeOk } from "./remind";

/*
 * 每月定額自動續扣：
 * 首期在 UPP 以 CreditToken 綁定約定卡號，notify 回存 CreditHash，
 * 之後由這裡用「信用卡幕後 API」對到期的贊助扣款。
 */

type DueRow = {
  id: number; amount: number; email: string; display_name: string;
  credit_token: string; credit_hash: string; invoice_type: string; invoice_data: string;
};

/* 續扣發票走最簡單的路：一律開到 PayUni 會員載具（amego），
   發票直接寄到贊助者 Email（UsrMail 已隨扣款帶出），前台不必問載具 */
function invoiceFields(sp: DueRow): Record<string, string> {
  if (process.env.PAYUNI_INVOICE !== "1") return {};
  return { CarrierType: "amego", InvBuyerName: sp.display_name || "個人" };
}

export async function chargeDueSponsorships(): Promise<{ charged: number; failed: number }> {
  if (!payuniEnabled()) return { charged: 0, failed: 0 };
  const now = new Date().toISOString();
  const due = db
    .prepare(
      `SELECT id,amount,email,display_name,credit_token,credit_hash,invoice_type,invoice_data FROM sponsorships
       WHERE mode='monthly' AND status='active' AND credit_hash!='' AND next_charge_at!='' AND next_charge_at<=?`
    )
    .all(now) as DueRow[];

  let charged = 0, failed = 0;
  for (const sp of due) {
    const merTradeNo = `SPR${sp.id}X${Date.now().toString(36).toUpperCase()}`;
    try {
      const { status, data } = await callPayuni("credit", {
        MerID: PAYUNI.merId,
        MerTradeNo: merTradeNo,
        TradeAmt: sp.amount,
        Timestamp: Math.floor(Date.now() / 1000),
        UsrMail: sp.email,
        ProdDesc: payItemName("monthly"),
        CreditToken: sp.credit_token,
        CreditHash: sp.credit_hash,
        ...invoiceFields(sp),
      });
      const ok = status === "SUCCESS" && data.TradeStatus === "1";
      db.prepare(
        `INSERT INTO sponsor_charges (sponsorship_id,mer_trade_no,trade_no,amount,status,note,created_at) VALUES (?,?,?,?,?,?,?)`
      ).run(sp.id, merTradeNo, data.TradeNo || "", sp.amount, ok ? "paid" : "failed", data.Message || status, now);

      if (ok) {
        charged++;
        db.prepare("UPDATE sponsorships SET next_charge_at=?, last_charge_note=? WHERE id=?").run(
          addOneMonth(new Date()).toISOString(),
          `最近一次扣款成功 ${now.slice(0, 10)}`,
          sp.id
        );
        void sendSponsorChargedMail(sp).catch((e) => console.error("[recurring] 扣款通知信", sp.id, e));
        /* 連續失敗的計數歸零，跟綠界那條（app/api/ecpay/period）同一套規則 */
        onMonthlyChargeOk(sp.id);
      } else {
        failed++;
        /* 失敗三天後重試；連續失敗可在後台手動取消 */
        db.prepare("UPDATE sponsorships SET next_charge_at=?, last_charge_note=? WHERE id=?").run(
          new Date(Date.now() + 3 * 86400000).toISOString(),
          `扣款失敗（${data.Message || status}），三天後重試`,
          sp.id
        );
        /*
         * 通知整合（docs/notify-spec.md 第五章）：第一次失敗通知客人，連續兩期標成暫停並通知一次。
         * 綠界那條（app/api/ecpay/period/route.ts）早就這樣做，PayUni 這條一直漏掉，
         * 結果是卡片停用的月捐者每三天被扣一次、永遠扣不成、也永遠沒有人通知他，
         * 狀態也永遠停在 active（進不了 paused，續扣排程只挑 active，所以會一直重試下去）。
         */
        void onMonthlyChargeFailed(sp.id).catch((e) => console.error("[recurring] 扣款失敗通知", sp.id, e));
      }
    } catch (e) {
      failed++;
      const msg = e instanceof Error ? e.message : "unknown";
      /*
       * 這裡是最危險的一條路：呼叫拋錯不代表沒扣到款（連線逾時、回應解析失敗都會走到這），
       * 但原本只更新 next_charge_at、沒有留下任何嘗試紀錄，後台完全看不到發生過什麼，
       * 一天後又扣一次就可能變成重複扣款。至少要把這次嘗試寫進帳，人工才查得到。
       */
      try {
        db.prepare(
          `INSERT INTO sponsor_charges (sponsorship_id,mer_trade_no,trade_no,amount,status,note,created_at) VALUES (?,?,?,?,?,?,?)`
        ).run(sp.id, merTradeNo, "", sp.amount, "failed", `扣款異常（${msg}）：結果未知，重試前請先確認 PayUni 後台是否已扣款`, now);
      } catch (e2) {
        console.error("[recurring] 連異常紀錄都寫不進去", sp.id, e2);
      }
      db.prepare("UPDATE sponsorships SET next_charge_at=?, last_charge_note=? WHERE id=?").run(
        new Date(Date.now() + 86400000).toISOString(),
        `扣款異常（${msg}），一天後重試。注意：異常不等於沒扣到，重試前請先確認 PayUni 後台`,
        sp.id
      );
      /*
       * 這一條刻意不呼叫 onMonthlyChargeFailed。異常＝結果未知，可能已經扣到款，
       * 對客人說「這一期沒有扣款成功」而他的帳單上有這筆，比不通知更糟。
       * 這種要人工到 PayUni 後台核對，上面那筆 sponsor_charges 就是給人看的。
       */
    }
  }
  if (due.length) console.log(`[recurring] due=${due.length} charged=${charged} failed=${failed}`);
  return { charged, failed };
}

/* 伺服器啟動後每 6 小時檢查一次（Zeabur 是常駐服務，setInterval 可靠） */
const g = globalThis as unknown as { __yoRecurringTimer?: ReturnType<typeof setInterval> };
export function startRecurringLoop() {
  if (g.__yoRecurringTimer) return;
  /* 加 unref：比照 reconcile 的排程，計時器不該讓 process 無法自然結束 */
  g.__yoRecurringTimer = setInterval(() => {
    chargeDueSponsorships().catch((e) => console.error("[recurring]", e));
  }, 6 * 60 * 60 * 1000);
  g.__yoRecurringTimer.unref?.();
  /* 開機一分鐘後先跑一次，補上停機期間到期的扣款 */
  setTimeout(() => {
    chargeDueSponsorships().catch((e) => console.error("[recurring]", e));
  }, 60 * 1000).unref?.();
}
