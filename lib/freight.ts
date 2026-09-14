/*
 * 運費引擎（多夥伴版，docs/multi-partner-spec.md 第四節）。
 *
 * 純函式，故意不 import 任何東西：結帳頁（client）要用它畫明細，
 * /api/orders（server）要用它算權威金額，兩邊必須是同一份邏輯。
 * 混進 db 依賴就會重演 choice-split 那次的建置失敗。
 *
 * 費率是「溫層 × 取貨方式」四格（2026-08-30 站長給的實際費率）：
 *              跟客人收 / 我付的成本
 *   常溫宅配      125 / 120
 *   常溫店到店     65 /  60
 *   冷凍宅配      280 / 250
 *   冷凍店到店     145 / 140
 * 冷凍不是「不能超商」——7-11 有冷凍店到店，站長也報了價。
 * 舊版把冷鏈寫死禁超商是錯的，已解禁。
 *
 * 分組規則（origin 模式）：
 *   購物車按（出貨地 × 溫層）分組，一組＝一個包裹＝一次運費。
 *   同一位夥伴的常溫＋冷凍是兩包兩費：本來就不能裝同一箱。
 *   免運門檻各組各自算，而且四種方式各有自己的門檻
 *   （冷凍宅配成本 250，套常溫的 1440 門檻等於白做）。
 *   商品可以再壓一個自己的門檻（products.free_ship），組內取最低的那個。
 *
 * 成本費率只給結算報表用，前台永遠不碰——那是內部數字。
 */

export type FreightLine = { id: number; price: number; qty: number };

export type Temp = "ambient" | "cold";
export type ShipWay = "home" | "cvs";

export type OriginInfo = {
  /* 出貨地代號：夥伴 id；0＝本店 */
  origin: number;
  originName: string;
  temp: Temp;
  /*
   * 逐商品的免運門檻（NT$）。0 或不給＝跟著費率表的系統門檻走。
   *
   * 為什麼需要它：費率表的門檻是「溫層×取貨方式」四格，同一個溫層只有一個數字，
   * 但每個夥伴的定價都不一樣（蛋捲 720、許愿 680）。站長要對客人講
   * 「買兩盒免運」，那就得是各商品自己的 2×售價，不可能共用一個門檻。
   */
  freeAt?: number;
};

export type FreightGroup = {
  origin: number;
  originName: string;
  temp: Temp;
  way: ShipWay;
  subtotal: number;
  fee: number;      /* 跟客人收的（免運時為 0） */
  cost: number;     /* 我實際要付的（免運照樣要付，這是重點） */
  free: boolean;
  /* 這一組實際採用的免運門檻。畫面上的「再湊 $X 就免運」一定要用這個數字，
     不能拿網站設定那個單一門檻去講——那是舊制留下來的，跟這組多半不一樣。 */
  freeAt: number;
};

/* 四格費率表。key＝`${temp}-${way}` */
export type RateTable = {
  charge: Record<string, number>;   /* 跟客人收 */
  cost: Record<string, number>;     /* 我付的成本 */
  free: Record<string, number>;     /* 免運門檻 */
};

export function rateKey(temp: Temp, way: ShipWay): string {
  return `${temp}-${way}`;
}

export type FreightOpts = {
  mode: "origin" | "flat";
  /* 顧客選的取貨方式 */
  isCvs: boolean;
  rates: RateTable;
  /* 折扣碼免運或不需寄送：全部包裹一律免運（成本仍照算） */
  allFree: boolean;
};

function pick(table: Record<string, number>, temp: Temp, way: ShipWay, fallback = 0): number {
  const v = table[rateKey(temp, way)];
  return Number.isFinite(v) ? v : fallback;
}

/*
 * 一個包裹的免運門檻：組內有任何商品設了自己的門檻，就取其中最低的；
 * 都沒設才回到費率表的系統門檻。
 *
 * 取最低而不是最高，是因為客人看到的是「這件商品兩盒免運」。他真的買了兩盒，
 * 卻因為順手加了一件別的東西反而不免運，那是最糟的結帳體驗。
 * 站長要收得比較嚴的話，把門檻設在該商品上就好，別靠混買去拉高。
 */
function freeThresholdOf(overrides: number[], rates: RateTable, temp: Temp, way: ShipWay): number {
  const own = overrides.filter((n) => Number.isFinite(n) && n > 0);
  if (own.length > 0) return Math.min(...own);
  return pick(rates.free, temp, way, Infinity);
}

