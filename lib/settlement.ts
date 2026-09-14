import db from "./db";
import { allPartners, type Partner } from "./partner-db";
import { freightRates } from "./shop";
import { isMultiShip } from "./multi-ship";
import { isCvsMethod } from "./cvs";

/*
 * 夥伴結算報表（docs/multi-partner-spec.md 第八節）。
 *
 * 記帳規則是「正項記建單那期、負項記退款那期」：
 *   正項——期間內建立且有效收款的訂單（paid/shipped/done），含當時仍有效、
 *           後來才退款的（refunded 的正項仍記在建單期，那期的錢當時真的收了）。
 *   負項——期間內「發生退款」的訂單（refunded_at 落在區間），整筆沖回。
 * 同期買退＝正負相抵為零；跨期退款＝上期不動、本期出現負項扣回，
 * 對應協議「結算後退款自下期貨款扣回」。
 *
 * 歸屬按「商品目前的出貨夥伴」對照（訂單只有商品 id 快照）。
 * 商品有訂單引用時已禁止刪除；換歸屬前先把當期結完。
 */

export type SettleRow = {
  partnerId: number;            /* 0＝本店 */
  partnerName: string;
  sales: number;                /* 商品小計（含負項沖回） */
  units: number;
  freight: number;              /* 該出貨地的運費（含負項沖回） */
  refundOrders: number;         /* 期間內發生退款的單數 */
  addonRef: number;             /* 參考：含其商品的訂單帶進的加購（不拆帳，歸本店） */
  orderCount: number;           /* 期間內建立的有效訂單數 */
  /* 包裹數，按實際寄送方式拆——對帳運費時要知道各寄了幾件，
     光看運費總額分不出是「多件常溫」還是「少件冷凍」 */
  parcelHome: number;           /* 常溫宅配 */
  parcelCvs: number;            /* 常溫店到店 */
  parcelCold: number;           /* 冷凍宅配 */
  parcelColdCvs: number;        /* 冷凍店到店 */
  /* 運費成本：我實際要付的（免運照算，因為貨照樣要寄）。
     freight - freightCost ＝ 運費損益，會誠實反映免運政策貼了多少 */
  freightCost: number;
};

type OrderRow = { id: number; status: string; items: string; ship_detail: string; addon_amount: number; ship_method: string; shipping: number; ship_list: string };

