import { isCvsMethod } from "./cvs";
/*
 * 多地址配送：企業訂購一次付款、貨分寄到很多個地址。
 *
 * 為什麼獨立一個檔案只為了一個字串：
 * 這個站被「字串當旗標」咬過三次（「繳費帳號」比對不到商店訂單、
 * 自動取消的標記認不出另一種寫法、重複單的判定看錯欄位）。
 * 只要寫的人跟讀的人各自打一次字，遲早會有一邊改了另一邊沒改。
 * 所以出貨方式的值與判斷的函式，全部只有這裡一份。
 *
 * 資料放在 orders.ship_list（JSON 陣列），不另開資料表，
 * 理由是它跟 items 的 shipped 旗標是同一種東西：一筆訂單裡的多個出貨單位。
 * 沿用同一套模型，出貨工作台與通知信才不用長出第二套邏輯。
 */

/** 出貨方式的值。顧客結帳選它、後台顯示它、工作台判斷它，都只認這個常數 */
export const MULTI_SHIP = "多地址配送";

export type ShipRecipient = {
  name: string;
  phone: string;
  /*
   * 取貨方式逐位獨立：企業訂 12 盒，六盒宅配六盒超商是常態，
   * 整批共用一種方式反而是少見的情況。
   * 舊資料沒有這個欄位，讀出來是 undefined，一律當宅配（既有行為）。
   */
  shipMethod?: string;
  /* 宅配用 */
  address: string;
  /* 超商取貨用 */
  storeName?: string;
  storeNo?: string;
  /* 站長手動補登的郵遞區號（3 碼），僅宅配用；沒填就顯示時即時推導 */
  zip?: string;
  qty: number;
  /* 1＝這一位已寄出。跟 items 的 shipped 旗標同一個作法 */
  shipped?: number;
  /* 逐位備註（例如「附紙袋 5 個」），夥伴工作台看得到（站長 2026-09-05） */
  note?: string;
};

/** 這一位是不是超商取貨。舊資料沒有 shipMethod，當宅配 */
export function isCvsRecipient(r: ShipRecipient): boolean {
  return isCvsMethod(r.shipMethod);
}

/*
 * 出貨單上要顯示的那一行地址。
 * 超商取貨組成跟一般訂單一模一樣的字串（「7-11「○○」門市（店號 123456）取貨」），
 * 出貨的人看到的格式才會前後一致，不用學第二種寫法。
 */
/*
 * 超商取貨的地址字串，全站唯一的組字處。
 * 這句話原本在四個檔案各寫一份（結帳 API、贈品單、這裡、CSV 匯出），
 * CSV 那份還少了結尾「取貨」兩個字。字串規格不一致已經出過三次事，
 * 同樣的錯不要犯第四次。
 */
export function cvsPickupText(
  storeName: string | null | undefined,
  storeNo: string | null | undefined,
  /* 超商品牌。不給就沿用 7-11（既有資料與贈品單的預設） */
  brand: string = "7-11"
): string {
  return `${brand}「${String(storeName || "").trim()}」門市（店號 ${String(storeNo || "").trim()}）取貨`;
}

export function recipientAddress(r: ShipRecipient): string {
  return isCvsRecipient(r) ? cvsPickupText(r.storeName, r.storeNo) : (r.address || "").trim();
}

export function isMultiShip(shipMethod: string | null | undefined): boolean {
  return (shipMethod || "") === MULTI_SHIP;
}

/** 名單的總盒數。拿來跟訂單品項的總數對帳，對不起來多半是漏填了某一位 */
export function shipListTotal(list: ShipRecipient[]): number {
  return list.reduce((n, r) => n + (Number(r.qty) || 0), 0);
}
