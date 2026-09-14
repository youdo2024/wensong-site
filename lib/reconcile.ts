import db, { getSetting, setSetting } from "./db";
import { queryByOrderNo, tappayEnabled } from "./tappay";
import { applyTappayOrderResult, restoreStock, applyEcpayOrderResult, applyNewebpayOrderResult } from "./payment-sync";
import { ecpayEnabled, ecpayConfig, ecpayPayLabel, queryTradeInfo, queryPeriodInfo, orderNoFromMtn } from "./ecpay";
import { isGenpayMtn, queryGenPayTrade } from "./ecpay-genpay";
import { newebpayEnabled, newebpayOrderMtn, queryTrade as queryNewebpayTrade } from "./newebpay";
import { settleSponsorOncePaid, isSponsorAutoFailed, SPONSOR_AUTO_FAIL_MARK } from "./sponsor-settle";
import { loadOrderTarget, loadSponsorTarget, autoRemindStep, shouldFail, supersededBy, sendNotice, notifySponsorFailed, flushQueue, notifyPaused, notifyDryRun, allSkipped, anySent } from "./remind";
import { linepayEnabled, linepayQueryByOrderId, linepayCheckRequest, linepayConfirm } from "./linepay";
import { sendSponsorResumeMail, sendOrderResumeMail, sendOrderFailedMail, mailEnabled, mailBlocked } from "./mail";
import { sendSms, pendingSms, failedSms, payUrlFor } from "./sms";
import { notifyOrderLine, lineInviteSmsLine } from "./line";
import { taipeiYMD } from "./month";
import { orderSupersededBy, supersededNote, SUPERSEDED_MARK } from "./order-superseded";
import { payLinkByToken, releaseExpiredPayLinks } from "./pay-link";
import { emailLooksWrong } from "./email-typo";

/*
 * ── 自動對帳 ──
 *
 * 為什麼需要：贊助紀錄是在顧客按下送出的當下就以「待付款」寫進資料庫的，
 * 這時還沒經過金流。之後金流只會在「成功」時回呼我們：
 *   · 綠界信用卡：授權失敗或顧客關掉視窗，完全不通知
 *   · LINE Pay：顧客在 App 裡放棄，只導回贊助頁，什麼都不記
 * 所以放棄或失敗的紀錄會永遠停在「待付款」，而且無法分辨
 * 「其實付了但回呼沒進來」和「根本沒付」——前者是漏帳，錢收了卻沒開發票也沒道謝。
 *
 * 這支程式反過來主動去問金流商每一筆待付款的真實結果，然後：
 *   已付款 → 補做所有原本該做的事（改狀態、開發票、寄感謝信、通知站長、回報 GA）
 *   未付款 → 先寄一封帶「一鍵回到付款頁」的提醒信（每筆只寄一次），
 *            提醒後再過一天仍沒完成，才標記為付款失敗
 *
 * 每 15 分鐘跑一次；後台也有「立即對帳一次」可以手動觸發。
 */

/* 綠界查詢回傳的狀態碼翻成看得懂的字，直接寫進後台備註 */
/*
 * 綠界查詢回傳的狀態碼翻成看得懂的字。
 *
 * 10200095 原本被寫成「取號失敗」，那是錯的。官方文件（developers.ecpay.com.tw/2890）
 * 的定義是「交易訂單未建立，消費者未完成付款程序，導致交易失敗」，與 ATM 取號無關。
 * 這個錯誤翻譯造成 8 筆信用卡與 3 筆 Apple Pay 的失敗被標成「取號失敗」，
 * 而那兩種付款方式根本沒有取號這個步驟，等於後台完全查不出真正原因。
 * 錯誤訊息本身沒有讓程式壞掉，但會讓人做出錯誤判斷，這種錯更難發現。
 */
function ecpayStatusText(code: string): string {
  const map: Record<string, string> = {
    "0": "已建立訂單但顧客沒有完成付款",
    "1": "已付款",
    "10200047": "綠界查無此筆訂單（顧客沒有真的送出付款）",
    "10200095": "顧客未完成付款程序（交易未建立）",
  };
  return map[code] || `綠界代碼 ${code || "查無"}`;
}

/* 剛送出的先別碰，顧客可能還在金流頁上輸入卡號 */
const GRACE_MIN = 20;
/* 沒付款拖過這麼久就判定失敗。ATM 有三天繳費期，所以給得比較寬 */
const FAIL_AFTER_HOURS = 26;
const FAIL_AFTER_HOURS_ATM = 24 * 4;
/* 超過這個天數就不再追（避免無限累積要查的舊單） */
const MAX_AGE_DAYS = 30;
/* 提醒信：待付款滿 1 小時寄第一封，再隔 24 小時寄第二封，總共只寄兩封 */
const REMIND_AFTER_MIN = 60;
const REMIND_2ND_AFTER_HOURS = 24;
const REMIND_MAX = 2;

export type ReconcileResult = {
  checked: number;
  paid: number;
  failed: number;
  reminded: number;
  skipped: number;
  notes: string[];
};

type PendingRow = {
  id: number; mode: string; amount: number; display_name: string; email: string;
  status: string; provider: string; pay_method: string; pay_token: string; trade_no: string;
  credit_token: string; ga_cid: string; ga_sid: string; ga_snum: string; created_at: string; remind_at: string; remind_count: number;
  atm_bank: string; atm_vaccount: string; atm_expire: string; phone: string;
};

