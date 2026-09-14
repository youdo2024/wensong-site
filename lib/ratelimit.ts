/* 簡易記憶體式頻率限制（單機部署適用）：同一 IP 於時間窗內最多 N 次 */
type Bucket = { count: number; windowStart: number };
const buckets = new Map<string, Bucket>();

export function rateLimit(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || now - b.windowStart > windowMs) {
    buckets.set(key, { count: 1, windowStart: now });
    return true;
  }
  b.count++;
  return b.count <= max;
}

/* 定期清掉過期的紀錄，避免記憶體無限成長 */
const g = globalThis as unknown as { __yoRateCleaner?: ReturnType<typeof setInterval> };
if (!g.__yoRateCleaner) {
  g.__yoRateCleaner = setInterval(() => {
    const now = Date.now();
    for (const [k, b] of buckets) {
      if (now - b.windowStart > 60 * 60 * 1000) buckets.delete(k);
    }
  }, 10 * 60 * 1000);
}

/*
 * X-Forwarded-For 的解析：從「最右邊」往左找第一個公網 IP。
 *
 * 為什麼要改（2026-09-05）：舊版先信 cf-connecting-ip / x-real-ip / true-client-ip，
 * 都沒有才取 XFF 的最左值。這台站部署在 Zeabur，正式站的回應帶著
 * x-zeabur-request-id 與 x-zeabur-ip-country，代表前面就只有 Zeabur 這一層反代，
 * 而 Zeabur 不會注入上面那三個 header。也就是說那三個欄位完全由用戶端說了算：
 * 隨手送一個 cf-connecting-ip: 1.2.3.4 就換到一個全新的限流桶，
 * 全站的限流（下單佔庫存、訂單查詢、夥伴 PIN、後台登入鎖定、投稿、csp-report）
 * 等於形同虛設。最左值同樣可以偽造，因為最左邊那一段本來就是客戶端自己寫的。
 *
 * 為什麼最右邊的公網 IP 擋得住偽造：反向代理是把它看到的來源 IP「附加在最右邊」，
 * 用戶端送進來的內容永遠在那一段的左邊。攻擊者沒有辦法在代理之後再追加東西，
 * 所以最右邊那一段是這條鏈上唯一不受用戶端控制的值。
 *
 * 為什麼要跳過私有網段：舊註解擔心的是「多層代理時最右值是固定的內部 IP，
 * 所有訪客共用同一個桶」，那個顧慮是對的，解法是往左略過內部位址
 * （10/8、172.16/12、192.168/16、127/8、169.254/16、100.64/10、::1、fc00::/7、fe80::/10，
 * 以及 ::ffff: 開頭的 IPv4-mapped 形式），只認第一個公網位址。
 * 這樣多加幾層代理也不會退化成單一共用桶，同時保有防偽造的性質。
 *
 * 真的有平台會注入可信 header 時（換到 Cloudflare 之類），設環境變數
 * TRUST_PLATFORM_IP_HEADER=cf-connecting-ip 明確指名要信哪一個；預設不設，
 * 代表任何用戶端可寫的 header 一律不採信。
 */

function isPrivateIp(ip: string): boolean {
  const v = ip.toLowerCase();
  if (!v) return true;
  /* IPv4（含 ::ffff: 前綴那種寫法，前面已經正規化過，這裡再保險一次） */
  const v4 = v.startsWith("::ffff:") ? v.slice(7) : v;
  const m = v4.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;  /* CGNAT 100.64/10 */
    return false;
  }
  /* IPv6 */
  if (v === "::1" || v === "::") return true;
  if (/^f[cd][0-9a-f]{2}:/.test(v)) return true;        /* fc00::/7 唯一本地 */
  if (/^fe[89ab][0-9a-f]:/.test(v)) return true;        /* fe80::/10 連結本地 */
  return v.indexOf(":") < 0;                            /* 認不出來的字串當成不可用 */
}

/* 去掉引號、方括號與後面掛的 port，回傳乾淨的位址字串 */
function normalizeIp(raw: string): string {
  let v = String(raw || "").trim().replace(/^"|"$/g, "");
  const br = v.match(/^\[([^\]]+)\](?::\d+)?$/);       /* [::1]:443 這種 */
  if (br) v = br[1];
  else if (/^\d{1,3}(\.\d{1,3}){3}:\d+$/.test(v)) v = v.split(":")[0];  /* 1.2.3.4:5678 */
  v = v.replace(/%.*$/, "");                            /* fe80::1%eth0 的介面後綴 */
  if (/^::ffff:\d{1,3}(\.\d{1,3}){3}$/i.test(v)) v = v.slice(7);  /* IPv4-mapped 收斂成 IPv4，同一人不要拿到兩個桶 */
  return v;
}

/*
 * 純函式版，方便測試。
 * trusted＝TRUST_PLATFORM_IP_HEADER 指名的那個 header 的值，有指名才會有值。
 */
export function pickClientIp(xff: string | null, trusted?: string | null): string {
  const t = normalizeIp(trusted || "");
  if (t) return t;
  const parts = String(xff || "").split(",");
  for (let i = parts.length - 1; i >= 0; i--) {
    const ip = normalizeIp(parts[i]);
    if (ip && !isPrivateIp(ip)) return ip;
  }
  return "local";
}

export function clientIp(headers: Headers): string {
  const trustHeader = (process.env.TRUST_PLATFORM_IP_HEADER || "").trim().toLowerCase();
  const trusted = trustHeader ? headers.get(trustHeader) : null;
  return pickClientIp(headers.get("x-forwarded-for"), trusted);
}