export function computeFreight(
  lines: FreightLine[],
  infoOf: (productId: number) => OriginInfo,
  opts: FreightOpts
): { groups: FreightGroup[]; total: number; costTotal: number } {
  const subtotalAll = lines.reduce((s, l) => s + l.price * l.qty, 0);
  if (lines.length === 0 || subtotalAll === 0) return { groups: [], total: 0, costTotal: 0 };
  const way: ShipWay = opts.isCvs ? "cvs" : "home";

  if (opts.mode === "flat") {
    /* 舊制：一單一費。有冷凍就整單用冷凍費率（至少不倒貼） */
    const anyCold = lines.some((l) => infoOf(l.id).temp === "cold");
    const temp: Temp = anyCold ? "cold" : "ambient";
    const charge = pick(opts.rates.charge, temp, way);
    const threshold = freeThresholdOf(lines.map((l) => infoOf(l.id).freeAt ?? 0), opts.rates, temp, way);
    const free = opts.allFree || subtotalAll >= threshold;
    const cost = pick(opts.rates.cost, temp, way);
    return {
      groups: [{ origin: -1, originName: "", temp, way, subtotal: subtotalAll, fee: free ? 0 : charge, cost, free, freeAt: threshold }],
      total: free ? 0 : charge,
      costTotal: cost,
    };
  }

  const map = new Map<string, FreightGroup>();
  /* 各組收集到的逐商品門檻，最後取最低（見 freeThresholdOf） */
  const overrides = new Map<string, number[]>();
  for (const l of lines) {
    const info = infoOf(l.id);
    const k = info.origin + "|" + info.temp;
    if (!map.has(k)) {
      map.set(k, { origin: info.origin, originName: info.originName, temp: info.temp, way, subtotal: 0, fee: 0, cost: 0, free: false, freeAt: 0 });
      overrides.set(k, []);
    }
    map.get(k)!.subtotal += l.price * l.qty;
    overrides.get(k)!.push(info.freeAt ?? 0);
  }
  const groups = [...map.values()];
  for (const g of groups) {
    const threshold = freeThresholdOf(overrides.get(g.origin + "|" + g.temp) || [], opts.rates, g.temp, g.way);
    g.freeAt = threshold;
    g.free = opts.allFree || g.subtotal >= threshold;
    g.fee = g.free ? 0 : pick(opts.rates.charge, g.temp, g.way);
    /* 成本與免不免運無關：貨照樣要寄，錢照樣要付。
       免運是站長的行銷決策，成本該站長扛，不能讓報表看不見。 */
    g.cost = pick(opts.rates.cost, g.temp, g.way);
  }
  return {
    groups,
    total: groups.reduce((s, g) => s + g.fee, 0),
    costTotal: groups.reduce((s, g) => s + g.cost, 0),
  };
}

/* 購物車裡有沒有冷鏈品（呼叫端用來決定要不要顯示冷凍相關提示） */
export function hasCold(lines: FreightLine[], infoOf: (productId: number) => OriginInfo): boolean {
  return lines.some((l) => infoOf(l.id).temp === "cold");
}

/*
 * 多地址企業單的運費試算（站長指示 2026-08-30）：
 * 無條件免第一位，其餘每一位照該溫層與其自選的取貨方式收費。
 * 這只是「算給站長看」的建議值，實際金額仍由站長填進付款連結——
 * 企業單本來就要談，自動算死反而綁手綁腳。
 */
export function multiShipQuote(
  recipients: { shipMethod?: string; qty?: number }[],
  temp: Temp,
  rates: RateTable
): { total: number; home: number; cvs: number; freeOne: number } {
  let home = 0;
  let cvs = 0;
  const ways: ShipWay[] = recipients.map((r) => (/店到店|超商/.test(String(r.shipMethod || "")) ? "cvs" : "home"));
  for (const w of ways) (w === "cvs" ? (cvs += 1) : (home += 1));
  /* 首位免運：扣掉第一位的費率（名單順序的第一位） */
  const firstWay = ways[0] || "home";
  const freeOne = pick(rates.charge, temp, firstWay);
  const gross = home * pick(rates.charge, temp, "home") + cvs * pick(rates.charge, temp, "cvs");
  return { total: Math.max(0, gross - freeOne), home, cvs, freeOne };
}
