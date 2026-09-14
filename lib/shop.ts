import db, { getSetting, json } from "./db";
import { normalizeBrand, type CvsBrand } from "./cvs";
import { linepayEnabled } from "./linepay";
import { taipeiDateExpired } from "./month";

export function shopEnabled(): boolean {
  return getSetting("shop_enabled", "1") === "1";
}

/* 贊助模式：
   api    = 站內 API 收款（贊助頁、進後台紀錄、發品牌感謝信）
   hybrid = 綜合：單筆留在站內收款，每月定額導去下方指定的外部頁面（如 Portaly）
   link   = 前往指定外部頁面贊助（如 Portaly 傳送門，紀錄在對方平台，不進本站後台）
   off    = 關閉（前台隱藏所有贊助入口；既有訂閱扣款、取消連結不受影響） */
export type SupportMode = "api" | "hybrid" | "link" | "off";
export function supportMode(): SupportMode {
  const m = getSetting("support_mode", "");
  if (m === "api" || m === "hybrid" || m === "link" || m === "off") return m;
  /* 相容舊的 support_enabled 開關 */
  return getSetting("support_enabled", "1") === "1" ? "api" : "off";
}
/* 綜合模式下，每月定額要導去的外部頁面（沿用 support_url 欄位；沒填就退回站內定額） */
export function monthlyExternalUrl(): string {
  return supportMode() === "hybrid" ? supportUrl() : "";
}
export function supportUrl(): string {
  return getSetting("support_url", "").trim();
}
/* 是否顯示任何贊助入口（api 或 link 都顯示） */
export function supportEnabled(): boolean {
  return supportMode() !== "off";
}
/* 贊助按鈕該連去哪；link 模式且有填網址就用外部網址，否則走站內 /support */
export function supportHref(): string {
  return supportMode() === "link" && supportUrl() ? supportUrl() : "/support";
}
export function supportIsExternal(): boolean {
  return supportMode() === "link" && supportUrl() !== "";
}

export function addonTiers(): number[] {
  return json<number[]>(getSetting("addon_tiers", "[300,3000,12000,30000]"), [300, 3000, 12000, 30000]);
}

/*
 * ── 贊助入口的三個獨立開關 ──
 *
 * 這三件事性質不同，所以各自一個開關，不互相牽連：
 *   結帳頁的加購區塊是「銷售元件」（顧客正在結帳，順手多給一筆）
 *   導覽列的按鈕是「導航元素」（讓人隨時找得到贊助入口）
 * 早期把它們綁在一起，關掉加購會順便關掉導覽列，那是副作用不是設計。
 *
 * 三者都預設開啟以維持既有行為；贊助總開關（support_mode=off）關閉時，
 * 三者一律不顯示，不必個別再關。
 */

/*
 * 文章頁的「支持商品」CTA。
 *
 * 預設關閉，跟其他開關相反——這一塊是檔期用的（中秋、年節），
 * 平常文章頁只放小額支持創作者，檔期才把商品推上去。
 * 綁 shopEnabled()：商店休息時連過去只會看到一頁休息公告，那是白花的點擊。
 *
 * 廚師頁不受影響：那些頁面本來就沒有用文章的 CTA 元件。
 */
export function articleShopCta(): boolean {
  return getSetting("article_shop_cta", "0") === "1" && shopEnabled();
}

/* 支持商品 CTA 的去向。預設整個商店，檔期可指定單一商品（例如 /shop/12） */
export function articleShopHref(): string {
  const v = getSetting("article_shop_href", "/shop").trim();
  /* 只收站內路徑，避免有人把外部網址存進來變成開放轉址 */
  return v.startsWith("/") ? v : "/shop";
}

/* 結帳頁的「順手加購支持」區塊 */
export function addonEnabled(): boolean {
  return getSetting("addon_enabled", "1") === "1" && supportEnabled();
}

/* 首頁導覽列右上角的「小額支持創作者」。首頁內容裡的支持段落不受此開關影響 */
export function navSupportHome(): boolean {
  return getSetting("nav_support_home", "1") === "1" && supportEnabled();
}

/* 商店動線（商店、商品頁、購物車、訂單完成頁）導覽列的「小額支持創作者」 */
export function navSupportShop(): boolean {
  return getSetting("nav_support_shop", "1") === "1" && supportEnabled();
}

/*
 * 下面兩個跟上面三個一樣預設開啟。
 * 一度改成預設關閉，後來站長要求全部打開；真正決定顯示與否的是後台那兩個勾選框，
 * 這裡的預設值只在全新資料庫、還沒存過任何設定時才用得到。
 */

/* 首頁最下方整段支持區塊：標題、四格說明、金額按鈕、大額合作來信那一整塊
   （導覽列那顆按鈕是另一個開關 navSupportHome，兩者互不影響） */
export function homeSupportSection(): boolean {
  return getSetting("home_support_section", "1") === "1" && supportEnabled();
}

