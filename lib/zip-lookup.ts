import { TW_ZIP, TW_COUNTIES } from "./tw-zip";

/*
 * 從自由文字地址反推 3 碼郵遞區號。
 *
 * 為什麼需要：地址有四條進站的路（結帳、贈品單、企業多地址、後台手改），
 * 只有結帳那條會自動帶郵遞區號，其他三條全靠人記得填。
 * 出貨夥伴抄託運單時，沒有郵遞區號就要當場查，一天十幾單就很煩。
 *
 * ── 紅線：寧可空白，不可猜錯 ──
 *
 * 只有「縣市」與「鄉鎮市區」兩個都在地址裡明確比中，才回傳 3 碼。
 * 缺一個就回 null，讓畫面標「查無」請人工看。
 * 例：「台中市忠明南路817號」沒寫區，而忠明南路橫跨西區、南區、南屯區，
 * 猜一個就是把貨往錯的分揀場送。站長明確要求：系統給的數字必須保證正確。
 *
 * 比對順序是先縣市、再從縣市後面找區。「東區」在新竹、台中、嘉義、台南
 * 都存在，先鎖縣市才不會張冠李戴。區名一定帶「區／鄉／鎮／市」字尾，
 * 路名不會撞（三民路不含「三民區」三個字）。
 *
 * 資料表是 lib/tw-zip.ts（371 區，結帳頁本來就在用同一份），
 * 鍵一律用「臺」，所以比對前把地址的「台」正規化成「臺」。
 */

export function deriveZip(address: string | null | undefined): string | null {
  const norm = String(address || "").replace(/台/g, "臺");
  let city = "";
  let cityAt = -1;
  for (const c of TW_COUNTIES) {
    const at = norm.indexOf(c);
    if (at !== -1 && (cityAt === -1 || at < cityAt)) {
      city = c;
      cityAt = at;
    }
  }
  if (!city) return null;

  const rest = norm.slice(cityAt + city.length);
  const districts = TW_ZIP[city];
  let best = "";
  let bestAt = -1;
  for (const d of Object.keys(districts)) {
    const at = rest.indexOf(d);
    if (at !== -1 && (bestAt === -1 || at < bestAt)) {
      best = d;
      bestAt = at;
    }
  }
  return best ? districts[best] : null;
}

/* 地址開頭若有人寫了郵遞區號（3 到 6 碼都有人寫），取前 3 碼 */
export function writtenZip(address: string | null | undefined): string | null {
  const m = String(address || "").match(/^\s*(\d{3})\d{0,3}\b/);
  return m ? m[1] : null;
}

export type ZipDisplay = {
  /* 抄託運單用的完整地址：3 碼在最前面（推得出或有人寫過的話） */
  text: string;
  /* 要在地址旁邊顯示的提醒，空字串代表沒事 */
  note: "" | `⚠ 原寫 ${string}` | "⚠ 查無郵遞區號";
};

/*
 * 組出顯示用的地址。優先序：站長手動填的 > 系統推導 > 客人自己寫的。
 *
 * - 手動值存在：以它為準，開頭原寫的數字換成手動值，不標任何警告
 *  （站長改了就是定案，系統不再有意見）
 * - 推導成功且與客人寫的一致：地址原樣，不重複加
 * - 推導成功但客人寫的不同：顯示推導值，標「⚠ 原寫 xxx」讓站長裁決
 *  （推導來自縣市＋區兩個字，比憑記憶寫的數字可靠，但最終裁量權在人）
 * - 推導不出但客人有寫：照客人的，不標——有數字可抄就不吵
 * - 兩者皆無：標「⚠ 查無郵遞區號」，出貨的人自己查一下
 */
export function zipDisplay(address: string | null | undefined, manual?: string | null): ZipDisplay {
  const raw = String(address || "").trim();
  const written = writtenZip(raw);
  /* 把開頭的郵遞區號（含 3+2、3+3 寫法）拿掉後的純地址 */
  const bare = written ? raw.replace(/^\s*\d{3,6}[\s,，]*/, "") : raw;

  const man = String(manual || "").trim();
  if (/^\d{3}$/.test(man)) return { text: `${man} ${bare}`, note: "" };

  const derived = deriveZip(raw);
  if (derived) {
    if (!written) return { text: `${derived} ${bare}`, note: "" };
    if (written === derived) return { text: raw, note: "" };
    return { text: `${derived} ${bare}`, note: `⚠ 原寫 ${written}` };
  }
  if (written) return { text: raw, note: "" };
  return { text: raw, note: "⚠ 查無郵遞區號" };
}
