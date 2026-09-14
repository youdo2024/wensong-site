import db, { getSetting, setSetting } from "./db";
import { NPOBAN_RE, npobanFormatOk } from "./npoban-code";

/*
 * 電子發票捐贈碼（愛心碼）。
 *
 * 為什麼要自己存一份：不是因為光貿不驗——實測（tests/invoice-rescue.ts）光貿
 * 其實會驗，不在財政部清單的碼會被回「3040137 NPOBAN 不存在」。
 * 有這份清單是為了兩件事，而且都在「送出之前」：
 *
 *   1. 客人打完碼，當場看到「財團法人台灣兒童暨家庭扶助基金會」。
 *      捐贈是不可逆的，讓他在按下付款前確認捐給誰，比事後補救便宜太多。
 *   2. 打錯的碼在結帳頁就擋下來。靠光貿擋的話，時序是「錢先收了、
 *      發票被拒、降級補開成寄 Email」——客人以為自己捐了，其實沒有。
 *
 * 資料來源：財政部「受捐贈機關或團體捐贈碼清單」開放資料，每月更新，
 * 政府資料開放授權條款第 1 版。2,022 筆、107KB，直接進資料庫。
 *
 * 為什麼放資料庫而不是每次打財政部 API：結帳是全站最不能出事的一頁，
 * 不該把它綁在政府網站的可用性上。而且客人打字時要即時顯示單位名稱，
 * 每敲一個鍵打一次外部 API 既慢又沒必要。
 *
 * 種子檔 lib/data/npoban-seed.ts 跟著 git 走（正式站的建置容器沒有掛載磁碟，
 * 每次都是空資料庫，沒有種子檔就等於沒有清單）；之後的更新由站長在後台按鈕觸發，
 * 寫進資料庫的 volume，重新部署不會被種子檔蓋回去。
 */

/* 純規則（格式、預設碼）放在 npoban-code.ts：那支沒有任何 import，
   結帳表單那個 client component 才能安全地用到同一份定義 */
export { NPOBAN_RE, DEFAULT_NPOBAN, DEFAULT_NPOBAN_NAME, npobanFormatOk } from "./npoban-code";

/* 查名稱。查無此碼回 null——呼叫端要把它當成「擋下來」而不是「先送出去再說」 */
export function npobanName(code: string): string | null {
  const c = String(code || "").trim();
  if (!npobanFormatOk(c)) return null;
  const row = db.prepare("SELECT name FROM npoban WHERE code=?").get(c) as { name: string } | undefined;
  return row?.name || null;
}

export function npobanCount(): number {
  return (db.prepare("SELECT COUNT(*) AS n FROM npoban").get() as { n: number }).n;
}

/* 清單的來源日期（種子檔的抓取日，或站長最後一次按更新的時間） */
export function npobanUpdatedAt(): string {
  return getSetting("npoban_updated_at", "");
}

/* 財政部開放資料的 CSV 下載網址（政府資料開放平臺 dataset 31868） */
const SOURCE_CSV =
  "https://dataset.einvoice.nat.gov.tw/ods/portal/ODS303W/download/3886F055-EB77-4DF9-98E2-F3F49A7D3434/1/8B227A99-042A-4903-8B34-5715442A227D/0/?fileType=csv";

/*
 * 逐字元解析一列 CSV：欄位裡可能有逗號與雙引號（團體名稱真的會出現），
 * 用 split(",") 會把一列切錯，而切錯的症狀是「某些單位查不到」，很難發現。
 */
function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else quoted = false;
      } else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

export function parseNpobanCsv(text: string): Record<string, string> {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return {};
  const head = parseCsvLine(lines[0]).map((h) => h.trim());
  const iCode = head.findIndex((h) => h.includes("捐贈碼"));
  const iName = head.findIndex((h) => h.includes("名稱"));
  /* 欄位名稱對不上就整批放棄。硬用欄位順序猜，猜錯會把整份清單寫成垃圾，
     而且是靜靜地寫進去——比更新失敗嚴重得多 */
  if (iCode < 0 || iName < 0) return {};
  const out: Record<string, string> = {};
  for (const line of lines.slice(1)) {
    const cols = parseCsvLine(line);
    const code = (cols[iCode] || "").trim();
    const name = (cols[iName] || "").trim();
    if (NPOBAN_RE.test(code) && name) out[code] = name;
  }
  return out;
}

/*
 * 到財政部重抓一份，整批換掉。
 *
 * 幾個刻意的保險：
 * - 抓到的筆數少於現有的一半就拒絕寫入。對方改版、回傳錯誤頁、或只回一部分時，
 *   舊清單至少還是對的；把清單洗成 3 筆會讓所有捐贈碼都驗不過。
 * - 整批寫入放在一個 transaction 裡，中途失敗不會留下半份清單。
 */
export async function refreshNpoban(): Promise<{ ok: boolean; count: number; msg: string }> {
  const before = npobanCount();
  let text = "";
  try {
    const res = await fetch(SOURCE_CSV, { signal: AbortSignal.timeout(60_000), cache: "no-store" });
    if (!res.ok) return { ok: false, count: before, msg: `財政部回 HTTP ${res.status}，清單維持原樣` };
    text = await res.text();
  } catch (e) {
    return { ok: false, count: before, msg: `連不上財政部（${e instanceof Error ? e.message : "未知"}），清單維持原樣` };
  }

  const map = parseNpobanCsv(text);
  const n = Object.keys(map).length;
  if (n === 0) return { ok: false, count: before, msg: "解析不出任何捐贈碼（對方格式可能改了），清單維持原樣" };
  if (before > 0 && n < before / 2)
    return { ok: false, count: before, msg: `只抓到 ${n} 筆、原本有 ${before} 筆，差太多不敢覆蓋，清單維持原樣` };

  const tx = db.transaction((rows: [string, string][]) => {
    db.prepare("DELETE FROM npoban").run();
    const ins = db.prepare("INSERT INTO npoban (code,name) VALUES (?,?)");
    for (const [code, name] of rows) ins.run(code, name);
  });
  tx(Object.entries(map));
  setSetting("npoban_updated_at", new Date().toISOString().slice(0, 10));
  return { ok: true, count: n, msg: `已更新，共 ${n} 筆（原本 ${before} 筆）` };
}