function hoursSince(iso: string): number {
  const t = new Date(iso).getTime();
  if (isNaN(t)) return 0;
  return (Date.now() - t) / 3_600_000;
}

/*
 * 補做「付款成功」原本該做的每一件事。
 *
 * 實作只有一份，在 lib/sponsor-settle：以前這裡、/api/ecpay/return、幕後取號回呼各寫一份，
 * 三份已經開始漂（有的 void promise 沒接 .catch、last_charge_note 也各寫各的），
 * 而三份裡漏掉一個動作就是漏帳，顧客只知道自己付了錢，不會來抱怨。
 * 那支同時會把「系統自動判失敗」的贊助翻回待付款再入帳（款項晚到的救援）。
 */
function settlePaid(sp: PendingRow, orderId: string, note: string): boolean {
  return settleSponsorOncePaid(sp.id, orderId, note);
}

/* 還在待付款、但已經問過金流商了：把結論寫進備註，後台才看得到系統查過什麼 */
function noteStatus(sp: PendingRow, text: string): void {
  const p = (n: number) => String(n).padStart(2, "0");
  const t = new Date(Date.now() + 8 * 3600 * 1000);
  const stamp = `${p(t.getUTCMonth() + 1)}/${p(t.getUTCDate())} ${p(t.getUTCHours())}:${p(t.getUTCMinutes())}`;
  db.prepare("UPDATE sponsorships SET last_charge_note=? WHERE id=? AND status='pending'").run(`${stamp} 對帳：${text}`, sp.id);
}

/*
 * 系統自己判的失敗一律附上 SPONSOR_AUTO_FAIL_MARK。
 * 綠界的虛擬帳號是「取號後兩天 23:59」才失效，而且顧客常常隔天才去 ATM，
 * 所以我們判失敗的那一刻，帳號往往還活著、錢還可能進來。
 * 有這句話，晚到的回呼才認得出這筆可以翻回待付款照常入帳；
 * 站長手動改的狀態沒有這句話，永遠不會被自動翻回去。
 */
function markFailed(sp: PendingRow, note: string): boolean {
  return db
    .prepare("UPDATE sponsorships SET status='failed', last_charge_note=? WHERE id=? AND status='pending'")
    .run(`${note}（${SPONSOR_AUTO_FAIL_MARK}）`, sp.id).changes > 0;
}

/*
 * 寄「你的支持還差一步」，信裡有直接回付款頁的連結。
 * 第一封在待付款滿 1 小時後寄，第二封再隔 24 小時；兩封寄完就不再打擾。
 */
async function maybeRemind(sp: PendingRow): Promise<boolean> {
  /* 通知整合（docs/notify-spec.md）：節奏、管道、文案全在 lib/remind，這裡只呼叫 */
  const t = loadSponsorTarget(sp.id);
  if (!t) return false;
  const ok = await autoRemindStep(t);
  if (ok) sp.remind_count = (sp.remind_count || 0) + 1;
  return ok;
}

/*
 * 確認「還沒收到錢」之後怎麼處理。
 * 順序很重要：一旦標記為失敗，提醒信裡的付款連結就會失效（付款頁只接受待付款），
 * 所以一定要先給顧客一次挽回機會，等提醒信寄出且再過一天仍沒動靜，才判定失敗。
 */
async function handleUnpaid(sp: PendingRow, r: ReconcileResult, reason: string, limitHours: number): Promise<void> {
  const sent = await maybeRemind(sp);
  if (sent) {
    r.reminded++;
    r.notes.push(`#${sp.id} ${sp.display_name || "匿名"} → 已寄出第 ${sp.remind_count} 封未完成付款提醒信`);
    noteStatus(sp, `${reason}，已寄出第 ${sp.remind_count} 封提醒信`);
    return;
  }
  /* 通知整合：下單 48 小時（換方式那一輪起算）沒付就判失敗，失敗通知照商品那套（信＋LINE／簡訊） */
  const t = loadSponsorTarget(sp.id);
  void limitHours;
  if (t && shouldFail(t)) {
    if (supersededBy(t)) {
      if (markFailed(sp, `同一位支持者後續已由 ${supersededBy(t)} 付款成功，這筆是未完成的嘗試，系統自動結束`)) r.failed++;
      return;
    }
    if (markFailed(sp, `對帳結果：${reason}，48 小時內未完成，未向顧客收取任何費用`)) {
      r.failed++;
      r.notes.push(`#${sp.id} ${sp.display_name || "匿名"} NT.${sp.amount} → 48 小時未付款，標記為付款失敗並通知`);
      void notifySponsorFailed(sp.id).catch((e) => console.error("[reconcile] 贊助失敗通知", sp.id, e));
    }
    return;
  }
  noteStatus(sp, `${reason}，仍在等待顧客完成（已提醒 ${sp.remind_count || 0} 次）`);
}

