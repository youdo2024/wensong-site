import db from "./db";
import { invoiceForSponsorship } from "./amego";
import { sendSponsorThanksMail } from "./mail";
import { notifySponsorship } from "./notify";
import { gaServerEvent } from "./ga";
import { findLineBinding, pushLine, composeLine, lineNotifyOn } from "./line";

/*
 * 系統自動判失敗的標記（對照 lib/order-superseded.ts 的 AUTO_CANCEL_MARK）。
 *
 * 為什麼要這個標記：綠界的虛擬帳號是「取號後兩天到 23:59」才失效，
 * 而對帳是從下單起算滿 48 小時就把待付款的贊助標成 failed。
 * 顧客不是拿到帳號就馬上去轉，隔天中午才去 ATM 很正常，
 * 錢真的進來時回呼會打過來，但所有入帳的路都寫 WHERE status='pending'，
 * 這時候 changes=0：錢收了、發票沒開、感謝信沒寄、後台一行紀錄都沒有。
 *
 * 商店訂單早就有 reopenIfAutoCancelled 這道保險，贊助沒有。
 * 所以自動判失敗時一律把這句話寫進備註，晚到的款項才認得出
 * 「這筆是系統自己判的，可以救回來」；站長手動改的狀態沒有這句話，永遠不會被自動翻回去。
 */
export const SPONSOR_AUTO_FAIL_MARK = "系統自動標記付款失敗";
export const SPONSOR_SUPERSEDED_MARK = "這筆是未完成的嘗試，系統自動結束";

/* 這筆贊助是不是「系統自己判失敗的」。是的話晚到的款項要能翻回待付款，不能默默吃掉 */
export function isSponsorAutoFailed(note: string | null | undefined): boolean {
  const n = String(note || "");
  return n.includes(SPONSOR_AUTO_FAIL_MARK) || n.includes(SPONSOR_SUPERSEDED_MARK);
}

/*
 * 把系統自動判失敗的贊助翻回待付款，好讓後面的入帳流程照常搶佔。
 * 條件式 UPDATE：只有 status='failed' 才會被翻，站長手動取消的（cancelled）碰不到，
 * 手動標失敗的因為備註沒有那句標記，isSponsorAutoFailed 就擋下來了。
 * 呼叫端一定要把這支跟入帳的 UPDATE 包在同一個 transaction，
 * 否則翻回 pending 之後入帳失敗，那筆會停在待付款被對帳再判一次失敗。
 */
export function reopenIfAutoFailed(id: number): boolean {
  const sp = db.prepare("SELECT status,COALESCE(last_charge_note,'') note FROM sponsorships WHERE id=?").get(id) as
    | { status: string; note: string } | undefined;
  if (!sp || sp.status !== "failed") return false;
  if (!isSponsorAutoFailed(sp.note)) return false;
  const win = db.prepare("UPDATE sponsorships SET status='pending' WHERE id=? AND status='failed'").run(id);
  if (win.changes === 0) return false;
  console.log(`[sponsor] #${id} 款項晚到：系統先前自動判的失敗已翻回待付款，接著正常入帳`);
  return true;
}

/*
 * 贊助入帳的唯一實作。綠界回呼（/api/ecpay/return）、幕後取號回呼（/api/ecpay/genpay-return）、
 * 對帳補正（lib/reconcile）以前各寫一份，三份慢慢漂開：有的加了 .catch、有的沒有，
 * last_charge_note 也各寫各的。三份裡只要有一份漏了新加的動作就是漏帳，
 * 而漏帳沒有人會抱怨（顧客只知道自己付了錢），所以合成這一支。
 *
 * 守門在 SQL 的 WHERE，只有一個贏家：綠界的通知會重送、對帳又同時在跑，
 * 少了這道就會開兩張發票（作廢比重寄信麻煩得多）。
 * 名字沿用 settleSponsorOncePaid，但現在單筆與定期定額首期都走這裡。
 */
