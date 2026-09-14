/* 台北時區（UTC+8）的月份工具。
   資料庫的 created_at 存的是 UTC ISO 字串，直接用字串前綴比對會把台灣時間
   凌晨 0～8 點算成上個月，所以這裡把「台北的月初／月底」換算成 UTC 邊界再比。 */

export function taipeiNow(): Date {
  return new Date(Date.now() + 8 * 3600 * 1000);
}

/* 本月（台北）的 UTC 起訖 ISO 字串，以及 2026-07 這種年月標籤 */
export function monthRange(): { start: string; end: string; ym: string; label: string } {
  const now = taipeiNow();
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const start = new Date(Date.UTC(y, m, 1) - 8 * 3600 * 1000).toISOString();
  const end = new Date(Date.UTC(y, m + 1, 1) - 8 * 3600 * 1000).toISOString();
  const mm = String(m + 1).padStart(2, "0");
  return { start, end, ym: `${y}-${mm}`, label: `${y} 年 ${m + 1} 月` };
}

/* 指定時刻（毫秒）在台北是哪一天。抽出來是為了讓測試給得了固定時刻，
   taipeiYMD 只吃相對位移，跨日那一段永遠測不到 */
export function taipeiYMDAt(nowMs: number): { short: string; iso: string } {
  const d = new Date(nowMs + 8 * 3600 * 1000);
  const y = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return { short: `${String(y).slice(-2)}${mm}${dd}`, iso: `${y}-${mm}-${dd}` };
}

/* 台北日期字串 YYMMDD（訂單編號用）與 YYYY-MM-DD（備註、繳費期限用） */
export function taipeiYMD(offsetMs = 0): { short: string; iso: string } {
  return taipeiYMDAt(Date.now() + offsetMs);
}

/*
 * 「到某一天為止有效」的日期是否已經過了（用台北的日曆判斷）。
 *
 * 折扣碼的 expires_at 是站長在後台填的台北日期，意思是「那一天還能用」。
 * 原本拿 new Date().toISOString() 的日期去比，那是 UTC 的今天：
 * 台灣時間凌晨 0 點到 8 點，UTC 還停在昨天，於是昨天到期的碼在那八小時裡照樣打折。
 * 檔期最後一天的半夜正是搶購最兇的時候，這八小時的錢是實打實少收的。
 */
export function taipeiDateExpired(expiresAt: string | null | undefined, nowMs: number = Date.now()): boolean {
  const s = String(expiresAt || "").trim();
  if (!s) return false; /* 沒填就是不過期 */
  return s < taipeiYMDAt(nowMs).iso;
}

/*
 * 加一個月，且不會溢位到下個月。
 *
 * 原本 payment-sync.ts 與 recurring.ts 各有一份一模一樣的實作，
 * 改一邊不會動到另一邊（扣款日的計算分散在兩處是很難察覺的錯）。抽到這裡共用。
 *
 * 直接 setMonth(+1) 的話，1/31 會變成 3/2 或 3/3（2 月沒有 31 號，JS 會往後滾），
 * 所以先把日子壓到 1 號再換月，最後取「原本的日」與「該月最後一日」的較小值。
 */
export function addOneMonth(from: Date): Date {
  const d = new Date(from);
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + 1);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, last));
  return d;
}