/* ── 綠界單筆（信用卡／Apple Pay／ATM／多元支付） ── */
async function checkEcpayOnce(sp: PendingRow, r: ReconcileResult): Promise<void> {
  /* 幕後取號的贊助（YO…B…）：查另一個端點 */
  if (isGenpayMtn(sp.trade_no || "")) {
    const q = await queryGenPayTrade(sp.trade_no);
    if (!q.ok) { r.notes.push(`#${sp.id} 綠界幕後取號查詢異常：${q.error || ""}`); r.skipped++; return; }
    if (q.tradeStatus === "1") {
      if (settlePaid(sp, sp.trade_no, `對帳補正：綠界（幕後取號）顯示已付款（${q.paymentDate || ""}）`)) {
        r.paid++;
        r.notes.push(`#${sp.id} ${sp.display_name || "匿名"} NT.${sp.amount} → 其實已付款，已補開發票並寄信`);
      }
      return;
    }
    await handleUnpaid(sp, r, "綠界幕後取號顯示尚未付款", FAIL_AFTER_HOURS_ATM);
    return;
  }
  const info = await queryTradeInfo(sp.trade_no);
  if (!info) { r.skipped++; return; }
  if (info._error) {
    r.notes.push(`#${sp.id} 綠界查詢異常：${info._error}`);
    r.skipped++;
    return;
  }
  const status = info.TradeStatus || "";
  if (status === "1") {
    if (settlePaid(sp, sp.trade_no, `對帳補正：綠界顯示已付款（${info.PaymentDate || ""}）`)) {
      r.paid++;
      r.notes.push(`#${sp.id} ${sp.display_name || "匿名"} NT.${sp.amount} → 其實已付款，已補開發票並寄信`);
    }
    return;
  }
  /* ATM 已取號的用繳費期限判斷，其他用時數 */
  const isAtm = Boolean(sp.atm_vaccount) || sp.pay_method.includes("ATM") || sp.pay_method.includes("銀行");
  await handleUnpaid(sp, r, ecpayStatusText(status), isAtm ? FAIL_AFTER_HOURS_ATM : FAIL_AFTER_HOURS);
}

/* ── 綠界信用卡定期定額（首期授權） ── */
async function checkEcpayPeriod(sp: PendingRow, r: ReconcileResult): Promise<void> {
  const info = await queryPeriodInfo(sp.trade_no);
  if (!info) { r.skipped++; return; }
  if (info._error) {
    r.notes.push(`#${sp.id} 綠界定期定額查詢異常：${String(info._error)}`);
    r.skipped++;
    return;
  }
  /* TotalSuccessTimes 是最直接的證據：真的扣成功過幾期。
     ExecStatus 1＝委託成功執行中（查無委託時綠界回 null） */
  const exec = String(info.ExecStatus ?? "");
  const authed = Number(info.TotalSuccessTimes ?? 0) || Number(info.ExecTimes ?? 0);
  if (exec === "1" || authed >= 1) {
    if (settlePaid(sp, sp.trade_no, `對帳補正：綠界顯示定期定額委託成功（已授權 ${authed || 1} 期）`)) {
      r.paid++;
      r.notes.push(`#${sp.id} ${sp.display_name || "匿名"} NT.${sp.amount}／月 → 其實已授權成功，已補開發票並寄信`);
    }
    return;
  }
  await handleUnpaid(sp, r, `綠界查無定期定額委託（ExecStatus=${exec || "查無"}）`, FAIL_AFTER_HOURS);
}

/* ── LINE Pay ── */
async function checkLinePay(sp: PendingRow, r: ReconcileResult): Promise<void> {
  /* 1) 已請款？查得到就是錢確實收到了 */
  const q = await linepayQueryByOrderId(sp.trade_no);
  if (q.found) {
    if (settlePaid(sp, sp.trade_no, "對帳補正：LINE Pay 顯示已請款")) {
      r.paid++;
      r.notes.push(`#${sp.id} ${sp.display_name || "匿名"} NT.${sp.amount} → LINE Pay 其實已請款，已補開發票並寄信`);
    }
    return;
  }

  /* 2) 顧客授權完卻沒導回我們網站？錢還留著，補請款就收得到 */
  const reqId = (sp.credit_token || "").startsWith("LINEPAYREQ:") ? sp.credit_token.slice(11) : "";
  if (reqId) {
    const chk = await linepayCheckRequest(reqId);
    if (chk.confirmable) {
      const c = await linepayConfirm(reqId, sp.amount);
      if (c.ok && settlePaid(sp, sp.trade_no, "對帳補正：顧客已在 LINE 授權但沒導回網站，已補請款成功")) {
        r.paid++;
        r.notes.push(`#${sp.id} ${sp.display_name || "匿名"} NT.${sp.amount} → 補請款成功（顧客授權後沒導回網站）`);
        return;
      }
      if (!c.ok) r.notes.push(`#${sp.id} 補請款失敗：${c.msg}`);
    }
  }

  await handleUnpaid(sp, r, `LINE Pay 尚未收到請款（${q.msg || "查無交易"}）`, FAIL_AFTER_HOURS);
}

/*
 * ── 藍新（NewebPay）單筆 ──
 * trade_no 存的是這筆贊助最後一次送出去的 MerchantOrderNo（見 app/support/pay/[id]/page.tsx），
 * 查詢 API 要用同一個值才問得到正確的交易，不能自己重算（重算的時間戳跟送出去的不會一樣）。
 */
