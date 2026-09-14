import crypto from "crypto";
import db from "./db";
import { safeEqual } from "./safe-equal";

/*
 * ── 站內短網址 ──
 *
 * 為什麼要自己蓋，不用 bit.ly／reurl 那種現成的：
 * 台灣的電信商對簡訊裡的網址是白名單制，寄件網域要先送審通過才放行。
 * 站長送審的是 wensong.tw，第三方短網址的網域一律不在名單上，
 * 整則簡訊會在電信商那一關被丟掉——錢照扣、人沒收到、後台看起來還是「已送出」。
 * 所以短網址只能長在自己家的網域上，這件事沒有第二條路。
 *
 * 為什麼一定要縮：一則簡訊上限 268 字元，網址本身也算。
 * 催款那一則要塞兩條連結（接續付款、用 LINE 收通知），
 * 長網址兩條加起來就吃掉一半以上的額度，內文只好一直被截。
 *
 * 為什麼是 8 碼：
 * 字母表 56 個字元，8 碼等於 56^8 ≈ 9.6 兆種組合。
 * 這條網址是簡訊上的公開入口，任何人都能無限次亂試，
 * 猜中一條有效的短網址就等於拿到一張別人的付款連結，
 * 所以碼數要長到「亂猜猜不到」而不是「剛好夠不重複」。
 * 同時 8 碼讓整條網址只有 30 個字元（https://wensong.tw/l/ + 8），
 * 兩條就是 60，正好是站長訂的目標。7 碼省不到什麼，9 碼白白多一個字元。
 *
 * 為什麼看起來像的字要拿掉（0 O o 1 l I）：
 * 站長會把短網址唸給客人聽、客人會用手打進瀏覽器。
 * 分不出 0 跟 O 的那一次，客人看到的是「查無此單」，不是「打錯了」。
 *
 * 為什麼同一個目標、不同管道各發一組碼：
 * 點擊數是拿來判斷「這個人到底有沒有看到」的。
 * 簡訊、Email、LINE 共用一組碼的話，數字只會告訴你「有人點了」，
 * 卻分不出是簡訊有效還是 LINE 有效，那筆數字就沒有任何決策價值。
 * 反過來說，同一個目標＋同一個管道一定要回同一組碼：
 * 同一個人被簡訊催三次，看到的必須是同一條連結，
 * 否則三條碼各記一次點擊，站長會以為他點了三次其實只點了一次。
 *
 * 為什麼不設有效期：
 * 目的地本來就會自己驗權杖（訂單付完了就顯示「這張單已完成」），
 * 短網址再加一層過期只會多出一種「連結壞掉」的死法，而客人分不出差別。
 */

/* 0-9 a-z A-Z 共 62 個，扣掉長得像的 0 O o 1 l I，剩 56 個 */
export const SHORT_ALPHABET = "23456789abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ";
export const SHORT_CODE_LEN = 8;

export type ShortChannel = "sms" | "mail" | "line" | "manual";
export const SHORT_CHANNELS: ShortChannel[] = ["sms", "mail", "line", "manual"];
export const SHORT_CHANNEL_LABEL: Record<string, string> = {
  sms: "簡訊", mail: "Email", line: "LINE", manual: "手動",
};

/*
 * 產碼。
 *
 * 為什麼不用 randomBytes(n)[i] % 56：256 不是 56 的倍數，
 * 餘數 32 讓字母表前 32 個字元的出現機率比後 24 個高約 25%。
 * 分佈一歪，實際的猜中難度就比 56^8 低，8 碼的安全論述整個不成立。
 * 這裡用拒絕取樣：位元組 >= 224（56 的最大整數倍）就丟掉重抽，
 * 剩下的 0..223 每個字元剛好對到 4 個值，完全均勻。
 */
export function newShortCode(len = SHORT_CODE_LEN): string {
  const n = SHORT_ALPHABET.length;
  const limit = 256 - (256 % n); /* 224 */
  let out = "";
  while (out.length < len) {
    /* 一次多抽一點：平均八分之一會被丟掉，多抽的成本遠低於再跑一次 syscall */
    const buf = crypto.randomBytes(len * 2);
    for (const b of buf) {
      if (b >= limit) continue;
      out += SHORT_ALPHABET[b % n];
      if (out.length === len) break;
    }
  }
  return out;
}

/* ── 網域 ── */

function siteBase(): string {
  return (process.env.SITE_URL || "https://www.wensong.tw").replace(/\/$/, "");
}

/*
 * 短網址用的網域：跟站上其他地方一樣，帶 www。
 *
 * 本來寫成 apex（不帶 www），因為每少四個字元、兩條連結就多還給內文八個字元，
 * 而且簡訊白名單登記的是 wensong.tw。實測 apex 會 308 轉到 www 且大小寫保留，
 * 功能沒問題，但那一跳是多出來的失敗點：客人的簡訊 App、公司網路的過濾器、
 * 或哪天轉址規則被改動，都可能讓連結在中途死掉，而簡訊寄出去就收不回來。
 * 站長 2026-09-07 裁決：寧可多四個字元，也不要多一次轉址。
 */
