import db from "./db";

/*
 * 文章的 UTM 追蹤連結（2026-09-13，站長規格）。
 *
 * 一篇文章要貼到八個地方，每個地方一條帶 UTM 的長網址，人記不住也貼不整齊。
 * 所以定一套規則短碼：/s/<slug>-<管道縮寫>，301 轉到長網址，UTM 由縮寫決定。
 * 不進資料庫、不發碼：規則就是碼，任何一篇文章一上線八條連結就存在了。
 *
 * 為什麼是 301 不是 303：這條連結會被貼在社群主頁、影片說明欄，一放好幾個月，
 * 目的地又是固定規則算出來的，永久轉址讓瀏覧器與爬蟲記住它，少一跳。
 * （/l/ 那套用 303 是因為目的地會依訂單狀態變。）
 *
 * 參數順序固定 source、medium、campaign，campaign 就是 slug；
 * 短碼後面若再帶其他查詢參數，原樣接在後面，不蓋掉 UTM。
 */
export const UTM_CHANNELS: Record<string, { source: string; medium: string; label: string }> = {
  fb:  { source: "facebook",  medium: "organic", label: "Facebook" },
  ig:  { source: "instagram", medium: "organic", label: "IG 貼文" },
  igs: { source: "instagram", medium: "story",   label: "IG 限動" },
  igb: { source: "instagram", medium: "bio",     label: "IG 主頁" },
  th:  { source: "threads",   medium: "organic", label: "Threads" },
  yt:  { source: "youtube",   medium: "organic", label: "YouTube" },
  tk:  { source: "tiktok",    medium: "bio",     label: "TikTok" },
  mc:  { source: "manychat",  medium: "dm",      label: "ManyChat" },
};

/* 碼拆成 slug 與管道。slug 本身有連字號（mingjian-incinerator），所以從最後一段認管道 */
export function parseUtmCode(code: string): { slug: string; channel: string } | null {
  const c = String(code || "").trim().toLowerCase();
  const m = /^([a-z0-9][a-z0-9-]*)-([a-z]+)$/.exec(c);
  if (!m || !UTM_CHANNELS[m[2]]) return null;
  return { slug: m[1], channel: m[2] };
}

/* 長網址的查詢字串。extra 是短碼後面原本帶的參數，接在 UTM 之後 */
export function utmQuery(slug: string, channel: string, extra?: URLSearchParams): string {
  const ch = UTM_CHANNELS[channel];
  if (!ch) return "";
  const q = new URLSearchParams();
  q.set("utm_source", ch.source);
  q.set("utm_medium", ch.medium);
  q.set("utm_campaign", slug);
  extra?.forEach((v, k) => { if (!q.has(k)) q.append(k, v); });
  return q.toString();
}

/* 文章存在才轉（不看 published：上架前就要先把連結準備好貼出去） */
export function articleSlugExists(slug: string): boolean {
  try {
    return Boolean(db.prepare("SELECT 1 FROM articles WHERE slug=? LIMIT 1").get(slug));
  } catch {
    return false;
  }
}

/* 給站長的清單：八個管道各一組長版與短版 */
export function utmLinksFor(site: string, shortHost: string, slug: string): { label: string; long: string; short: string }[] {
  return Object.entries(UTM_CHANNELS).map(([k, ch]) => ({
    label: ch.label,
    long: `${site}/articles/${slug}?${utmQuery(slug, k)}`,
    short: `${shortHost}/s/${slug}-${k}`,
  }));
}