async function checkNewebpaySponsor(sp: PendingRow, r: ReconcileResult): Promise<void> {
  const q = await queryNewebpayTrade(sp.trade_no, sp.amount);
  if (!q.ok) { r.notes.push(`#${sp.id} 藍新查詢異常：${q.error || ""}`); r.skipped++; return; }
  if (q.paid) {
    if (settlePaid(sp, sp.trade_no, "對帳補正：藍新顯示已付款")) {
      r.paid++;
      r.notes.push(`#${sp.id} ${sp.display_name || "匿名"} NT.${sp.amount} → 其實已付款，已補開發票並寄信`);
    }
    return;
  }
  const isAtm = Boolean(sp.atm_vaccount) || sp.pay_method.includes("ATM");
  await handleUnpaid(sp, r, "藍新顯示尚未付款", isAtm ? FAIL_AFTER_HOURS_ATM : FAIL_AFTER_HOURS);
}

/*
 * 商店訂單清理：pending 訂單的庫存在下單當下就扣走了，
 * 顧客中途放棄的話沒有任何回呼會來，庫存會被永遠鎖住（會造成假性售罄）。
 * 1. TapPay 有查詢 API：先回查補正（付了就入帳開發票、明確失敗就取消回補）
 * 2. 逾期未付：信用卡／錢包 24 小時（跳轉頁 session 早已失效，不可能再付款）、
 *    ATM 取號 7 天（繳費期限通常 3 天，多留緩衝）→ 取消並回補庫存
 *
 * 關於 PayUni：這裡原本寫「PayUni 沒有查詢 API，逾期取消是安全的」，這句話是錯的。
 * PayUni 官方 SDK 有 trade_query（交易查詢），只是本站還沒串。
 * 在串起來之前，「逾期」不等於「沒付款」——只要幕後 NotifyURL 沒送達
 * （我們回過 500、或網路中斷），已付款的訂單也會停在 pending 然後被這裡取消，
 * 顧客付了錢卻收到取消。所以庫存照樣釋放，但凡是拿過金流單號的訂單一律標記出來，
 * 列進對帳報告等人工到 PayUni 後台核對，不再默默取消。
 */
const ecpayLive = () => ecpayConfig().live;

type StaleOrderRow = {
  id: number; order_no: string; name: string; email: string; phone: string; token: string;
  items: string; subtotal: number; shipping: number; total: number; address: string;
  pay_method: string; pay_note: string; trade_no: string;
  created_at: string; remind_at: string; remind_count: number; pay_link: string;
};

/*
 * 連結型訂單的節奏跟散客完全不同：企業請款走公司流程，月結三十天票期很常見。
 * 用散客那套（刷卡 24 小時、一小時後就催）會誤殺，一張 100 盒的單被自動取消、
 * 庫存放回去被散客買走，對方第 10 天匯款進來就很難收拾。
 * 逾期天數用建立連結時設定的保留天數，提醒改成第 3 天、再過 7 天各一封。
 */
const LINK_REMIND_AFTER_MIN = 3 * 24 * 60;
const LINK_REMIND_2ND_AFTER_HOURS = 7 * 24;

/* 一輪對帳最多看 200 筆待付款訂單，逐筆去查連結就是 200 次查詢。
   同一輪內快取起來，連結資料在一輪之內不會變。 */
const holdCache = new Map<string, number | null>();
function payLinkHoldHours(o: { pay_link: string }): number | null {
  if (!o.pay_link) return null;
  if (holdCache.has(o.pay_link)) return holdCache.get(o.pay_link)!;
  const l = payLinkByToken(o.pay_link);
  const v = l ? Math.max(1, l.hold_days) * 24 : null;
  holdCache.set(o.pay_link, v);
  return v;
}

/*
 * 訂單待付款提醒。時間規則與贊助共用（1 小時後第一封、再過 24 小時第二封、最多兩封），
 * 因為兩邊的成因是同一個：綠界對信用卡只有授權成功才回呼，失敗與放棄我們都收不到。
 *
 * 從 pay_note 撈得到繳費帳號的（ATM 已取號）另寄一種內容：那位顧客要的是帳號，
 * 不是換一種付款方式。撈不到就給一鍵重付，並優先推 ATM。
 *
 * 寄成功才寫回計數，寄失敗下一輪會再試；用條件式 UPDATE 搶佔，
 * 對帳與後台手動觸發同時跑時不會兩邊各寄一封。
 */
async function maybeRemindOrder(o: StaleOrderRow): Promise<boolean> {
  /* 通知整合（docs/notify-spec.md）：節奏、管道、文案全在 lib/remind */
  const t = loadOrderTarget(o.id);
  if (!t) return false;
  const ok = await autoRemindStep(t);
  if (ok) o.remind_count = (o.remind_count || 0) + 1;
  return ok;
}