export function settlement(fromIso: string, toIso: string): SettleRow[] {
  /* 成本費率：舊訂單沒有成本快照時的回退值 */
  const rates = freightRates();
  const partnerName = new Map<number, string>([[0, "問爽的本店"]]);
  for (const p of allPartners() as Partner[]) partnerName.set(p.id, p.name);

  const originOf = (() => {
    const cache = new Map<number, number>();
    const q = db.prepare("SELECT partner_id FROM products WHERE id=?");
    return (pid: number): number => {
      if (!cache.has(pid)) cache.set(pid, (q.get(pid) as { partner_id: number | null } | undefined)?.partner_id || 0);
      return cache.get(pid)!;
    };
  })();

  /* 舊訂單回退時要查商品的夥伴與溫層。prepare 提到迴圈外面：
     原本寫在 for 裡面，每一筆商品都重編一次同一句 SQL，六百多張單就是幾千次白工 */
  const originTempQ = db.prepare("SELECT partner_id, temp_zone FROM products WHERE id=?");

  const acc = new Map<number, SettleRow>();
  const row = (pid: number): SettleRow => {
    if (!acc.has(pid))
      acc.set(pid, { partnerId: pid, partnerName: partnerName.get(pid) || `夥伴 ${pid}`, sales: 0, units: 0, freight: 0, refundOrders: 0, addonRef: 0, orderCount: 0, parcelHome: 0, parcelCvs: 0, parcelCold: 0, parcelColdCvs: 0, freightCost: 0 });
    return acc.get(pid)!;
  };

  const apply = (o: OrderRow, sign: 1 | -1, markRefund: boolean) => {
    let items: { id: number; price: number; qty: number }[] = [];
    try { items = JSON.parse(o.items || "[]"); } catch { items = []; }
    const touched = new Set<number>();
    for (const it of items) {
      const pid = originOf(Number(it.id) || 0);
      const r = row(pid);
      r.sales += sign * (Number(it.price) || 0) * (Number(it.qty) || 0);
      r.units += sign * (Number(it.qty) || 0);
      touched.add(pid);
    }
    let groups: { origin: number; fee: number; cost?: number; temp?: string }[] = [];
    try { groups = JSON.parse(o.ship_detail || "[]"); } catch { groups = []; }
    const isCvs = isCvsMethod(o.ship_method);
    /*
     * 舊訂單的回退：ship_detail 是 2026-08-29 才加的欄位，在那之前成立的訂單
     * （中秋檔的六百多盒都是）那一欄是空的。沒有回退的話迴圈跑零次，
     * 報表會顯示「賣了六百盒但只有 8 件包裹」——銷售額對、運費全空，
     * 站長第一眼就會發現不對。
     *
     * 重建規則：運費用訂單實收的 shipping（那是當時真的收到的錢，最準）；
     * 包裹數多地址算收件人數、其餘算一件；歸屬給訂單裡第一個有夥伴的商品。
     *
     * 「第一個」這個近似只對舊訂單成立：改制前全站只有一個出貨地（蛋捲），
     * 一張單不可能跨夥伴。改制後的訂單都有 ship_detail，走上面那條精確路徑，
     * 不會落到這裡。所以這個近似不會把混買單的運費算錯給誰。
     */
    /*
     * 條件是「收過運費」而不是「運費 >= 0」：>= 0 永遠成立，等於每一張沒有
     * ship_detail 的單都會被重建成一件常溫宅配。收拍片服務費那種付款連結
     * （lib 的建單處寫死 shipping=0、ship_detail="[]"）根本沒有貨要出，
     * 卻會被憑空記上一件包裹與 120 元運費成本，夥伴報表的運費損益就永遠是負的。
     * 商品沒有「要不要出貨」的欄位可查，實收運費是唯一可靠的判準。
     */
    if (groups.length === 0 && Number(o.shipping) > 0) {
      let firstPid = 0;
      let cold = false;
      for (const it of items) {
        const pr = originTempQ.get(Number(it.id)) as
          | { partner_id: number | null; temp_zone: string }
          | undefined;
        if (pr?.partner_id) { firstPid = pr.partner_id; cold = pr.temp_zone === "cold"; break; }
      }
      let parcels = 1;
      if (isMultiShip(o.ship_method)) {
        try { parcels = Math.max(1, (JSON.parse(o.ship_list || "[]") as unknown[]).length); } catch { parcels = 1; }
      }
      const r = row(firstPid);
      r.freight += sign * (Number(o.shipping) || 0);
      r.freightCost += sign * parcels * (rates.cost[`${cold ? "cold" : "ambient"}-${isCvs ? "cvs" : "home"}`] || 0);
      if (cold && isCvs) r.parcelColdCvs += sign * parcels;
      else if (cold) r.parcelCold += sign * parcels;
      else if (isCvs) r.parcelCvs += sign * parcels;
      else r.parcelHome += sign * parcels;
    }
    for (const g of groups) {
      /* flat 模式的舊單 origin=-1：運費歸本店（拆不出來，也不該憑空分給誰） */
      const r = row(g.origin > 0 ? g.origin : 0);
      r.freight += sign * (Number(g.fee) || 0);
      /*
       * 成本：優先用訂單成立當下寫進 ship_detail 的快照，那才是當時的真實費率。
       * 舊訂單沒有這個欄位（改制前建立的），回退用現在的費率表估——會有誤差，
       * 但總比整欄空白讓站長算不出要付多少好。
       */
      const cold = g.temp === "cold";
      const way = isCvs ? "cvs" : "home";
      const cost = Number(g.cost);
      r.freightCost += sign * (Number.isFinite(cost) && cost > 0 ? cost : rates.cost[`${cold ? "cold" : "ambient"}-${way}`] || 0);
      /* 一個 group＝一個實際寄出的包裹，按溫層與取貨方式分四種 */
      if (cold && isCvs) r.parcelColdCvs += sign;
      else if (cold) r.parcelCold += sign;
      else if (isCvs) r.parcelCvs += sign;
      else r.parcelHome += sign;
    }
    for (const pid of touched) {
      const r = row(pid);
      if (sign > 0) {
        r.orderCount += 1;
        if (o.addon_amount > 0) r.addonRef += o.addon_amount;
      }
      if (markRefund) r.refundOrders += 1;
    }
  };

  /* 正項：期間內建立、收過款的訂單（含後來退款的——那期的錢當時真的收了） */
  const positives = db
    .prepare(
      "SELECT id,status,items,COALESCE(ship_detail,'') ship_detail,COALESCE(addon_amount,0) addon_amount,COALESCE(ship_method,'') ship_method,COALESCE(shipping,0) shipping,COALESCE(ship_list,'') ship_list FROM orders WHERE created_at>=? AND created_at<? AND status IN ('paid','shipped','done','refunded')"
    )
    .all(fromIso, toIso) as OrderRow[];
  for (const o of positives) apply(o, 1, false);

  /* 負項：期間內發生退款的訂單（不論何時建立），整筆沖回 */
  const negatives = db
    .prepare(
      "SELECT id,status,items,COALESCE(ship_detail,'') ship_detail,COALESCE(addon_amount,0) addon_amount,COALESCE(ship_method,'') ship_method,COALESCE(shipping,0) shipping,COALESCE(ship_list,'') ship_list FROM orders WHERE status='refunded' AND refunded_at>=? AND refunded_at<?"
    )
    .all(fromIso, toIso) as OrderRow[];
  for (const o of negatives) apply(o, -1, true);

  return [...acc.values()].sort((a, b) => a.partnerId - b.partnerId);
}
