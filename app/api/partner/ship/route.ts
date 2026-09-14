import { NextRequest, NextResponse } from "next/server";
import { notifyOrderLine, orderStatusUrl, type LineOrderLike } from "@/lib/line";
import db from "@/lib/db";
import { viewerScope, type Partner } from "@/lib/partner";
import { sendOrderShippedMail } from "@/lib/mail";
import { isMultiShip, recipientAddress, type ShipRecipient } from "@/lib/multi-ship";
import { rateLimit, clientIp } from "@/lib/ratelimit";

type Item = { id: number; name: string; choice: string | null; qty: number; shipped?: number };

/*
 * 夥伴標記出貨——「逐品項」，不是整筆訂單。
 *
 * 一筆訂單可以買好幾個出貨週（送不同人），第一週出了不代表其他週也出了。
 * 之前整筆標 shipped 的版本讓同單其他週全部顯示已出貨，是錯的。
 * 現在把 shipped 旗標寫在 items JSON 的那一個品項上；
 * 全部品項都出完，訂單狀態才轉 shipped。
 *
 * 不處理物流單號（站長不使用）。每出一批寄一封通知信給顧客，
 * 信裡講清楚這批是哪一週的什麼。
 * 整段包在 transaction 裡：better-sqlite3 同步執行，單一進程內不會交錯，
 * 兩個人同時按不同品項也不會弄丟彼此的旗標。
 */