async function cleanupStaleOrders(r: ReconcileResult): Promise<void> {
  const rows = db
    .prepare(
      `SELECT id,order_no,name,email,COALESCE(phone,'') phone,token,items,subtotal,shipping,total,address,pay_method,pay_note,trade_no,
              created_at,remind_at,remind_count
       , pay_link FROM orders WHERE status='pending' ORDER BY id DESC LIMIT 200`
    )
    .all() as StaleOrderRow[];
  for (const o of rows) {
    const age = hoursSince(o.created_at);
    if (age * 60 < GRACE_MIN) continue;
    /* 綠界回查：通知掉了的訂單在這裡補上。TradeStatus 1＝已付款。
       只查看起來走過綠界流程的單（LINE Pay 的 trade_no 是 YD…L… 開頭，查綠界會查無此單，無妨） */
    /* 幕後取號的單（trade_no 是 YD…B…）：另一套查詢端點，全方位金流那邊查不到它 */
    if (ecpayLive() && isGenpayMtn(o.trade_no || "")) {
      try {
        const q = await queryGenPayTrade(o.trade_no);
        if (q.ok && q.tradeStatus === "1") {
          const res = applyEcpayOrderResult(o.order_no, "paid", q.tradeNo || "", "ATM 轉帳", "對帳補正：綠界幕後取號顯示已付款", q.tradeAmt || undefined);
          if (res.kind === "order" && res.outcome === "failed") {
            r.notes.push(`訂單 ${o.order_no} → 綠界回報金額與應付不符，未自動入帳，請人工確認`);
            continue;
          }
          r.paid++;
          r.notes.push(`訂單 ${o.order_no} → 綠界（幕後取號）其實已付款，已補入帳與發票`);
          continue;
        }
      } catch (e) {
        console.error("[reconcile] 訂單幕後取號回查失敗", o.order_no, e);
      }
    } else if (ecpayLive()) {
      try {
        /* 重試過的單，綠界那邊的紀錄在新單號底下（YD…R…），問舊號只會拿到第一次那筆。
           兩個號都問，任一筆顯示已付款就補入帳。 */
        const nos = [o.order_no];
        if (o.trade_no && o.trade_no !== o.order_no && orderNoFromMtn(o.trade_no) === o.order_no) nos.unshift(o.trade_no);
        let q: Record<string, string> | null = null;
        for (const n of nos) {
          q = await queryTradeInfo(n);
          if (q && String(q.TradeStatus) === "1") break;
        }
        if (q && String(q.TradeStatus) === "1") {
          const res = applyEcpayOrderResult(
            o.order_no, "paid", q.TradeNo || "", ecpayPayLabel(q.PaymentType || ""),
            "對帳補正：綠界顯示已付款", Number(q.TradeAmt) || undefined
          );
          if (res.kind === "order" && res.outcome === "failed") {
            r.notes.push(`訂單 ${o.order_no} → 綠界回報金額與應付不符，未自動入帳，請人工確認`);
            continue;
          }
          r.paid++;
          r.notes.push(`訂單 ${o.order_no} → 綠界其實已付款，已補入帳與發票`);
          continue;
        }
      } catch (e) {
        console.error("[reconcile] 訂單綠界回查失敗", o.order_no, e);
      }
    }
    /* TapPay 回查：通知掉了的訂單在這裡補上（查無此單＝走別家金流，跳過） */
    if (tappayEnabled()) {
      try {
        const q = await queryByOrderNo(o.order_no);
        if (q?.paid) {
          const res = applyTappayOrderResult(o.order_no, "paid", q.recTradeId, `對帳補正：TapPay 顯示已付款${q.bankMsg ? `（${q.bankMsg}）` : ""}`, q.amount);
          /* 金額不符時 applyTappayOrderResult 會回 failed 且不入帳，這裡不能謊報成已補入帳 */
          if (res.kind === "order" && res.outcome === "failed") {
            r.notes.push(`訂單 ${o.order_no} → TapPay 回報金額與應付不符，未自動入帳，請人工確認`);
            continue;
          }
          r.paid++;
          r.notes.push(`訂單 ${o.order_no} → TapPay 其實已付款，已補入帳與發票`);
          continue;
        }
      } catch (e) {
        console.error("[reconcile] 訂單 TapPay 回查失敗", o.order_no, e);
      }
    }
    /* 藍新回查：通知掉了的訂單在這裡補上（查無此單＝走別家金流，harmless，跳過即可）。
       trade_no 有值代表重試過（見 app/api/orders/pay），沒有值就是第一次送出時那組固定編號 */
    if (newebpayEnabled()) {
      try {
        const mtn = o.trade_no && o.trade_no.startsWith("WO") ? o.trade_no : newebpayOrderMtn(o.order_no);
        const q = await queryNewebpayTrade(mtn, o.total);
        if (q.paid) {
          const res = applyNewebpayOrderResult(o.order_no, "paid", mtn, "藍新", "對帳補正：藍新顯示已付款", o.total);
          if (res.kind === "order" && res.outcome === "failed") {
            r.notes.push(`訂單 ${o.order_no} → 藍新回報金額與應付不符，未自動入帳，請人工確認`);
            continue;
          }
          r.paid++;
          r.notes.push(`訂單 ${o.order_no} → 藍新其實已付款，已補入帳與發票`);
          continue;
        }
      } catch (e) {
        console.error("[reconcile] 訂單藍新回查失敗", o.order_no, e);
      }
    }
    /*
     * 逾期只有一個時鐘。
     *
     * 舊寫法有兩個：age 從 created_at 算，shouldFail 從 round_started_at（換付款方式時
     * resetRound 會重設）算，然後用 `!failNow && age < staleAfter` 把兩個並聯。
     * 顧客在第 30 小時按了「重選付款方式」換成 ATM，新一輪才走三分之一、
     * 新的虛擬帳號還有兩天效期，卻在第 48 小時被 age 那個時鐘判逾期取消：
     * 他照著繳費單去轉帳，錢進來時訂單已經不在了。
     *
     * 所以一律用提醒引擎的那一個時鐘：shouldFail 內部就是 baseTime(t)＋failAfterMin(t)，
     * 連結型訂單的保留天數也已經含在 failAfterMin 裡（lib/remind.ts）。
     * 順帶拿掉 `(isAtm ? 48 : 48)` 這個兩邊一樣的死條件：ATM 帳號效期已經改成 2 天
     * （lib/ecpay.ts ExpireDate=2），跟 48 小時對齊，不需要再分兩種。
     * loadOrderTarget 理論上不會落空（同一輪剛從 orders 撈出來），
     * 真的落空時退回 created_at＋保留天數，跟舊行為一樣保守。
     */
    const tgt = loadOrderTarget(o.id);
    const stale = tgt ? shouldFail(tgt) : age >= (payLinkHoldHours(o) ?? 48);

    /*
     * 刷卡沒過所以又下一次、最後買成功的：前面那幾筆是殘骸，不用等滿 24 小時。
     * 顧客已經買到了，庫存卻還被殘骸鎖著，別人看到的是假性售罄。
     * （ATM 已取號的不算殘骸，orderSupersededBy 內部已排除）
     */
    const by = orderSupersededBy(o);
    if (by) {
      const win = db
        .prepare("UPDATE orders SET status='cancelled', pay_note=trim(COALESCE(pay_note,'') || ' ' || ?) WHERE id=? AND status='pending'")
        .run(supersededNote(by), o.id);
      if (win.changes > 0) {
        restoreStock(o.items);
        r.failed++;
        r.notes.push(`訂單 ${o.order_no} → 已由 ${by} 付款成功，這筆自動取消並釋放庫存`);
      }
      continue;
    }
    /*
     * 提醒只在「還沒到逾期取消」的時候寄（贊助早就這樣做了，訂單一直沒有）。
     * 這個先後順序不能顛倒：先提醒再判逾期的話，一筆剛好超時的單會在同一輪裡
     * 先收到「請完成付款」、接著馬上被取消，顧客照著信去付會發現訂單已經不見了。
     */
    if (!stale) {
      if (await maybeRemindOrder(o)) {
        r.reminded++;
        r.notes.push(`訂單 ${o.order_no} → 已寄第 ${o.remind_count} 次待付款提醒`);
      }
      continue;
    }
    /* 拿過金流單號＝顧客確實走進了付款流程。這種單不能當作「沒付款」默默取消，
       因為通知掉包也會長這樣。庫存照樣釋放（否則假性售罄），但要留下醒目標記。 */
    const wentToGateway = Boolean((o.trade_no || "").trim());
    const today = taipeiYMD().iso;
    const note = wentToGateway
      ? `逾期未付款，系統自動取消（${today}），庫存已釋放。⚠️此單曾取得金流單號 ${o.trade_no}，若顧客其實已付款請至金流後台核對後人工復原`
      : `逾期未付款，系統自動取消（${today}），庫存已釋放`;
    const win = db
      .prepare("UPDATE orders SET status='cancelled', pay_note=trim(COALESCE(pay_note,'') || ' ' || ?) WHERE id=? AND status='pending'")
      .run(note, o.id);
    if (win.changes > 0) {
      restoreStock(o.items);
      r.failed++;
      r.notes.push(
        wentToGateway
          ? `⚠️訂單 ${o.order_no} → 逾期取消並回補庫存，但它曾取得金流單號 ${o.trade_no}，請人工到金流後台確認是否其實已付款`
          : `訂單 ${o.order_no} → 逾期未付款自動取消，庫存已回補`
      );
    }
  }
}

