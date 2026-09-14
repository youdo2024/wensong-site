import { normalizePhone, phoneUsable } from "./phone";
import { isCvsMethod } from "./cvs";

/*
 * 把「一整段抄來的名單」拆成一位一位的收件人。
 *
 * 為什麼需要：站長的名單不是從表單來的，是從 LINE、Email、Google 表單
 * 複製出來的一坨文字，每一位的欄位順序都不一樣——有人姓名在第一行，
 * 有人先寫「姓名：」，有人把電話夾在地址中間。手動一格一格敲十八位，
 * 敲到第十二位就會開始出錯，而出錯的代價是貨寄到別人家。
 *
 * 拆法：空白行分隔「一位」，每一行看得出來是什麼就放到哪個欄位。
 * 判斷順序刻意由「幾乎不會誤判」排到「最後兜底」：
 *   有 @ 一定是信箱 → 有店號／門市一定是超商 → 整行只有數字和符號是電話
 *   → 有路街號里巷樓是地址 → 剩下的才當姓名。
 *
 * 拆完不會直接送出，是填進表單讓站長逐格看過。解析錯了看得見，
 * 這跟「貼上就直接建單」是兩件事——後者錯了要等到出貨才知道。
 */

export type ParsedRow = {
  name: string;
  phone: string;
  email: string;
  qty: string;
  shipMethod: string;
  address: string;
  storeName: string;
  storeNo: string;
  /* 解析時覺得怪但沒把握的地方，顯示在那一列上面提醒站長自己看 */
  warn: string;
};

const emptyRow = (qty: string): ParsedRow => ({
  name: "", phone: "", email: "", qty, shipMethod: "宅配",
  address: "", storeName: "", storeNo: "", warn: "",
});

/* 分隔線、出貨週那類標題行，不是資料 */
const NOISE = /^[\s\-—─_=＿、。·・]*$/;
const HEADER = /(出貨|寄出|配送)\s*[:：]?\s*$|^\d{1,2}\/\d{1,2}\s*[~～-]/;

/*
 * 冒號是可有可無的：名單裡「姓名：陳玥文」與「姓名辛佩格」兩種寫法都真的出現過。
 * 所以冒號設成選配，但標籤後面一定要接得出東西（\s*(?=.)），
 * 否則「電話」單獨一行會被吃掉，後面那行真正的號碼反而變成無主的孤兒。
 */
const LABELS: [RegExp, keyof ParsedRow][] = [
  [/^(姓名|收件人|名字|收件者)\s*[:：]?\s*(?=.)/, "name"],
  [/^(電話號碼|電話|手機|行動電話|聯絡電話)\s*[:：]?\s*(?=.)/, "phone"],
  [/^(地址|住址|收件地址|寄送地址)\s*[:：]?\s*(?=.)/, "address"],
  [/^(信箱|電子信箱|email|e-?mail)\s*[:：]?\s*(?=.)/i, "email"],
  [/^(門市|取貨門市)\s*[:：]?\s*(?=.)/, "storeName"],
  [/^(店號|門市店號)\s*[:：]?\s*(?=.)/, "storeNo"],
];

const CVS_HINT = /(門市|店號|7-?ELEVEN|7-?11|統一超商|全家|萊爾富|OK超商)/i;
const ADDR_HINT = /[市縣區鄉鎮村里路街道巷弄號樓]/;

/* 整行扣掉數字與電話常見符號之後就空了，那就是電話 */
function looksLikePhone(s: string): boolean {
  const bare = s.replace(/[\d\s\-()（）+＋#]|分機|轉/gi, "");
  if (bare !== "") return false;
  return (s.match(/\d/g) || []).length >= 7;
}

function readStore(line: string, row: ParsedRow) {
  row.shipMethod = "7-11店到店";
  const no = line.match(/店\s*號\s*[:：]?\s*(\d{4,8})/);
  if (no) row.storeNo = no[1];
  let name = line
    .replace(/店\s*號\s*[:：]?\s*\d{4,8}/g, "")
    .replace(/7-?ELEVEN|7-?11|統一超商/gi, "")
    .replace(/[:：()（）]/g, " ")
    .trim();
  /* 「虎爺門市」留「虎爺」——資料庫裡組回去的時候會自己補「門市」兩個字 */
  name = name.replace(/門市$/, "").trim();
  if (name && !row.storeName) row.storeName = name;
  /* 只有店號沒門市名（或反過來）是常見的，留給站長補，不在這裡瞎猜 */
}

export function parseGiftList(text: string): ParsedRow[] {
  const raw = String(text || "").replace(/\r\n?/g, "\n");
  let qty = "1";
  const rows: ParsedRow[] = [];
  let cur: ParsedRow | null = null;

  const flush = () => {
    if (cur && (cur.name || cur.phone || cur.address || cur.storeNo)) rows.push(cur);
    cur = null;
  };

  for (const rawLine of raw.split("\n")) {
    const line = rawLine.trim();

    if (line === "") { flush(); continue; }
    if (NOISE.test(line)) { flush(); continue; }

    /* 「2盒：」這種行是在說接下來這一段每位幾盒 */
    const q = line.match(/^(\d{1,2})\s*盒/);
    if (q) { flush(); qty = q[1]; continue; }
    if (HEADER.test(line)) { flush(); continue; }

    if (!cur) cur = emptyRow(qty);

    /* 一、有明確標籤的最好認 */
    let done = false;
    for (const [re, key] of LABELS) {
      if (re.test(line)) {
        const val = line.replace(re, "").trim();
        if (key === "phone") cur.phone = normalizePhone(val);
        else if (key === "storeName" || key === "storeNo") readStore(line, cur);
        else (cur[key] as string) = val;
        done = true;
        break;
      }
    }
    if (done) continue;

    /* 二、沒標籤就靠內容判斷 */
    if (line.includes("@")) { cur.email = line.replace(/^[^\w]*/, "").trim(); continue; }
    if (CVS_HINT.test(line)) { readStore(line, cur); continue; }
    if (looksLikePhone(line)) { cur.phone = normalizePhone(line); continue; }
    if (ADDR_HINT.test(line) && line.length >= 6) {
      cur.address = cur.address ? `${cur.address} ${line}` : line;
      continue;
    }
    /* 三、都不像就是姓名。已經有姓名了還冒出一行，多半是我判斷錯了，標出來 */
    if (!cur.name) cur.name = line;
    else cur.warn = `這一行我看不出來是什麼：「${line}」，請自己確認`;
  }
  flush();

  /* 收尾檢查：不是為了擋，是為了在那一列上面寫一句話提醒 */
  for (const r of rows) {
    const notes: string[] = [];
    if (r.warn) notes.push(r.warn);
    if (!r.phone) notes.push("沒有找到電話");
    else if (!phoneUsable(r.phone)) notes.push("電話看起來不完整");
    if (r.shipMethod === "宅配" && !r.address) notes.push("沒有找到地址");
    if (isCvsMethod(r.shipMethod) && (!r.storeName || !r.storeNo)) notes.push("門市名稱或店號沒抓到");
    if (r.name.length > 12) notes.push("姓名怪怪的，可能是我把別的東西當成姓名了");
    r.warn = notes.join("；");
  }
  return rows;
}
