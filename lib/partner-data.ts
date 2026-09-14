import { isMultiShip, recipientAddress, type ShipRecipient } from "./multi-ship";
import { recipientOf } from "./recipient";
import db, { json } from "./db";
import { fmtDateTimeDash } from "./format";
import { parseChoiceStocks } from "./choice-stock";
import { reservedByChoice } from "./pay-link";
import { csvCell as csvEsc } from "./csv";
import { parseChoiceExpiry, weekRetired } from "./choice-split";
import { taipeiYMD } from "./month";
import { zipDisplay } from "./zip-lookup";
import { isCvsMethod } from "./cvs";

/*
 * 出貨夥伴頁的資料組裝：把訂單攤平成「每個商品 × 每個出貨週」的工作清單。
 *
 * 統計規則（站長定的）：
 *   要做的量＝已付款＋已出貨＋已完成（付款成功才算數，做過的也要算產能）
 *   待出貨清單＝已付款（夥伴照這份寄）
 *   待付款只給一個參考數字，不進清單——ATM 沒繳款前那盒不存在
 *
 * 分組鍵是出貨週選項的字串本身，排序依商品目前的選項順序；
 * 已額滿被刪掉的選項（或改過字的舊訂單）排在後面，依首次出現順序。
 * 站長已承諾檔期中不改選項文字，這裡不做字串正規化。
 */

export type PartnerOrderRow = {
  orderId: number;
  orderNo: string;
  itemIdx: number;
  /* 多地址配送才有：這一列是名單裡的第幾位。一般訂單為 null */
  recipIdx?: number | null;
  /*
   * 主要訂購人（通知信寄給他）。多地址配送一定有值；一般訂單只在
   * 收件人不是訂購人本人時才有值，兩種情況共用同一個顯示位置。
   */
  buyerName?: string;
  buyerPhone?: string;
  name: string;
  phone: string;
  shipMethod: string;
  address: string;
  /* 郵遞區號的提醒（「⚠ 查無」或「⚠ 原寫 xxx」），空字串代表沒事。
     address 本身已含 3 碼前綴（lib/zip-lookup.ts 的顯示規則），超商列恆為空字串。 */
  zipNote: string;
  /* 逐位備註（多地址名單），包貨時要看 */
  note: string;
  qty: number;
  status: string; // paid / shipped / done
  createdAt: string;
};

export type PartnerWeek = {
  choice: string;        // 出貨週字串；無規格商品用 ""
  paidQty: number;       // 已付款待出貨
  shippedQty: number;    // 已出貨＋已完成
  pendingQty: number;    // 待付款（參考用）
  reservedQty: number;   // 已保留：站長開了付款連結、庫存已預扣，但對方還沒下單
  remain: number | null; // 剩餘庫存；null＝該規格不限量
  toShip: PartnerOrderRow[];   // 已付款，照下單時間排
  shipped: PartnerOrderRow[];  // 已出貨／完成，沉底
};

export type PartnerProduct = {
  id: number;
  name: string;
  partnerId: number;
  optionName: string;
  weeks: PartnerWeek[];
  totalPaid: number;
  totalShipped: number;
  totalPending: number;
  totalReserved: number;
};

type OrderRow = {
  id: number; order_no: string; name: string; phone: string; address: string;
  zip: string; ship_method: string; items: string; status: string; created_at: string; ship_list: string;
  recipient_name: string; recipient_phone: string;
};
/* shipped 是夥伴逐品項出貨寫回 items JSON 的旗標（舊訂單沒有＝未出）。
   不記物流單號：站長不使用。 */
type Item = { id: number; name: string; choice: string | null; qty: number; shipped?: number };

/*
 * 工作台要顯示的商品。
 *   partnerId 是正整數 → 那位夥伴的商品
 *   partnerId === 0    → 本店自己出貨的商品（partner_id 為 NULL）
 *   不帶                → 全部（含本店），站長總覽用
 *
 * 本店的商品不能像夥伴那樣全部列出：站長有一堆下架、季節性、零訂單的品項，
 * 全列會洗掉真正要出的貨。所以本店只顯示「目前有未出貨訂單」的商品。
 * 夥伴的商品照樣全列——他需要看到自己負責的品項有哪些，即使這週沒單。
 *
 * 「通知」勾選從此只管站長自己的下單通知信，不再決定工作台範圍。
 */