/*
 * 刷卡失敗的救援信。對帳每 15 分鐘跑一次，這支就掛在同一輪。
 *
 * 為什麼要延遲而不是失敗當下就寄：有些人失敗後會自己馬上重試並成功
 * （實際看過同一個人三分鐘內試了三次），如果她剛付完款就收到一封
 * 「你的付款沒有完成」，會以為自己被重複扣款。
 * 所以等 15 分鐘，而且寄之前再確認一次這個人有沒有後續成功的訂單。
 *
 * 只救金流回報失敗的。逾期取消、站長手動取消、被後續訂單取代的都不寄：
 * 那些不是「遇到障礙」，寄了沒有意義。
 */
const FAIL_MAIL_AFTER_MIN = 15;
const FAIL_MAIL_MAX_AGE_HOURS = 72;

async function mailFailedOrders(r: ReconcileResult): Promise<void> {
  if (notifyPaused()) return;
  const rows = db
    .prepare(
      `SELECT id,order_no,name,email,COALESCE(phone,'') phone,token,items,subtotal,shipping,total,address,pay_method,pay_note,created_at
       FROM orders
       WHERE status='cancelled' AND fail_mailed=0 AND COALESCE(token,'')<>'' AND COALESCE(gift,0)=0
       ORDER BY id DESC LIMIT 100`
    )
    .all() as (StaleOrderRow & { id: number })[];

  for (const o of rows) {
    const note = o.pay_note || "";
    /* 金流回報失敗，或 48 小時逾期自動取消，都要通知；被後續訂單取代的、站長手動取消的不寄 */
    if (!/付款未完成|付款失敗|授權失敗|LINE Pay 請款失敗|逾期未付款，系統自動取消/.test(note) || note.includes(SUPERSEDED_MARK)) continue;
    const age = hoursSince(o.created_at);
    if (!Number.isFinite(age)) continue;
    if (age * 60 < FAIL_MAIL_AFTER_MIN) continue;      // 還在她可能自己重試的時間內
    if (age > FAIL_MAIL_MAX_AGE_HOURS) continue;       // 太久以前的不追了
    const t = loadOrderTarget(o.id);
    if (!t) continue;
    if (supersededBy(t)) continue;
    if (notifyDryRun()) { await sendNotice(t, "failed"); continue; }
    const win = db.prepare("UPDATE orders SET fail_mailed=1 WHERE id=? AND fail_mailed=0").run(o.id);
    if (win.changes === 0) continue;
    const res = await sendNotice(t, "failed");
    /*
     * 只有「真的試著寄但失敗」才退回旗標讓下一輪再試。
     * 每個管道都是 skipped（信箱被標記寄不到又沒留手機、SMTP 沒設）時退回旗標，
     * 等於每 5 分鐘重跑一次同一筆：三個管道各記一列 notify_log，
     * 72 小時的追蹤窗內同一張單就洗出上千列，提醒中心整個被淹掉。
     * 這種情況沒有任何管道會突然通，就記一次、把旗標留著。
     */
    if (!anySent(res) && !allSkipped(res)) {
      db.prepare("UPDATE orders SET fail_mailed=0 WHERE id=? AND fail_mailed=1").run(o.id);
      continue;
    }
    if (allSkipped(res)) continue;   /* 一則都沒送出去，不能算「已通知」 */
    r.reminded++;
    r.notes.push(`訂單 ${o.order_no} → 付款沒完成，已通知客人換方式`);
  }
}

