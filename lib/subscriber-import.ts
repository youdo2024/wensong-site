import db, { getSetting, setSetting } from "./db";
import { checkEmail } from "./email-typo";

/*
 * 訂閱名單匯入（ManyChat 收到的名單放在 Google 試算表）。
 *
 * 兩條路都走同一個 importEmails()：
 *   · 站長從試算表複製一整欄貼進後台
 *   · 後台存一條「發布到網路」的 CSV 網址，按同步或排程自動抓
 *
 * 最重要的一條規則寫在下面：退訂過的人不會被重新加回來。
 */

export type ImportResult = {
  added: number;
  existed: number;
  skippedUnsub: number;
  invalid: string[];
};

/* 從任意文字裡撈 email：CSV、一行一個、逗號分隔都吃得下 */
export function extractEmails(raw: string): string[] {
  const found = String(raw || "").match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) || [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const e of found) {
    const v = e.trim().toLowerCase();
    if (!seen.has(v)) { seen.add(v); out.push(v); }
  }
  return out;
}

export function importEmails(raw: string, source = "manychat"): ImportResult {
  const list = extractEmails(raw);
  const res: ImportResult = { added: 0, existed: 0, skippedUnsub: 0, invalid: [] };
  const now = new Date().toISOString();
  const find = db.prepare("SELECT id, COALESCE(unsubscribed_at,'') unsub FROM subscribers WHERE email=?");
  const ins = db.prepare("INSERT INTO subscribers (email,name,source,created_at) VALUES (?,?,?,?)");

  const tx = db.transaction(() => {
    for (const email of list) {
      /* 明顯打錯的網域先擋掉（gamil.com 之類），不要匯進去之後才一封封退信 */
      if (checkEmail(email)) { res.invalid.push(email); continue; }
      const cur = find.get(email) as { id: number; unsub: string } | undefined;
      if (cur) {
        /*
         * 退訂過的人絕對不能因為再匯入一次就被加回來。
         *
         * ManyChat 那張表是累積的，退訂的人還留在裡面；每次同步都把他加回來的話，
         * 他會一直收到信、一直退訂，最後按下「檢舉為垃圾郵件」。
         * 那一下傷的是整個網域的信譽，連訂單確認信都會開始進垃圾桶。
         */
        if (cur.unsub) res.skippedUnsub++;
        else res.existed++;
        continue;
      }
      ins.run(email, "", source, now);
      res.added++;
    }
  });
  tx();
  return res;
}

/*
 * 從 Google 試算表的「發布到網路 → CSV」網址抓一次。
 *
 * 用發布網址而不是 Sheets API：API 要開 GCP 專案、建服務帳號、下載金鑰檔、
 * 再把試算表分享給那個帳號，四個步驟每一步都可能卡住；而發布網址是
 * 試算表選單裡按兩下就有，也不需要任何金鑰。
 * 代價是那份試算表變成「知道網址的人都看得到」，所以表裡不該有敏感欄位。
 */
export function sheetCsvUrl(): string {
  return getSetting("manychat_sheet_url", "").trim();
}