export function watchedProducts(partnerId?: number): { id: number; name: string; option_name: string; option_choices: string; choice_stocks: string; choice_expiry: string; partner_id: number }[] {
  const cols = "id,name,option_name,option_choices,choice_stocks,choice_expiry,partner_id";
  type Row = { id: number; name: string; option_name: string; option_choices: string; choice_stocks: string; choice_expiry: string; partner_id: number };
  if (partnerId && partnerId > 0)
    return db.prepare(`SELECT ${cols} FROM products WHERE partner_id=? ORDER BY sort, id`).all(partnerId) as Row[];

  /* 本店：只留有未出貨訂單的商品，避免一堆零筆區塊洗版 */
  const liveIds = new Set<number>();
  const rows = db.prepare("SELECT items FROM orders WHERE status IN ('pending','paid')").all() as { items: string }[];
  for (const r of rows) {
    try {
      for (const it of JSON.parse(r.items || "[]") as { id: number; shipped?: number }[])
        if (!it.shipped) liveIds.add(Number(it.id));
    } catch { /* 壞資料跳過 */ }
  }
  const own = (db.prepare(`SELECT ${cols} FROM products WHERE partner_id IS NULL ORDER BY sort, id`).all() as Row[])
    .filter((p) => liveIds.has(p.id))
    .map((p) => ({ ...p, partner_id: 0 }));
  if (partnerId === 0) return own;

  const partners = db.prepare(`SELECT ${cols} FROM products WHERE partner_id IS NOT NULL ORDER BY sort, id`).all() as Row[];
  return [...partners, ...own];
}