/*
 * 晚到的 ATM 款項救援（第二道保險）。
 *
 * 第一道是入帳時的 reopenIfAutoFailed：回呼進來就翻回待付款照常入帳。
 * 但幕後取號的回呼本來就會掉（我們回過 500、網路斷線），掉了就沒有人會發現，
 * 因為那筆的狀態已經是 failed，對帳的主查詢只看 pending。
 *
 * 所以這裡另外掃「系統自動判失敗、而且已經取過號」的贊助，主動去問綠界。
 * 範圍刻意收很緊：只看 5 天內、只看有虛擬帳號的（帳號效期 2 天，加上銀行入帳延遲），
 * 一輪最多 50 筆。查到已付款才動，查不到就完全不碰，站長手動改過的也碰不到
 * （備註沒有自動標記）。
 */
/* 晚到 ATM 掃描一小時跑一次就夠：ATM 入帳本來就以小時計，每 5 分鐘對綠界查 50 筆是浪費 */
let lateAtmLastRun = 0;
async function recheckLateAtmSponsors(r: ReconcileResult): Promise<void> {
  if (Date.now() - lateAtmLastRun < 60 * 60_000) return;
  lateAtmLastRun = Date.now();
  if (!ecpayEnabled()) return;
  const since = new Date(Date.now() - 5 * 24 * 3600_000).toISOString();
  const rows = db
    .prepare(
      `SELECT id,trade_no,display_name,amount,COALESCE(last_charge_note,'') note FROM sponsorships
       WHERE status='failed' AND mode='once' AND provider='ecpay'
         AND COALESCE(atm_vaccount,'')<>'' AND COALESCE(trade_no,'')<>'' AND created_at>=?
       ORDER BY id DESC LIMIT 50`
    )
    .all(since) as { id: number; trade_no: string; display_name: string; amount: number; note: string }[];
  for (const row of rows) {
    if (!isSponsorAutoFailed(row.note)) continue;   /* 站長手動判的失敗不碰 */
    try {
      const paid = isGenpayMtn(row.trade_no)
        ? (await queryGenPayTrade(row.trade_no)).tradeStatus === "1"
        : String((await queryTradeInfo(row.trade_no))?.TradeStatus || "") === "1";
      if (!paid) continue;
      if (settleSponsorOncePaid(row.id, row.trade_no, "對帳補正：判失敗之後 ATM 款項才入帳，已翻回並補開發票寄信")) {
        r.paid++;
        r.notes.push(`#${row.id} ${row.display_name || "匿名"} NT.${row.amount} → 逾期後才轉帳，已救回並補開發票寄信`);
      }
    } catch (e) {
      console.error("[reconcile] 晚到 ATM 回查失敗", row.id, e);
    }
  }
}

/* 上線當天跑一次：7 天內失敗、之後沒再贊助成功的，補一次失敗通知（docs/notify-spec.md 第四章） */
async function backfillSponsorFailed(): Promise<void> {
  if (getSetting("notify_backfill_done", "") === "1" || notifyDryRun() || notifyPaused()) return;
  const since = new Date(Date.now() - 7 * 24 * 3600_000).toISOString();
  const rows = db.prepare("SELECT id FROM sponsorships WHERE status='failed' AND mode='once' AND fail_mailed=0 AND created_at>=? ORDER BY id DESC LIMIT 100").all(since) as { id: number }[];
  let n = 0;
  for (const row of rows) { if (await notifySponsorFailed(row.id)) n++; }
  setSetting("notify_backfill_done", "1");
  if (n) console.log(`[notify] 補寄既有失敗贊助 ${n} 筆`);
}

