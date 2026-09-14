/*
 * 超商通路（2026-08-30）。
 *
 * 原本全站寫死「7-11店到店」這個字串，散在十二個檔案。許愿的冷凍禮盒只能走
 * 全家，所以超商品牌變成一個維度。收斂在這裡的理由很實際：漏改一處，
 * 就會有地方把「全家店到店」當成宅配去算運費或抓錯出貨清單。
 *
 * 品牌是「夥伴的屬性」不是商品的屬性——同一個夥伴出的貨一定寄同一家，
 * 所以掛在 partners.cvs_brand，本店用 settings.cvs_brand_own。
 *
 * ship_method 存的字串維持「○○店到店」的格式（7-11店到店／全家店到店），
 * 既有的 235 筆訂單一個字都不用改，判斷改走 isCvsMethod() 就相容。
 */

export type CvsBrand = "7-11" | "全家";

export const CVS_BRANDS: CvsBrand[] = ["7-11", "全家"];

/* 「7-11」→「7-11店到店」。訂單的 ship_method 就存這個 */
export function cvsMethodOf(brand: CvsBrand): string {
  return `${brand}店到店`;
}

/* 這個 ship_method 是不是超商取貨（任一品牌）。全站唯一的判準 */
export function isCvsMethod(shipMethod: string | null | undefined): boolean {
  const s = String(shipMethod || "");
  return s.includes("店到店") || s.includes("超商");
}

/* 從 ship_method 反推品牌，認不出來就當 7-11（既有資料的預設） */
export function brandOfMethod(shipMethod: string | null | undefined): CvsBrand {
  return String(shipMethod || "").includes("全家") ? "全家" : "7-11";
}

export function normalizeBrand(v: unknown): CvsBrand {
  return String(v) === "全家" ? "全家" : "7-11";
}

/* 門市欄位的提示字（各家的用語不同，填錯門市就是寄不到）。
   全家用地圖版 /Marketing/zh/Map（站長指定）：那頁可以直接找附近門市並看到店號，
   /Store 那頁是品牌介紹，客人點進去找不到自己要填的東西。 */
export function storeHint(brand: CvsBrand): { name: string; no: string; site: string } {
  return brand === "全家"
    ? { name: "例如：大里國光店", no: "店號（6 位數字，門市查詢頁上有）", site: "https://www.family.com.tw/Marketing/zh/Map" }
    : { name: "例如：大里門市", no: "店號（6 位數字，門市查詢頁上有）", site: "https://emap.pcsc.com.tw" };
}