export function shortSiteUrl(): string {
  return siteBase();
}

function bareHost(h: string): string {
  return String(h || "").toLowerCase().replace(/^www\./, "");
}

function siteHost(): string {
  try { return bareHost(new URL(siteBase()).hostname); } catch { return "wensong.tw"; }
}

/*
 * 只縮站內網址，其他一律拒絕。
 *
 * 為什麼要擋：短網址掛在自己的網域上，等於幫任何人背書。
 * 一旦能縮外部網址，這條 /l/ 就是一台開放的轉址機，
 * 詐騙簡訊只要先來這裡換一條 wensong.tw 的網址，
 * 送審通過的白名單網域就變成別人的釣魚工具，賠掉的是整個寄件資格。
 *
 * 收「/api/orders/pay?...」這種路徑，也收 host 是本站的絕對網址（www 與 apex 都算）。
 * 存進資料庫的一律是路徑，不是完整網址：網域哪天換了，舊短網址照樣會轉到新家。
 * 回空字串代表不收。
 */
export function internalPath(input: string): string {
  const raw = String(input || "").trim();
  if (!raw) return "";
  /* 控制字元與空白：混進去只會讓轉址標頭壞掉 */
  if (/[\s]/.test(raw) || /[\u0000-\u001f\u007f]/.test(raw)) return "";
  /* //evil.example 是「協定相對網址」，看起來像路徑，瀏覽器會當成別的網域 */
  if (raw.startsWith("//")) return "";
  let path = "";
  if (raw.startsWith("/")) {
    path = raw;
  } else {
    let u: URL;
    try { u = new URL(raw); } catch { return ""; }
    if (u.protocol !== "https:" && u.protocol !== "http:") return "";
    if (bareHost(u.hostname) !== siteHost()) return "";
    path = `${u.pathname}${u.search}${u.hash}`;
  }
  if (!path.startsWith("/") || path.startsWith("//")) return "";
  /* 不讓短網址指向另一條短網址：轉址接龍除錯不出來，點擊數也會重複計 */
  if (/^\/l\//.test(path)) return "";
  if (path.length > 1000) return "";
  return path;
}

/* ── 建立與查詢 ── */

export type ShortLinkRow = {
  id: number; code: string; target: string; channel: string;
  clicks: number; blocked: number; last_click_at: string; created_at: string;
};

/*
 * 拿一組碼：同一個目標＋同一個管道已經發過就回原來那一組，沒有才新發。
 * 目標不是站內網址、或連續撞碼，都直接丟例外——
 * 悄悄回一組指到別處的碼，比整件事失敗還糟。
 */
export function ensureShortLink(target: string, channel: ShortChannel): string {
  const path = internalPath(target);
  if (!path) throw new Error(`不是站內網址，拒絕縮：${String(target).slice(0, 120)}`);
  const hit = db.prepare("SELECT code FROM short_links WHERE target=? AND channel=?").get(path, channel) as
    | { code: string } | undefined;
  if (hit) return hit.code;

  const now = new Date().toISOString();
  for (let i = 0; i < 8; i++) {
    const code = newShortCode();
    try {
      db.prepare(
        "INSERT INTO short_links (code,target,channel,clicks,blocked,last_click_at,created_at) VALUES (?,?,?,0,0,'',?)"
      ).run(code, path, channel, now);
      return code;
    } catch {
      /*
       * UNIQUE 撞了。兩種可能：碼撞了（機率極低），或是另一個請求剛剛
       * 替同一個目標＋管道建好了。先看是不是後者，是的話用它的碼；
       * 不是就換一組碼再試。重用別人的碼絕對不做。
       */
      const again = db.prepare("SELECT code FROM short_links WHERE target=? AND channel=?").get(path, channel) as
        | { code: string } | undefined;
      if (again) return again.code;
    }
  }
  throw new Error("短網址連續 8 次撞碼，放棄（該檢查亂數來源了）");
}

/*
 * 給訊息用的入口：縮得成就回短網址，縮不成回原本的長網址。
 *
 * 為什麼一定要有這層退路：縮網址是「錦上添花」，寄出去才是本業。
 * 資料庫鎖住、磁碟滿了、目標被判定不是站內網址——不管哪一種，
 * 都不可以變成「這則催款簡訊寄不出去」。失敗就記 log 用長網址，
 * 客人收到的是一則比較長但完全正確的訊息。
 */
export function shortUrl(longUrl: string, channel: ShortChannel): string {
  const long = String(longUrl || "");
  if (!long) return long;
  try {
    return `${shortSiteUrl()}/l/${ensureShortLink(long, channel)}`;
  } catch (e) {
    console.error("[short] 縮網址失敗，改用長網址", channel, long.slice(0, 120), e);
    return long;
  }
}

export function shortLinkByCode(code: string): ShortLinkRow | undefined {
  const c = String(code || "");
  if (c.length !== SHORT_CODE_LEN) return undefined;
  return db.prepare("SELECT * FROM short_links WHERE code=?").get(c) as ShortLinkRow | undefined;
}

/* 點一次。轉址本身不能因為寫不進統計而失敗，所以整包吞掉例外 */
export function recordShortClick(code: string): void {
  try {
    db.prepare("UPDATE short_links SET clicks=clicks+1, last_click_at=? WHERE code=?").run(new Date().toISOString(), code);
  } catch (e) { console.error("[short] 點擊沒記到", code, e); }
}

/* 被限流擋下的一次。站長要看得到「這條連結有人在狂打」 */
export function recordShortBlocked(code: string): void {
  try {
    db.prepare("UPDATE short_links SET blocked=blocked+1 WHERE code=?").run(code);
  } catch (e) { console.error("[short] 擋下次數沒記到", code, e); }
}

/* 這個目標在這個管道上的那一條（沒發過就是 undefined），後台顯示點擊數用 */
export function shortLinkStat(target: string, channel: ShortChannel): ShortLinkRow | undefined {
  const path = internalPath(target);
  if (!path) return undefined;
  try {
    return db.prepare("SELECT * FROM short_links WHERE target=? AND channel=?").get(path, channel) as ShortLinkRow | undefined;
  } catch { return undefined; }
}

export function recentShortLinks(limit = 40): ShortLinkRow[] {
  try {
    return db.prepare("SELECT * FROM short_links ORDER BY id DESC LIMIT ?").all(Math.min(200, Math.max(1, limit))) as ShortLinkRow[];
  } catch { return []; }
}

/* 台北時間的「9/7 14:20」。後台每一頁的短句都用同一個寫法 */
export function shortClickTime(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("zh-TW", {
    timeZone: "Asia/Taipei", hour12: false, month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

/*
 * 後台列上的那一句：「催款連結被點過 2 次，最後 9/7 14:20」。
 * 還沒發過短網址就回空字串，不要寫「0 次」——那會被讀成「他沒點」，
 * 但真相是「這條根本還沒寄出去過」，兩件事差很多。
 */
export function shortClickLine(label: string, target: string, channel: ShortChannel): string {
  const row = shortLinkStat(target, channel);
  if (!row) return "";
  if (!row.clicks) return `${label}還沒被點過`;
  const t = shortClickTime(row.last_click_at);
  return `${label}被點過 ${row.clicks} 次${t ? `，最後 ${t}` : ""}`;
}

/*
 * 同一個目的地在所有管道上的合計，給後台的列用：
 * 「催款連結被點過 2 次，最後 9/7 14:20」。
 *
 * 為什麼合計而不是一個管道一行：站長在提醒中心問的是
 * 「這個人到底看到了沒」，不是「哪個管道贏了」；
 * 要分管道看的時候去發送頁那張表，那裡一條一列。
 */
export function shortClickSummary(label: string, target: string, channels: ShortChannel[] = SHORT_CHANNELS): string {
  let clicks = 0, last = "", any = false;
  for (const c of channels) {
    const row = shortLinkStat(target, c);
    if (!row) continue;
    any = true;
    clicks += row.clicks;
    if (row.last_click_at > last) last = row.last_click_at;
  }
  if (!any) return "";
  if (!clicks) return `${label}還沒被點過`;
  const t = shortClickTime(last);
  return `${label}被點過 ${clicks} 次${t ? `，最後 ${t}` : ""}`;
}

/*
 * /l/<碼> 要轉到哪裡。整段抽出來是為了測得到：
 * 路由那一層只剩限流、記點擊、包成 303，判斷全在這裡。
 *
 * 順序不能反：
 *   short  ── 2026-09-07 起發的 8 碼。
 *   legacy ── 24 碼的訂單權杖。客人手機裡的舊簡訊還躺著這種連結，
 *             而且沒有有效期，所以這條路永遠要留著，行為與以前一模一樣。
 *   miss   ── 都不是，送去訂單查詢頁，不告訴對方「這組碼不存在」。
 */
export type ShortResolve = { kind: "short" | "legacy" | "miss"; path: string; code: string };
export function resolveShortPath(code: string): ShortResolve {
  const c = String(code || "");
  const link = shortLinkByCode(c);
  if (link) return { kind: "short", path: link.target, code: link.code };
  const o = db.prepare("SELECT order_no,token FROM orders WHERE token=? AND token<>''").get(c) as
    | { order_no: string; token: string } | undefined;
  /*
   * 資料庫已經用 token=? 查過一次，這裡再定時比對一次：
   * SQL 的字串比對同樣會提早結束，而這條短網址是簡訊上的公開入口，可以無限次重試。
   */
  if (!o || !safeEqual(c, o.token)) return { kind: "miss", path: "/orders", code: c };
  return {
    kind: "legacy",
    path: `/line/bind?no=${encodeURIComponent(o.order_no)}&t=${encodeURIComponent(o.token)}&src=sms`,
    code: c,
  };
}
