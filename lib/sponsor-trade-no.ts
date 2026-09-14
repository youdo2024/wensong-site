import db from "./db";

/*
 * 贊助的金流單號歷史（sponsor_trade_nos）。
 *
 * 為什麼需要這一支：sponsorships.trade_no 只有一欄，
 * 每次進付款頁重生單號、換付款方式、幕後取號、LINE Pay 重新建立交易，都會把它覆寫掉。
 * 但綠界的 ATM 虛擬帳號「不會因為顧客改了付款方式就失效」。
 * 真實會發生的事：先取 ATM 帳號 → 改成刷卡（trade_no 被換成新的）→ 過兩天還是照舊帳號轉帳。
 * 綠界拿舊的 MerchantTradeNo 打回呼，全站沒有任何一列比對得到，
 * 回呼安靜地回 1|OK，錢進了金流商的帳、贊助紀錄停在待付款、站長什麼都不會知道。
 *
 * 商店訂單沒有這個病：訂單的單號可以用 orderNoFromMtn 還原回訂單編號。
 * 贊助的單號還原不回身分，所以只能把用過的每一組都記下來。
 */

/*
 * 記一組單號。呼叫端每次寫 sponsorships.trade_no 都要一起呼叫，
 * 能包進同一個 transaction 就包（寫了單號卻沒記歷史＝這筆又回到出事前的狀態）。
 * INSERT OR IGNORE：同一組單號重複寫（例如重進付款頁沿用舊號）不算錯，靜靜跳過。
 */
export function rememberSponsorTradeNo(sponsorshipId: number, tradeNo: string): void {
  const no = String(tradeNo || "").trim();
  if (!sponsorshipId || !no) return;
  db.prepare(
    "INSERT OR IGNORE INTO sponsor_trade_nos (sponsorship_id,trade_no,created_at) VALUES (?,?,?)"
  ).run(sponsorshipId, no, new Date().toISOString());
}

/* 一筆贊助用過的所有單號，新的在前面。後台的診斷用，超過一組才值得顯示 */
export function sponsorTradeNoHistory(sponsorshipId: number): string[] {
  return (
    db
      .prepare("SELECT trade_no FROM sponsor_trade_nos WHERE sponsorship_id=? ORDER BY id DESC")
      .all(sponsorshipId) as { trade_no: string }[]
  ).map((r) => r.trade_no);
}

/*
 * 回呼比對：先用現行 trade_no 精準比對（跟以前完全一樣的行為），
 * 對不到才回頭查歷史。stale=true 代表「錢是打在已經被換掉的那組單號上」。
 *
 * 歷史那一段刻意不限定 provider：單號本身就是身分（YO<id>T…、YO<id>B…、YOL<id>T… 都帶著贊助編號），
 * 而顧客常常是「先綠界取號、後來改用 LINE Pay」，這種人的 provider 已經不是 ecpay 了，
 * 但舊的綠界虛擬帳號還活著、錢還是會從綠界進來，限定 provider 只會把最該救的那種人擋在外面。
 * monthly 那個限制要留：定期定額的回呼只該落在每月方案上。
 */
export type SponsorTradeNoMatch = { id: number; stale: boolean };

export function sponsorByTradeNo(mtn: string, opt: { monthly?: boolean } = {}): SponsorTradeNoMatch | undefined {
  const no = String(mtn || "").trim();
  if (!no) return undefined;

  const exact = db
    .prepare(
      `SELECT id FROM sponsorships WHERE trade_no=? AND provider='ecpay'${opt.monthly ? " AND mode='monthly'" : ""}`
    )
    .get(no) as { id: number } | undefined;
  if (exact) return { id: exact.id, stale: false };

  const past = db
    .prepare(
      `SELECT h.sponsorship_id AS id FROM sponsor_trade_nos h
        JOIN sponsorships s ON s.id=h.sponsorship_id
       WHERE h.trade_no=?${opt.monthly ? " AND s.mode='monthly'" : ""}
       ORDER BY h.id DESC LIMIT 1`
    )
    .get(no) as { id: number } | undefined;
  return past ? { id: past.id, stale: true } : undefined;
}

/*
 * 舊單號入帳時該怎麼辦。回呼那兩支（/api/ecpay/return、/api/ecpay/period）共用同一個判斷，
 * 免得兩邊各寫各的然後漂開。
 *
 * settle＝這筆還在待付款，就是單純的晚到轉帳，照一般付款流程入帳就好。
 * duplicate＝已經 paid／active，錢收過一次了，這是重複付款。
 *   絕對不可以再入帳一次：發票會重複開（作廢比漏帳麻煩得多）、感謝信會重寄、
 *   贊助的狀態與欄位一個都不該被動到。系統只記錄與通知，退款由站長人工處理。
 */
export function staleSponsorPaymentAction(status: string): "settle" | "duplicate" {
  return status === "paid" || status === "active" ? "duplicate" : "settle";
}
