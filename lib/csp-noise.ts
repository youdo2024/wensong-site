/*
 * CSP 回報的降噪。
 *
 * Report-Only 掛上去之後才發現：回報量的絕大多數不是「我們漏了白名單」，
 * 而是訪客那一端注入的第三方追蹤。2026-08-27 實測一小時，每一條都是同一個
 * Cloud Run 網址在文章頁發 /events，而整個 repo 找不到這個網域，
 * 觸發的頁面全帶 utm_source=meta／manychat，也就是從廣告與 ManyChat 進來、
 * 用 app 內建瀏覽器開站的那群人。那不是我們的資源，不該進白名單，
 * 也不該把站長的 Runtime Logs 灌滿。
 *
 * 降噪分兩層：
 *   一、已知雜訊直接不記（擴充功能協定、注入網域）
 *   二、其餘的同種違規每 6 小時只記一次，並在下次記錄時附上這段期間被壓下幾次
 *
 * 第二層才是重點。要判斷能不能轉強制，需要知道的是「有哪些種類的違規」，
 * 不是「發生幾次」。同一條重複一萬次，價值跟一次一樣。
 * 而且用時間視窗而不是永久去重，新冒出來的違規仍然會立刻現形。
 */

/* 訪客端注入的網域。比對是「等於或以此結尾」，
   a.run.app 是 Google Cloud Run 的共用網域，我們自己一個服務都沒跑在上面。 */
export const NOISE_HOSTS = ["a.run.app"];

/* 擴充功能的資源協定。這些本來就不可能是我們載入的東西。 */
export const NOISE_SCHEMES = [
  "chrome-extension:",
  "moz-extension:",
  "safari-extension:",
  "safari-web-extension:",
  "webkit-masked-url:",
];

export function hostOf(uri: string): string {
  try {
    return new URL(uri).hostname.toLowerCase();
  } catch {
    return "";
  }
}

export function isNoise(blockedUri: string): boolean {
  const v = blockedUri.trim().toLowerCase();
  if (!v) return false;
  if (NOISE_SCHEMES.some((s) => v.startsWith(s))) return true;
  const h = hostOf(v);
  if (!h) return false;
  return NOISE_HOSTS.some((n) => h === n || h.endsWith(`.${n}`));
}

/*
 * 去重的鍵。
 *
 * 用「指令＋網域」而不是完整網址：同一個第三方會在幾十個頁面、
 * 帶著幾十組查詢字串被擋，那些是同一件事，記一次就夠。
 * blocked-uri 也可能是 inline、eval 這種非網址的值，取不出網域就用原字串。
 */
export function violationKey(directive: string, blockedUri: string): string {
  return `${directive}|${hostOf(blockedUri) || blockedUri.trim().slice(0, 60)}`;
}

export type ThrottleResult = { log: boolean; suppressed: number };

/*
 * 時間視窗去重。存在記憶體裡，重新部署就歸零，這對觀察用資料是可接受的，
 * 為了它開一張資料表反而養出沒人看的髒表（原本端點的註解就是這個判斷）。
 */
export function createThrottle(windowMs: number, maxKeys: number) {
  const seen = new Map<string, { since: number; suppressed: number }>();
  return {
    check(key: string, now: number): ThrottleResult {
      const hit = seen.get(key);
      if (!hit || now - hit.since >= windowMs) {
        seen.set(key, { since: now, suppressed: 0 });
        /* 上限保護：有人刻意灌不同網域也吃不掉記憶體。
           滿了就整個倒掉重來，只留當下這筆，下一輪自然會重新長回真正常見的那幾條。 */
        if (seen.size > maxKeys) {
          const keep = seen.get(key)!;
          seen.clear();
          seen.set(key, keep);
        }
        return { log: true, suppressed: hit ? hit.suppressed : 0 };
      }
      hit.suppressed++;
      return { log: false, suppressed: hit.suppressed };
    },
    size(): number {
      return seen.size;
    },
  };
}

/*
 * 記錄前先把網址洗乾淨。
 *
 * document-uri 是「違規發生在哪一頁」，原樣寫進 Runtime Logs 會出事：
 * /shop/thanks?no=YD…&k=<訂單金鑰>、/support/thanks?sid=…&t=<金鑰>、/pay/<付款 token>
 * 這些網址本身就是憑證，看得到 log 的人等於拿到別人的訂單頁與付款頁。
 * CSP 回報是訪客的瀏覽器自動送來的，站長沒有機會先過濾。
 *
 * 作法：問號與井字號後面整段丟掉，/pay/ 與 /l/ 後面那一段換成刪節號。
 * 剩下的路徑才是排查違規真正需要的資訊。
 * blocked-uri 也套同一套：它可能是本站同源、帶查詢字串的網址。
 */
export function sanitizeCspUrl(u: string): string {
  const raw = String(u ?? "");
  if (!raw) return "";
  const cut = raw.split("#")[0].split("?")[0];
  return cut.replace(/(\/(?:pay|l)\/)[^/]+/i, "$1…");
}
