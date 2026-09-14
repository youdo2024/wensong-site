import db from "./db";

/*
 * 付款成功率統計。
 *
 * 為什麼要做：站長訂了兩個門檻（Apple Pay 再 5 次嘗試低於 50% 就關、
 * 兩週後訂單數掉超過兩成就回頭）。後台如果看不到對應的數字，
 * 那兩個門檻就只是講講而已，不會有人真的去對照。
 *
 * 統計規則：
 *   分母＝「已經有結果」的訂單，也就是已付款與已取消，不含還在待付款的。
 *   待付款的還沒有結果，算進去只會讓數字看起來比實際差。
 *   被後續訂單取代而取消的算失敗，因為那次嘗試確實沒成功，
 *   雖然那個人最後買到了。這樣才看得出「一次就成功」的比例。
 */

export type Bucket = { key: string; ok: number; total: number; rate: number; revenue: number };

type Row = { pay_method: string; env: string; status: string; total: number };

function bucket(rows: Row[], keyOf: (r: Row) => string): Bucket[] {
  const m = new Map<string, { ok: number; total: number; revenue: number }>();
  for (const r of rows) {
    const k = keyOf(r) || "（未記錄）";
    if (!m.has(k)) m.set(k, { ok: 0, total: 0, revenue: 0 });
    const b = m.get(k)!;
    b.total++;
    if (r.status === "paid" || r.status === "shipped" || r.status === "done") {
      b.ok++;
      b.revenue += r.total;
    }
  }
  return [...m]
    .map(([key, v]) => ({ key, ok: v.ok, total: v.total, rate: v.total ? v.ok / v.total : 0, revenue: v.revenue }))
    .sort((a, b) => b.total - a.total);
}

function load(sinceIso?: string): Row[] {
  const sql =
    "SELECT pay_method,env,status,total FROM orders WHERE status IN ('paid','shipped','done','cancelled')" +
    (sinceIso ? " AND created_at>=?" : "");
  return (sinceIso ? db.prepare(sql).all(sinceIso) : db.prepare(sql).all()) as Row[];
}

export function payStats(days?: number) {
  const since = days ? new Date(Date.now() - days * 86400000).toISOString() : undefined;
  const rows = load(since);
  return {
    n: rows.length,
    byPay: bucket(rows, (r) => r.pay_method),
    byEnv: bucket(rows, (r) => (r.env === "fb" ? "FB 內建" : r.env === "ig" ? "IG 內建" : r.env === "line" ? "LINE 內建" : r.env === "wv" ? "其他 App 內建" : "一般瀏覽器")),
  };
}

/* 每日訂單數。改動之後如果總量掉下來，代表有人因為看不到想要的付款方式而走掉，
   那是這次改動唯一沒有安全網的地方，所以一定要看得到。 */
export function dailyOrders(days = 14): { day: string; n: number; paid: number }[] {
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const rows = db
    .prepare("SELECT created_at,status FROM orders WHERE created_at>=? ORDER BY created_at")
    .all(since) as { created_at: string; status: string }[];
  const m = new Map<string, { n: number; paid: number }>();
  for (const r of rows) {
    /* 用台灣時間切日，否則凌晨到早上八點的訂單會被算到前一天 */
    const day = new Date(new Date(r.created_at).getTime() + 8 * 3600 * 1000).toISOString().slice(5, 10);
    if (!m.has(day)) m.set(day, { n: 0, paid: 0 });
    const b = m.get(day)!;
    b.n++;
    if (r.status !== "cancelled" && r.status !== "pending") b.paid++;
  }
  return [...m].map(([day, v]) => ({ day, ...v }));
}