/* 頁尾那條「數位內容服務說明」連結。
   /business-model 這一頁本身不受影響，直接給網址照樣打得開（金流審查就是這樣用的），
   這裡關掉的只是頁尾要不要露出入口。 */
export function footerBusinessModel(): boolean {
  return getSetting("footer_business_model", "1") === "1";
}

/* 商店金流閘道：
   ecpay ＝綠界＋LINE Pay＋光貿發票（與贊助同一套：跳轉綠界收信用卡／Apple Pay／
           ATM／多元支付，LINE Pay 走官方金流，發票由光貿開立）
   payuni＝統一金流（跳轉 UPP，發票由 PayUni 開）
   tappay＝TapPay 站內刷卡＋光貿發票（暫時停用中，程式保留）
   後台網站設定切換。 */
export type ShopGateway = "ecpay" | "payuni" | "tappay";
export function shopGateway(): ShopGateway {
  const v = getSetting("shop_gateway", "payuni");
  return v === "tappay" ? "tappay" : v === "ecpay" ? "ecpay" : "payuni";
}

/* 付款方式開關：後台可暫停個別方式（例如 LINE Pay 尚未開通）
   統一用四個代號存 settings：credit / linepay / applepay / atm */
export const PAY_METHOD_KEYS: { key: string; label: string }[] = [
  { key: "credit", label: "信用卡" },
  { key: "linepay", label: "LINE Pay" },
  { key: "applepay", label: "Apple Pay" },
  { key: "samsungpay", label: "Samsung Pay" },
  { key: "atm", label: "ATM 轉帳" },
  { key: "twqr", label: "多元支付" },
];

function payKeyOf(label: string): string {
  if (label === "信用卡") return "credit";
  if (label === "LINE Pay") return "linepay";
  if (label === "Apple Pay") return "applepay";
  if (label === "Samsung Pay") return "samsungpay";
  if (label === "ATM 轉帳" || label === "銀行轉帳") return "atm";
  if (label === "多元支付") return "twqr";
  return label;
}

/* 商品 → 出貨地與溫層：結帳頁畫運費分組明細用（伺服器版在 /api/orders 內自建） */
export type OriginMap = Record<number, { origin: number; name: string; temp: "ambient" | "cold"; cvs: CvsBrand; freeAt: number }>;

export function productOrigins(): OriginMap {
  const rows = db
    .prepare("SELECT p.id, p.partner_id, p.temp_zone, p.free_ship, pr.name AS pname, pr.cvs_brand FROM products p LEFT JOIN partners pr ON pr.id = p.partner_id")
    .all() as { id: number; partner_id: number | null; temp_zone: string; free_ship: number | null; pname: string | null; cvs_brand: string | null }[];
  const ownBrand = normalizeBrand(getSetting("cvs_brand_own", "7-11"));
  const out: OriginMap = {};
  for (const r of rows) {
    out[r.id] = {
      origin: r.partner_id || 0,
      name: r.partner_id ? String(r.pname || "夥伴工坊") : "問爽的本店",
      temp: r.temp_zone === "cold" ? "cold" : "ambient",
      /* 超商品牌跟著出貨的人走：夥伴的貨用夥伴的通路，本店的用站長設的 */
      cvs: r.partner_id ? normalizeBrand(r.cvs_brand) : ownBrand,
      /* 逐商品免運門檻，0＝跟著費率表走。這是公開資訊（結帳頁本來就要講給客人聽） */
      freeAt: Math.max(0, Number(r.free_ship) || 0),
    };
  }
  return out;
}

/*
 * 四格運費費率（溫層×取貨方式）。收費、成本、免運門檻三組，後台可改。
 * 成本只給結算報表用；任何前台程式碼都不該碰 cost。
 */
export function freightRates(): { charge: Record<string, number>; cost: Record<string, number>; free: Record<string, number> } {
  const n = (k: string, d: number) => {
    const v = Number(getSetting(k, String(d)));
    return Number.isFinite(v) ? v : d;
  };
  return {
    charge: {
      "ambient-home": n("rate_charge_ambient_home", 125),
      "ambient-cvs": n("rate_charge_ambient_cvs", 65),
      "cold-home": n("rate_charge_cold_home", 280),
      "cold-cvs": n("rate_charge_cold_cvs", 145),
    },
    cost: {
      "ambient-home": n("rate_cost_ambient_home", 120),
      "ambient-cvs": n("rate_cost_ambient_cvs", 60),
      "cold-home": n("rate_cost_cold_home", 250),
      "cold-cvs": n("rate_cost_cold_cvs", 140),
    },
    free: {
      "ambient-home": n("rate_free_ambient_home", 1440),
      "ambient-cvs": n("rate_free_ambient_cvs", 1440),
      "cold-home": n("rate_free_cold_home", 3000),
      "cold-cvs": n("rate_free_cold_cvs", 3000),
    },
  };
}

/*
 * 給前台（client component）用的費率：成本一律清成 0。
 *
 * 傳給 client 的東西會原封不動出現在頁面原始碼裡，任何人查看即可讀到。
 * 成本是內部數字（夥伴、同業都不該看到我們跟物流談到多少），
 * 而前台計算運費根本用不到它——它只服務結算報表。
 * 實測踩過：整包 rates 傳下去，成本 120/60/250/140 直接印在 /cart 的原始碼裡。
 */