export async function POST(req: NextRequest) {
  const scope = await viewerScope();
  if (!scope) return NextResponse.json({ error: "沒有權限" }, { status: 401 });
  if (!rateLimit(`pship:${clientIp(req.headers)}`, 120, 60 * 60 * 1000))
    return NextResponse.json({ error: "操作太頻繁，請稍後再試" }, { status: 429 });

  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "格式錯誤" }, { status: 400 });
  const orderNo = String(form.get("order_no") || "").trim();
  /*
   * 兩種出貨單位：
   *   item_idx  一般訂單，逐品項（同一單可以買好幾個出貨週）
   *   recip_idx 多地址配送，逐收件人（一次付款、貨分寄很多地址）
   * 兩者互斥。多地址的那一列不會有品項可標，一般訂單也不會有名單。
   */
  const rawRecip = form.get("recip_idx");
  const isRecip = rawRecip !== null && String(rawRecip).trim() !== "";
  const recipIdx = isRecip ? Number(rawRecip) : -1;
  const itemIdx = isRecip ? -1 : Number(form.get("item_idx"));
  if (!orderNo) return NextResponse.json({ error: "缺少訂單編號" }, { status: 400 });
  if (isRecip ? !Number.isInteger(recipIdx) || recipIdx < 0 : !Number.isInteger(itemIdx) || itemIdx < 0)
    return NextResponse.json({ error: "缺少品項或收件人" }, { status: 400 });

  const result = db.transaction(() => {
    const o = db
      .prepare("SELECT id,order_no,status,items,ship_method,ship_list FROM orders WHERE order_no=?")
      .get(orderNo) as
      | { id: number; order_no: string; status: string; items: string; ship_method: string; ship_list: string }
      | undefined;
    if (!o) return { kind: "notfound" as const };
    if (o.status === "shipped" || o.status === "done") return { kind: "already" as const };
    if (o.status !== "paid") return { kind: "badstatus" as const, status: o.status };

    /*
     * 歸屬檢查：夥伴只能動自己商品的貨。
     * 只驗「能不能進門」是不夠的——A 夥伴把表單參數換個訂單編號就能標到 B 的貨，
     * 而且標了也不會被發現（他的工作台看不到那筆），貨就漏出了。
     *
     * 兩種單的判準不同：
     *   逐品項（一般訂單）——一車可以混好幾個夥伴的商品，必須驗「這一個品項」是他的。
     *   逐收件人（多地址企業單）——名單掛在整筆訂單上拆不開，而付款連結已限制
     *   單一出貨地，所以「訂單裡有任一品項屬於他」＝整單都是他的。
     */
    const ownsProduct = (productId: number): boolean => {
      if (scope === "admin") return true;
      const row = db.prepare("SELECT partner_id FROM products WHERE id=?").get(Number(productId)) as { partner_id: number | null } | undefined;
      return row?.partner_id === (scope as Partner).id;
    };

    /* ── 多地址配送：標記名單裡的某一位 ── */
    if (isRecip) {
      if (!isMultiShip(o.ship_method)) return { kind: "badmode" as const };
      try {
        const its = JSON.parse(o.items || "[]") as { id: number }[];
        if (!its.some((x) => ownsProduct(x.id))) return { kind: "notfound" as const };
      } catch { return { kind: "notfound" as const }; }
      let list: ShipRecipient[] = [];
      try { list = JSON.parse(o.ship_list || "[]"); } catch { list = []; }
      const r = list[recipIdx];
      if (!r) return { kind: "notfound" as const };
      if (r.shipped) return { kind: "already" as const };
      r.shipped = 1;
      const allShipped = list.every((x) => x.shipped);
      db.prepare("UPDATE orders SET ship_list=?, status=? WHERE id=? AND status='paid'").run(
        JSON.stringify(list),
        allShipped ? "shipped" : "paid",
        o.id
      );
      return { kind: "recip" as const, recip: r, allShipped, done: list.filter((x) => x.shipped).length, total: list.length };
    }

    let items: Item[] = [];
    try { items = JSON.parse(o.items || "[]"); } catch { items = []; }
    const it = items[itemIdx];
    if (!it) return { kind: "notfound" as const };
    if (!ownsProduct(it.id)) return { kind: "notfound" as const };
    if (it.shipped) return { kind: "already" as const };

    it.shipped = 1;
    const allShipped = items.every((x) => x.shipped);
    db.prepare("UPDATE orders SET items=?, status=? WHERE id=? AND status='paid'").run(
      JSON.stringify(items),
      allShipped ? "shipped" : "paid",
      o.id
    );
    return { kind: "ok" as const, item: it, allShipped };
  })();

  if (result.kind === "notfound") return NextResponse.json({ error: "查無此訂單或品項" }, { status: 404 });
  if (result.kind === "already") return NextResponse.json({ ok: true, already: true });
  if (result.kind === "badmode")
    return NextResponse.json({ error: "這筆訂單的出貨方式不是多地址配送" }, { status: 400 });
  if (result.kind === "badstatus")
    return NextResponse.json({ error: `這筆訂單目前是「${result.status === "pending" ? "待付款" : result.status}」，不能標出貨` }, { status: 400 });

  const full = db.prepare("SELECT * FROM orders WHERE order_no=?").get(orderNo) as Parameters<typeof sendOrderShippedMail>[0];

  /*
   * 多地址的通知信一律寄給「主要訂購人」，不寄給各收件人——
   * 收件人多半是被送禮的人，我們沒有他的信箱，也不該在他不知情的狀況下寄信給他。
   * 訂購人要知道的是：這一位寄出去了，還剩幾位。
   */
  if (result.kind === "recip") {
    const r = result.recip;
    const where = recipientAddress(r);
    /*
     * 多地址只通知兩次（站長 2026-09-05）：第一位寄出時說「開始出貨，共 N 位會陸續寄出」，
     * 全部寄完再說一次。中間每一位都寄的話，33 位就是 33 封，對方會以為系統壞了。
     */
    const first = result.done === 1;
    if (first || result.allShipped) {
      const note = result.allShipped
        ? `這筆訂單的 ${result.total} 位收件人都已寄出完畢（最後一位：${r.name}，${where}，× ${r.qty}）。`
        : `開始出貨：第一位是 ${r.name}（${where}）× ${r.qty}，共 ${result.total} 位會在這幾天陸續寄出，全部寄完會再通知你一次。`;
      void sendOrderShippedMail(full, { note });
      void notifyOrderLine("shipped", full as LineOrderLike, { info: note, url: orderStatusUrl(full.order_no, (full as LineOrderLike).token || "") }).catch((e) => console.error("[line] shipped", e));
    }
    return NextResponse.json({ ok: true, allShipped: result.allShipped });
  }

  const it = result.item;
  const what = `${it.name}${it.choice ? `（${it.choice}）` : ""} × ${it.qty}`;
  const note = result.allShipped
    ? `本次出貨：${what}。你這筆訂單的所有品項都已出貨完畢。`
    : `本次出貨：${what}。其他品項會依你選的出貨週分批寄出，每批都會再通知你。`;
  void sendOrderShippedMail(full, { note });
  void notifyOrderLine("shipped", full as LineOrderLike, { info: note, url: orderStatusUrl(full.order_no, (full as LineOrderLike).token || "") }).catch((e) => console.error("[line] shipped", e));
  return NextResponse.json({ ok: true, allShipped: result.allShipped });
}
