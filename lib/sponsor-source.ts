import db from "@/lib/db";

/* 贊助來源路徑 → 好讀名稱（文章顯示標題；固定頁顯示固定名）。
   後台總覽與贊助紀錄共用；查一次文章標題表，顯示用途、無任何流程副作用。 */
export function makeSourceLabel(): (src: string) => string {
  const titleBySlug = new Map(
    (db.prepare("SELECT slug,title FROM articles").all() as { slug: string; title: string }[]).map((a) => [a.slug, a.title])
  );
  return (src: string): string => {
    if (!src) return "";
    if (src === "/") return "首頁";
    if (src === "/support" || src.startsWith("/support/")) return "贊助頁";
    const m = src.match(/^\/articles\/([^/]+)/);
    if (m) return titleBySlug.get(decodeURIComponent(m[1])) || src;
    return src;
  };
}

/* 來源統計（成功收到的贊助）：哪一頁帶來幾筆、多少錢 */
export function sourceStats(limit = 8): { source: string; cnt: number; sum: number }[] {
  return db
    .prepare(
      `SELECT source, COUNT(*) cnt, COALESCE(SUM(amount),0) sum FROM sponsorships
       WHERE status NOT IN ('pending','failed') AND source != '' GROUP BY source ORDER BY sum DESC LIMIT ?`
    )
    .all(limit) as { source: string; cnt: number; sum: number }[];
}