export async function fetchSheet(url: string): Promise<{ ok: boolean; text: string; error: string }> {
  const u = url.trim();
  /* 只接受 Google 試算表的網址：這個欄位由後台填入，
     但仍不該變成「叫伺服器去抓任意網址」的入口 */
  if (!/^https:\/\/docs\.google\.com\/spreadsheets\//.test(u))
    return { ok: false, text: "", error: "網址必須是 docs.google.com/spreadsheets 開頭" };
  try {
    const res = await fetch(u, { signal: AbortSignal.timeout(20_000), cache: "no-store", redirect: "follow" });
    if (!res.ok) return { ok: false, text: "", error: `抓取失敗 HTTP ${res.status}` };
    const text = await res.text();
    /* 沒發布的試算表會回一頁 HTML 登入頁，不是 CSV。抓到 HTML 就是設定錯了 */
    if (/<html/i.test(text.slice(0, 300)))
      return { ok: false, text: "", error: "抓到的是網頁不是 CSV，多半是還沒「發布到網路」或選錯格式" };
    return { ok: true, text, error: "" };
  } catch (e) {
    return { ok: false, text: "", error: e instanceof Error ? e.message : "unknown" };
  }
}

/* ── 上一次同步的結果（站長看得到，排程與手動都記）── */

/*
 * 為什麼要留這一段紀錄。
 *
 * 站長 2026-09-07 反映「我不知道名單有沒有在進來」。同步以前只在按下按鈕的
 * 那一瞬間用網址參數回一句話，重新整理就沒了，排程跑的那次更是誰都看不到，
 * 失敗也只進 console。所以把「什麼時候、誰跑的、進了幾筆、錯在哪」寫進 settings，
 * 匯入區直接印出來，站長掃一眼就知道要不要自己按一次。
 */
export type SyncMode = "auto" | "manual";
export type SyncState = {
  at: string;              /* ISO（UTC），沒跑過是空字串 */
  mode: SyncMode;
  result: ImportResult | null;  /* 成功才有 */
  error: string;           /* 失敗才有 */
};

export const SYNC_KEY_AT = "sheet_sync_last_at";
export const SYNC_KEY_MODE = "sheet_sync_last_mode";
export const SYNC_KEY_RESULT = "sheet_sync_last_result";
export const SYNC_KEY_ERROR = "sheet_sync_last_error";
/* 排程用：最後一次「成功」的台北日期，一天只自動跑一次靠它 */
export const SYNC_KEY_DAY = "sheet_sync_last_day";

export function readSyncState(): SyncState {
  const at = getSetting(SYNC_KEY_AT, "");
  const raw = getSetting(SYNC_KEY_RESULT, "");
  let result: ImportResult | null = null;
  if (raw) {
    try { result = JSON.parse(raw) as ImportResult; } catch { result = null; }
  }
  return {
    at,
    mode: getSetting(SYNC_KEY_MODE, "manual") === "auto" ? "auto" : "manual",
    result,
    error: getSetting(SYNC_KEY_ERROR, ""),
  };
}

export function writeSyncState(s: SyncState): void {
  setSetting(SYNC_KEY_AT, s.at);
  setSetting(SYNC_KEY_MODE, s.mode);
  setSetting(SYNC_KEY_RESULT, s.result ? JSON.stringify(s.result) : "");
  setSetting(SYNC_KEY_ERROR, s.error);
}

/*
 * 給後台印的那一行。純函式，測試直接餵資料就能驗，不用先跑一次同步。
 * 失敗的時候一定要把原因原封不動印出來：站長要拿那句話去判斷是網址貼錯
 * 還是試算表沒發布，只說「失敗」等於沒說。
 */
export function syncSummary(s: SyncState, fmt: (iso: string) => string): string {
  if (!s.at) return "還沒同步過。按下面那顆鈕就會抓一次，之後每天凌晨 3 點也會自動抓。";
  const who = s.mode === "auto" ? "自動" : "手動";
  const when = `上次同步：${fmt(s.at)}（${who}）`;
  if (s.error) return `${when} 失敗：${s.error}`;
  const r = s.result;
  if (!r) return `${when} 完成`;
  const invalid = r.invalid.length ? `、格式有問題 ${r.invalid.length}` : "";
  return `${when} 新增 ${r.added}、已存在 ${r.existed}、退訂過所以跳過 ${r.skippedUnsub}${invalid}`;
}

/*
 * 抓一次試算表並匯入。手動那顆鈕與每天的排程都走這裡，
 * 所以兩邊記的東西一模一樣，站長不會看到「手動有紀錄、自動沒紀錄」。
 * 這個函式不丟例外：排程呼叫它，任何一種失敗都只能是回傳值，不能把 process 弄倒。
 */
export async function runSheetSync(mode: SyncMode): Promise<{ ok: boolean; msg: string; result: ImportResult | null }> {
  const at = new Date().toISOString();
  try {
    const url = sheetCsvUrl();
    /* 沒填網址就什麼都不做，連紀錄都不寫：那不是失敗，是還沒設定 */
    if (!url) return { ok: false, msg: "還沒填試算表網址", result: null };
    const f = await fetchSheet(url);
    if (!f.ok) {
      writeSyncState({ at, mode, result: null, error: f.error });
      return { ok: false, msg: f.error, result: null };
    }
    const r = importEmails(f.text, "manychat");
    writeSyncState({ at, mode, result: r, error: "" });
    return { ok: true, msg: `新增 ${r.added}、已存在 ${r.existed}、退訂過所以跳過 ${r.skippedUnsub}`, result: r };
  } catch (e) {
    const why = e instanceof Error ? e.message : String(e);
    try { writeSyncState({ at, mode, result: null, error: why }); } catch { /* 連紀錄都寫不進去就算了，不能再往外丟 */ }
    return { ok: false, msg: why, result: null };
  }
}