export function partnerData(partnerId?: number): PartnerProduct[] {
  const products = watchedProducts(partnerId);
  if (products.length === 0) return [];
  const wanted = new Map(products.map((p) => [p.id, p]));

  const orders = db
    .prepare(
      "SELECT id,order_no,name,phone,address,zip,ship_method,items,status,created_at,ship_list,recipient_name,recipient_phone FROM orders WHERE status IN ('pending','paid','shipped','done') ORDER BY id"
    )
    .all() as OrderRow[];

  /* productId → choice → week 累積 */
  const acc = new Map<number, Map<string, PartnerWeek>>();
  const weekOf = (pid: number, choice: string): PartnerWeek => {
    if (!acc.has(pid)) acc.set(pid, new Map());
    const m = acc.get(pid)!;
    if (!m.has(choice)) m.set(choice, { choice, paidQty: 0, shippedQty: 0, pendingQty: 0, reservedQty: 0, remain: null, toShip: [], shipped: [] });
    return m.get(choice)!;
  };

  for (const o of orders) {
    const items = json<Item[]>(o.items, []);

    /*
     * 多地址配送：一筆訂單、一次付款，貨要分寄到很多個地址。
     *
     * 這裡把它攤成「一位收件人一列」，而不是「一個品項一列」，
     * 否則工作台上只會看到一列寫著六十盒、沒有地址，出貨的人根本無從下手。
     * 每一位各自有 shipped 旗標，可以逐一點出貨，跟原本逐品項的作法同一套。
     *
     * 名單由站長在後台補（顧客結帳時不填地址）。還沒補之前 shipList 是空的，
     * 這時退回原本的邏輯照常顯示一列，站長才看得到「有這筆單但還沒有名單」。
     */
    const shipList = json<ShipRecipient[]>(o.ship_list || "[]", []);
    if (isMultiShip(o.ship_method) && shipList.length > 0) {
      /* 掛在第一個「夥伴要經手」的品項那一週底下，不逐品項重複攤開 */
      const first = items.find((it) => wanted.has(it.id));
      if (first) {
        const w = weekOf(first.id, first.choice || "");
        shipList.forEach((r, recipIdx) => {
          const shipped = o.status === "shipped" || o.status === "done" || Boolean(r.shipped);
          const row: PartnerOrderRow = {
            orderId: o.id, orderNo: o.order_no, itemIdx: -1, recipIdx,
            name: r.name, phone: r.phone, buyerName: o.name, buyerPhone: o.phone, note: r.note || "",
            /* 取貨方式逐位獨立：同一筆訂單可以六盒宅配六盒超商 */
            shipMethod: isCvsMethod(r.shipMethod) ? String(r.shipMethod) : "宅配",
            /* 宅配列把 3 碼郵遞區號放進地址開頭（抄託運單一行掃過去），
               推不出的標「查無」；超商列沒有郵遞區號這回事，不標任何東西 */
            ...(isCvsMethod(r.shipMethod)
              ? { address: recipientAddress(r), zipNote: "" }
              : (() => { const z = zipDisplay(r.address, r.zip); return { address: z.text, zipNote: z.note }; })()),
            qty: Number(r.qty) || 0,
            status: o.status, createdAt: o.created_at,
          };
          if (o.status === "pending") {
            w.pendingQty += row.qty;
          } else if (shipped) {
            w.shippedQty += row.qty;
            w.shipped.push(row);
          } else {
            w.paidQty += row.qty;
            w.toShip.push(row);
          }
        });
      }
      /* 這裡是 for...of 迴圈，必須 continue 不能 return——
         return 會直接結束 partnerData()，後面所有訂單都不見 */
      continue;
    }

    /* 出貨主資訊換成收件人：收件人欄空著就是訂購人本人，全站只有這一套判斷規則 */
    const rec = recipientOf(o);
    items.forEach((it, itemIdx) => {
      if (!wanted.has(it.id)) return;
      const w = weekOf(it.id, it.choice || "");
      /* 出貨是「逐品項」判定：同一筆訂單可以買好幾週（送不同人），
         點了第一週不代表其他週也出了。訂單狀態 shipped/done＝整筆都出完（後台手動改的情況）。 */
      const itemShipped = o.status === "shipped" || o.status === "done" || Boolean(it.shipped);
      const row: PartnerOrderRow = {
        orderId: o.id, orderNo: o.order_no, itemIdx, name: rec.name, phone: rec.phone,
        /* 收件人不是訂購人本人才多帶一行，畫面與 CSV 都靠這兩個欄位有沒有值判斷 */
        ...(rec.sameAsBuyer ? {} : { buyerName: o.name, buyerPhone: o.phone }),
        shipMethod: o.ship_method || "宅配",
        ...(isCvsMethod(o.ship_method)
          ? { address: o.address, zipNote: "" , note: ""}
          : (() => { const z = zipDisplay(o.address, o.zip); return { address: z.text, zipNote: z.note , note: ""}; })()),
        qty: it.qty,
        status: o.status, createdAt: o.created_at,
      };
      if (o.status === "pending") {
        w.pendingQty += it.qty;
      } else if (itemShipped) {
        w.shippedQty += it.qty;
        w.shipped.push(row);
      } else {
        w.paidQty += it.qty;
        w.toShip.push(row);
      }
    });
  }

  /* 已保留：付款連結預扣了庫存但訂單還沒成立。夥伴看不到的話，
     等對方第 10 天付款才突然多出一批要做，而備料早就照舊數字排定了。 */
  for (const [pid, byChoice] of reservedByChoice()) {
    if (!wanted.has(pid)) continue;
    for (const [choice, qty] of byChoice) weekOf(pid, choice).reservedQty += qty;
  }

  return products.map((p) => {
    const m = acc.get(p.id) || new Map<string, PartnerWeek>();
    const remain = parseChoiceStocks(p.choice_stocks);
    const optionOrder = json<string[]>(p.option_choices, []);
    const seen = [...m.keys()];
    /* 排序：目前選項的順序優先，舊字串照出現順序墊後 */
    const rank = (c: string) => {
      const i = optionOrder.indexOf(c);
      return i === -1 ? optionOrder.length + seen.indexOf(c) : i;
    };
    /* 退役週自動收掉：全部出完、過了下架日再加 14 天保留期。
       沒填下架日的永遠不收——寧可清單長，不可把還要出的貨藏起來 */
    const expiryMap = parseChoiceExpiry(p.choice_expiry);
    const todayIso = taipeiYMD().iso;
    const weeks = seen
      .sort((a, b) => rank(a) - rank(b))
      .map((c) => {
        const w = m.get(c)!;
        w.remain = Object.prototype.hasOwnProperty.call(remain, c) ? remain[c] : null;
        return w;
      })
      .filter((w) => !weekRetired(
        { open: w.toShip.length > 0 || w.pendingQty > 0 || w.reservedQty > 0 },
        w.choice, expiryMap, todayIso
      ));
    return {
      id: p.id,
      name: p.name,
      partnerId: p.partner_id,
      optionName: p.option_name || "",
      weeks,
      totalPaid: weeks.reduce((s, w) => s + w.paidQty, 0),
      totalShipped: weeks.reduce((s, w) => s + w.shippedQty, 0),
      totalPending: weeks.reduce((s, w) => s + w.pendingQty, 0),
      totalReserved: weeks.reduce((s, w) => s + w.reservedQty, 0),
    };
  });
}


