"use server";
import { redirect } from "next/navigation";
import db from "@/lib/db";
import { cancelToken } from "@/lib/mail";
import { cancelSubscription } from "@/lib/portaly";
import { cancelCreditPeriod } from "@/lib/ecpay";
import { alterPeriodStatus, isNewebpayPeriodMtn } from "@/lib/newebpay-period";
import { sponsorTradeNoHistory } from "@/lib/sponsor-trade-no";

/* 贊助者透過信中連結自行取消（HMAC token 驗證，無法偽造他人 id）
   綠界定期定額要呼叫解約 API 停止未來授權；
   藍新定期定額要呼叫 AlterStatus（terminate）停止未來扣款；
   Portaly 訂閱要先呼叫其取消 API 停止未來扣款（本期權益保留到期末，屆時回呼會把狀態改為 cancelled）；
   PayUni 舊制訂閱直接改本地狀態即可（續扣排程只看本地狀態） */
export async function cancelSponsorshipByToken(formData: FormData) {
  const id = Number(formData.get("id")) || 0;
  const t = String(formData.get("t") || "");
  if (id > 0 && t === cancelToken(id)) {
    const sp = db
      .prepare("SELECT credit_token,provider,trade_no FROM sponsorships WHERE id=? AND mode='monthly' AND status='active'")
      .get(id) as { credit_token: string; provider: string; trade_no: string } | undefined;
    /*
     * 查不到代表這筆不是「每月定額且進行中」：可能還在待付款、已經取消過，
     * 或本來就是單筆。原本這種情況會落到最後的 else，而那句 UPDATE 的條件
     * 同樣是 status='active'，等於什麼都沒做，畫面卻照樣顯示「已取消」。
     * 贊助者會以為停掉了，但那筆若日後轉為 active 仍會繼續扣款。
     */
    if (!sp) redirect(`/support/cancel?id=${id}&t=${t}&none=1`);
    if (sp?.provider === "ecpay" && sp.trade_no) {
      const r = await cancelCreditPeriod(sp.trade_no);
      if (!r.ok) redirect(`/support/cancel?id=${id}&t=${t}&fail=1`);
      db.prepare("UPDATE sponsorships SET status='cancelled', last_charge_note='贊助者自行取消（綠界已解約）' WHERE id=? AND status='active'").run(id);
    } else if (sp?.provider === "newebpay") {
      /*
       * credit_token 存的是 PeriodNo（見 app/api/newebpay/period/notify）；
       * MerOrderNo 首期成功後就被 trade_no 換成藍新的 TradeNo，原始的委託編號
       * 只留在單號歷史表（見 app/support/pay/[id]/page.tsx 建立委託時的
       * rememberSponsorTradeNo），這裡找回最新一組 WP 開頭的編號送去解約。
       */
      const periodNo = sp.credit_token || "";
      const merOrderNo = sponsorTradeNoHistory(id).find((n) => isNewebpayPeriodMtn(n)) || "";
      if (!periodNo || !merOrderNo) redirect(`/support/cancel?id=${id}&t=${t}&fail=1`);
      const r = await alterPeriodStatus(merOrderNo, periodNo, "terminate");
      if (!r.ok) redirect(`/support/cancel?id=${id}&t=${t}&fail=1`);
      db.prepare("UPDATE sponsorships SET status='cancelled', last_charge_note='贊助者自行取消（藍新已解約）' WHERE id=? AND status='active'").run(id);
    } else if (sp?.credit_token?.startsWith("PORTALY:")) {
      const ok = await cancelSubscription(sp.credit_token.slice(8));
      if (!ok) redirect(`/support/cancel?id=${id}&t=${t}&fail=1`);
      db.prepare("UPDATE sponsorships SET last_charge_note='已申請停止，本期結束後不再扣款（Portaly）' WHERE id=?").run(id);
    } else {
      db.prepare("UPDATE sponsorships SET status='cancelled', last_charge_note='贊助者自行取消' WHERE id=? AND mode='monthly' AND status='active'").run(id);
    }
  }
  redirect(`/support/cancel?id=${id}&t=${t}&done=1`);
}