/* 對一次帳。回傳結果供後台顯示與排程記 log */
export async function reconcilePending(): Promise<ReconcileResult> {
  const r: ReconcileResult = { checked: 0, paid: 0, failed: 0, reminded: 0, skipped: 0, notes: [] };
  const rows = db
    .prepare(
      `SELECT id,mode,amount,display_name,email,status,provider,pay_method,pay_token,trade_no,
              credit_token,ga_cid,ga_sid,ga_snum,created_at,remind_at,remind_count,atm_bank,atm_vaccount,atm_expire,COALESCE(phone,'') phone
       FROM sponsorships WHERE status='pending' ORDER BY id DESC LIMIT 200`
    )
    .all() as PendingRow[];

  for (const sp of rows) {
    const age = hoursSince(sp.created_at);
    if (age * 60 < GRACE_MIN) continue;           // 可能還在金流頁上
    if (age > MAX_AGE_DAYS * 24) continue;        // 太舊就不追了
    if (!sp.trade_no) {
      /* 連跳轉到金流頁都沒發生（送出表單後就離開），沒有單號可查 */
      await handleUnpaid(sp, r, "從未進入金流頁", FAIL_AFTER_HOURS);
      r.checked++;
      continue;
    }
    r.checked++;
    try {
      if (sp.provider === "linepay") {
        if (!linepayEnabled()) { r.skipped++; continue; }
        await checkLinePay(sp, r);
      } else if (sp.provider === "ecpay") {
        if (!ecpayEnabled()) { r.skipped++; continue; }
        if (sp.mode === "monthly") await checkEcpayPeriod(sp, r);
        else await checkEcpayOnce(sp, r);
      } else if (sp.provider === "newebpay") {
        if (!newebpayEnabled()) { r.skipped++; continue; }
        /* 藍新定期定額委託沒有規格提供查詢 API（只有建立委託／解約兩支），
           首期還卡在 pending 的只能等 NotifyURL 或使用者放棄，這裡不介入查詢，
           免得拿委託建立用的 MerOrderNo 去打單筆 MPG 的交易查詢 API 而查無此筆 */
        if (sp.mode === "monthly") { r.skipped++; continue; }
        await checkNewebpaySponsor(sp, r);
      } else {
        r.skipped++; // Portaly／PayUni 有自己的回呼，這裡不介入
      }
    } catch (e) {
      console.error("[reconcile] 檢查失敗", sp.id, e);
      r.skipped++;
    }
  }

  /* 商店訂單：TapPay 回查補正＋逾期取消回補庫存 */
  holdCache.clear();   /* 每輪重新讀，站長改了保留天數下一輪就生效 */
  await cleanupStaleOrders(r);
  /* 保留天數到期還沒被用掉的付款連結：把預扣的庫存放回去，
     否則一條沒人付的死連結會永遠鎖著那批貨，別人看到的是假性售罄 */
  await mailFailedOrders(r);
  /* 判失敗之後才進來的 ATM 款項：主查詢只看 pending，這筆已經是 failed，只有這裡看得到 */
  await recheckLateAtmSponsors(r).catch((e) => console.error("[reconcile] 晚到 ATM 掃描", e));
  /* 深夜排進佇列的 LINE／簡訊，早上 8 點之後補送 */
  await flushQueue().catch((e) => console.error("[notify] 佇列", e));
  await backfillSponsorFailed().catch((e) => console.error("[notify] 補寄", e));
  const rel = releaseExpiredPayLinks();
  if (rel.released > 0) r.notes.push(...rel.notes);

  if (r.paid || r.failed || r.reminded) {
    console.log(`[reconcile] 檢查 ${r.checked} 筆：補正已付款 ${r.paid}、標記失敗 ${r.failed}、寄出提醒 ${r.reminded}`);
  }
  return r;
}

/* 每 5 分鐘自動對帳一次（2026-09-04 起，原本 15 分鐘）。
   旗標掛在 globalThis 而不是模組變數：模組要是被打包成兩份載入，
   模組層級的 started 各算各的，排程就會被掛上兩份。 */
const g = globalThis as unknown as { __yoReconcileTimer?: ReturnType<typeof setInterval>; __yoReconcileRunning?: boolean };
export function startReconcileLoop(): void {
  if (g.__yoReconcileTimer) return;
  const tick = () => {
    /*
     * 上一輪還沒跑完就不要開下一輪。一輪要逐筆去問綠界、TapPay、LINE Pay，
     * 200 筆待付款遇到金流端變慢時很容易超過 5 分鐘，兩輪疊在一起會對同一筆
     * 同時查詢、同時寄提醒（搶佔式 UPDATE 擋得住重複入帳，但擋不住白白多打的 API）。
     * 旗標跟計時器一樣掛在 globalThis：模組被打包成兩份載入時才不會各算各的。
     */
    if (g.__yoReconcileRunning) { console.warn("[reconcile] 上一輪還在跑，這一輪跳過"); return; }
    g.__yoReconcileRunning = true;
    void reconcilePending()
      .catch((e) => console.error("[reconcile] 排程失敗", e))
      .finally(() => { g.__yoReconcileRunning = false; });
    /* 逾期未出警報搭同一班排程；一天最多寄一輪，函式自己管戳記 */
    void import("./notify").then((m) => m.notifyLateShipments()).catch((e) => console.error("[late-alert] 排程失敗", e));
  };
  setTimeout(tick, 90_000).unref?.();          // 開站 90 秒後先跑一次
  /* 通知整合：10 分鐘那一則要準，改成每 5 分鐘 */
  g.__yoReconcileTimer = setInterval(tick, 5 * 60_000);
  g.__yoReconcileTimer.unref?.();
}