/* 夥伴頁的 CSV 匯出：與畫面同一份資料，按出貨週分組、各組帶小計。
   給習慣印出來或進 Excel 的夥伴用；BOM 讓 Excel 直接認得 UTF-8。 */
export function buildPartnerCsv(p: PartnerProduct): string {
  const out: string[] = [];
  /* 台北時間（UTC+8 無夏令）。原本直接用 toISOString 是 UTC，印出來慢八小時，
     夥伴看到「產出時間」對不上自己的錶，會以為抓到舊檔 */
  const now = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 16).replace("T", " ");
  out.push(`${csvEsc(`出貨清單：${p.name}`)},${csvEsc(`產出時間 ${now}`)}`);
  out.push([csvEsc(p.optionName || "分組"), csvEsc("待出貨"), csvEsc("已出貨"), csvEsc("待付款(參考)"), csvEsc("已保留(參考)"), csvEsc("剩餘庫存")].join(","));
  for (const w of p.weeks)
    out.push([csvEsc(w.choice || "（無規格）"), w.paidQty, w.shippedQty, w.pendingQty, w.reservedQty, w.remain === null ? csvEsc("不限") : w.remain].join(","));
  out.push([csvEsc("合計"), p.totalPaid, p.totalShipped, p.totalPending, p.totalReserved, ""].join(","));
  for (const w of p.weeks) {
    out.push("");
    out.push(`${csvEsc(w.choice || "（無規格）")},${csvEsc(`待出貨 ${w.paidQty}`)},${csvEsc(`已出貨 ${w.shippedQty}`)}`);
    /* 訂購人／訂購人電話排最後：畫面上收件人與訂購人不同時才有小字提醒，
       匯出之前漏了這兩欄，夥伴印出來對不到人（既有 bug，順手一起補）。
       備註排在最後一欄：畫面上（app/partner/page.tsx）逐位備註本來就看得到，
       CSV 漏了這欄會讓只看列印稿的夥伴漏看包裝指示（2026-09-14 審查抓到）。 */
    out.push(["狀態", "訂單編號", "數量", "收件人", "電話", "取貨方式", "地址／門市", "下單時間", "訂購人", "訂購人電話", "備註"].map(csvEsc).join(","));
    for (const r of w.toShip)
      out.push([csvEsc("待出貨"), csvEsc(r.orderNo), r.qty, csvEsc(r.name), csvEsc(r.phone), csvEsc(r.shipMethod), csvEsc(r.address), csvEsc(fmtDateTimeDash(r.createdAt)), csvEsc(r.buyerName || ""), csvEsc(r.buyerPhone || ""), csvEsc(r.note || "")].join(","));
    for (const r of w.shipped)
      out.push([csvEsc("已出貨"), csvEsc(r.orderNo), r.qty, csvEsc(r.name), csvEsc(r.phone), csvEsc(r.shipMethod), csvEsc(r.address), csvEsc(fmtDateTimeDash(r.createdAt)), csvEsc(r.buyerName || ""), csvEsc(r.buyerPhone || ""), csvEsc(r.note || "")].join(","));
  }
  return "﻿" + out.join("\n");
}