export function settleSponsorOncePaid(
  id: number,
  mtn: string,
  note: string,
  opt: { monthlyNote?: string; gatewayTradeNo?: string } = {}
): boolean {
  const sp = db.prepare("SELECT id,mode,amount,display_name,email,COALESCE(phone,'') phone,ga_cid,ga_sid,ga_snum,trade_no FROM sponsorships WHERE id=?").get(id) as
    | { id: number; mode: string; amount: number; display_name: string; email: string; phone: string; ga_cid: string; ga_sid: string; ga_snum: string; trade_no: string } | undefined;
  if (!sp) return false;
  const monthly = sp.mode === "monthly";
  const now = new Date().toISOString();
  const ref = mtn || sp.trade_no || "";

  /* 晚到的款項：先把系統自動判的失敗翻回待付款，再搶佔。兩件事同一個 transaction，
     中途沒有任何一刻會停在「已翻回 pending 但沒入帳」。 */
  const claim = db.transaction((): boolean => {
    reopenIfAutoFailed(sp.id);
    return db
      .prepare("UPDATE sponsorships SET status=?, last_charge_note=? WHERE id=? AND status='pending'")
      .run(monthly ? "active" : "paid", monthly ? (opt.monthlyNote ?? note) : note, sp.id).changes > 0;
  });
  if (!claim()) return false;

  if (monthly) {
    /* 定期定額首期：記第 1 期扣款，發票掛在那一期底下 */
    const c = db
      .prepare("INSERT INTO sponsor_charges (sponsorship_id,mer_trade_no,trade_no,amount,status,note,created_at) VALUES (?,?,?,?,?,?,?)")
      .run(sp.id, ref, opt.gatewayTradeNo || "", sp.amount, "paid", "定期定額第 1 期", now);
    void invoiceForSponsorship(sp.id, `${ref}-1`, sp.amount, Number(c.lastInsertRowid)).catch((e) => console.error("[sponsor] 開發票", sp.id, e));
  } else {
    void invoiceForSponsorship(sp.id, ref, sp.amount).catch((e) => console.error("[sponsor] 開發票", sp.id, e));
  }
  /* 這幾支都是射後不理的 promise：少了 .catch，Node 22 的 unhandled rejection 會直接讓 process 收掉，
     等於一封信寄不出去就把整個站帶走。三份實作以前只有一份有加。 */
  void sendSponsorThanksMail({ id: sp.id, mode: sp.mode, amount: sp.amount, display_name: sp.display_name, email: sp.email })
    .catch((e) => console.error("[sponsor] 感謝信", sp.id, e));
  void notifySponsorship(sp.id, monthly ? "monthly-first" : "once").catch((e) => console.error("[sponsor] 站長通知", sp.id, e));
  void notifySponsorLine("paid", sp.id).catch((e) => console.error("[line] sponsor paid", sp.id, e));
  gaServerEvent(sp.ga_cid, "sponsor_complete", { mode: sp.mode, value: sp.amount, currency: "TWD", transaction_id: ref || `SP${sp.id}` }, { sid: sp.ga_sid, snum: sp.ga_snum });
  return true;
}

/*
 * 贊助人的 LINE 通知（跟商店訂單那套 notifyOrderLine 對齊）：paid 入帳、pending 待付款提醒。
 * 用 email／手機找綁定；沒綁、關著、白名單擋下都靜靜略過，回傳 reason 給呼叫端決定要不要補簡訊。
 * 所有贊助入帳的路（綠界回呼、LINE Pay 確認、對帳補正、幕後取號回呼）都呼叫這一支，不再各寫各的。
 */
export async function notifySponsorLine(kind: "paid" | "pending", id: number, extra: { url?: string; isFinal?: boolean } = {}): Promise<{ ok: boolean; reason: string }> {
  if (!lineNotifyOn()) return { ok: false, reason: "disabled" };
  const sp = db.prepare("SELECT id,amount,display_name,email,COALESCE(phone,'') phone FROM sponsorships WHERE id=?").get(id) as
    | { id: number; amount: number; display_name: string; email: string; phone: string } | undefined;
  if (!sp) return { ok: false, reason: "not_found" };
  const b = findLineBinding({ phone: sp.phone, email: sp.email });
  if (!b) return { ok: false, reason: "not_bound" };
  if (b.status !== "bound") return { ok: false, reason: "blocked" };
  const name = (sp.display_name || "").trim();
  const text = kind === "paid"
    ? `${name ? name + " 你好，" : ""}已收到你的支持 NT$${sp.amount}，謝謝。確認信與電子收據已寄到你的信箱。`
    : `${name ? name + " 你好，" : ""}你的支持 NT$${sp.amount} 還沒完成付款${extra.isFinal ? "，這是最後一次提醒" : ""}。點下面的連結可以直接接續，不用重填資料。`;
  const r = await pushLine({ lineUserId: b.line_user_id, text: composeLine(text, kind === "pending" ? extra.url || "" : ""), kind, orderNo: `SP${sp.id}` });
  return { ok: r.ok, reason: r.reason };
}