export function publicFreightRates(): { charge: Record<string, number>; cost: Record<string, number>; free: Record<string, number> } {
  const r = freightRates();
  return { charge: r.charge, free: r.free, cost: { "ambient-home": 0, "ambient-cvs": 0, "cold-home": 0, "cold-cvs": 0 } };
}

/* 冷凍功能總開關：關閉時商品編輯的溫層選單鎖在常溫，前台不會出現冷凍運費 */
export function coldEnabled(): boolean {
  return getSetting("cold_enabled", "0") === "1";
}

export function freightMode(): "origin" | "flat" {
  return getSetting("freight_mode", "origin") === "flat" ? "flat" : "origin";
}

/*
 * 付款方式開關，商店與贊助各一份（站長指示 2026-08-31）。
 *
 * 為什麼要分開：兩邊的條件本來就不一樣。商店賣實體商品，ATM 轉帳、超商多元支付
 * 都合理；贊助是數位內容，金流商對它的規範不同，而且金流轉換期常常是
 * 「商店已經換家、贊助還在原本那家」，共用一組開關就一定有一邊被迫將就。
 *
 * 舊的 pay_methods_off 保留為「沒有各自設定時的預設值」，
 * 這樣既有資料庫升上來不會突然全部打開——那會讓站長關掉的方式默默復活。
 */
function paysOffFor(scope: "shop" | "support"): string[] {
  const key = scope === "shop" ? "pay_methods_off_shop" : "pay_methods_off_support";
  const raw = getSetting(key, "");
  if (raw) return json<string[]>(raw, []);
  return json<string[]>(getSetting("pay_methods_off", "[]"), []);
}

export function payMethodsOff(scope: "shop" | "support" = "shop"): string[] {
  return paysOffFor(scope);
}

export function isPayMethodOff(label: string, scope: "shop" | "support" = "shop"): boolean {
  return paysOffFor(scope).includes(payKeyOf(label));
}

/* 給前台表單用：把停用的方式從顯示清單濾掉 */
export function enabledPays(labels: string[], scope: "shop" | "support" = "shop"): string[] {
  const off = paysOffFor(scope);
  return labels.filter((l) => !off.includes(payKeyOf(l)));
}

export type Discount = { id: number; code: string; kind: "percent" | "amount" | "freeship"; value: number; expires_at?: string };

/* 折扣碼不分大小寫：一律轉大寫存取；過期自動失效 */
export function findDiscount(code: string): Discount | null {
  const c = code.trim().toUpperCase();
  if (!c) return null;
  const row = db
    .prepare("SELECT id,code,kind,value,expires_at FROM discount_codes WHERE code=? AND active=1")
    .get(c) as Discount | undefined;
  if (!row) return null;
  /* 用台北日曆判斷過期：拿 UTC 的今天去比，台灣凌晨 0 到 8 點會讓昨天到期的碼繼續有效 */
  if (taipeiDateExpired(row.expires_at)) return null;
  return row;
}

/* 商品分類（後台網站設定維護） */
export function productCategories(): string[] {
  return getSetting("product_categories", "服飾,食品,其他")
    .split(/[,，、]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/* 回傳 {discount 折抵金額, freeship 是否免運} */
export function applyDiscount(subtotal: number, d: Discount | null): { discount: number; freeship: boolean } {
  if (!d) return { discount: 0, freeship: false };
  if (d.kind === "freeship") return { discount: 0, freeship: true };
  if (d.kind === "amount") return { discount: Math.min(subtotal, Math.max(0, d.value)), freeship: false };
  /* percent：value = 打幾折（1-99），85 = 85 折 → 折抵 15% */
  const pct = Math.min(99, Math.max(1, d.value));
  return { discount: Math.round((subtotal * (100 - pct)) / 100), freeship: false };
}

export function discountLabel(d: Discount): string {
  if (d.kind === "freeship") return "免運費";
  if (d.kind === "amount") return `折抵 NT$${d.value.toLocaleString()}`;
  const v = d.value % 10 === 0 ? String(d.value / 10) : (d.value / 10).toFixed(1);
  return `打 ${v} 折`;
}

/*
 * 待付款訂單「再付一次」可以改用的付款方式。後台付款連結頁與訂單頁共用。
 * 照金流商過濾（TapPay 只有信用卡），再去掉後台停用的，LINE Pay 要有金鑰才列。
 * 這份清單必須跟 /api/orders/pay 認得的 m= 值一致，不然給出去的連結會被彈回感謝頁。
 */
export function retryPayOptions(): string[] {
  return shopGateway() === "tappay"
    ? enabledPays(["信用卡"])
    : enabledPays(["ATM 轉帳", "信用卡", "LINE Pay", "Apple Pay", "多元支付"]).filter((p) => p !== "LINE Pay" || linepayEnabled());
}
