"use client";
import { useEffect, useState } from "react";
import { fbTrack } from "./MetaPixel";
import Link from "next/link";
import { useCart } from "./CartProvider";
import { money } from "@/lib/format";
import { computeFreight, type FreightGroup, type OriginInfo, type RateTable } from "@/lib/freight";

export function Totals({
  subtotal,
  freeShip,
  shipFee,
}: {
  subtotal: number;
  freeShip: number;
  shipFee: number;
}) {
  const ship = subtotal === 0 ? 0 : subtotal >= freeShip ? 0 : shipFee;

  return (
    <div className="totals">
      <div className="row">
        <span>小計</span>
        <span className="sans">{money(subtotal)}</span>
      </div>
      <div className="row">
        <span>
          運費（常溫宅配{ship === 0 && subtotal > 0 ? `・滿 ${freeShip.toLocaleString()} 免運` : ""}）
        </span>
        <span className="sans">{money(ship)}</span>
      </div>
      <div className="row grand">
        <span>總金額</span>
        <span className="sans">{money(subtotal + ship)}</span>
      </div>
    </div>
  );
}

/* 免運進度：差多少就免運（最強的湊單誘因），達標時大聲說出來。
   多包裹（跨出貨地）時逐組顯示——整車合併的進度條會謊報免運，
   客人到結帳明細才發現要收兩份運費，那比不顯示更糟。

   門檻一律讀 g.freeAt（那一組真正採用的數字），不要用網站設定的單一門檻。
   踩過的坑：許愿的冷凍禮盒兩盒免運（1360），進度條卻拿常溫的 1440 去算，
   畫面說「再湊 $680」，客人湊了、結帳卻還是被收運費。 */
export function FreeShipMeter({ groups }: { groups: FreightGroup[] }) {
  /* 門檻可能是 Infinity（費率表沒填＝這個組根本沒有免運這回事），那一組不畫進度條 */
  const hasGoal = (g: FreightGroup) => Number.isFinite(g.freeAt) && g.freeAt > 0;
  if (groups.length === 0 || !groups.some(hasGoal)) return null;
  if (groups.length === 1) {
    const g = groups[0];
    const pct = Math.min(100, Math.round((g.subtotal / g.freeAt) * 100));
    return (
      <div className={`freeship${g.free ? " ok" : ""}`}>
        <div className="fs-text">
          {g.free ? (
            <b>已達免運門檻，這單運費 $0 🎉</b>
          ) : (
            <>再湊 <b className="sans">{money(g.freeAt - g.subtotal)}</b> 就免運　<Link href="/shop">去湊一件 →</Link></>
          )}
        </div>
        <div className="fs-track"><span style={{ width: `${pct}%` }} /></div>
      </div>
    );
  }
  /* 多出貨地：一組一條進度條。只講「再湊多少」，不在這裡標運費數字——
     這一區的任務是湊單誘因，數字留給下面的結帳明細講 */
  return (
    <div className="freeship">
      <div className="fs-text" style={{ marginBottom: 6 }}>
        這單會分成 {groups.length} 個包裹寄出，免運各自計算：
      </div>
      {/* 逐組列出「全部」的包裹，不只有設了門檻的那些——
          少列一行，客人會以為只寄兩包、只算兩份運費 */}
      {groups.map((g) => {
        const pct = hasGoal(g) ? Math.min(100, Math.round((g.subtotal / g.freeAt) * 100)) : 0;
        return (
          <div key={`${g.origin}-${g.temp}`} className={`freeship sub${g.free ? " ok" : ""}`} style={{ margin: "6px 0 0", padding: 0, border: 0 }}>
            <div className="fs-text">
              {g.originName}{g.temp === "cold" ? "（低溫）" : ""}：
              {g.free ? (
                <b>已達免運 🎉</b>
              ) : hasGoal(g) ? (
                <>再湊 <b className="sans">{money(g.freeAt - g.subtotal)}</b> 就免運　<Link href="/shop">去湊一件 →</Link></>
              ) : (
                <>這個包裹沒有免運門檻</>
              )}
            </div>
            {hasGoal(g) && <div className="fs-track"><span style={{ width: `${pct}%` }} /></div>}
          </div>
        );
      })}
    </div>
  );
}

type Rec = { id: number; name: string; price: number; image: string; category: string };

export default function CartView({ freeShip, shipFee, recs = [], origins = {}, freightMode = "flat", rates }: { freeShip: number; shipFee: number; recs?: Rec[]; origins?: Record<number, { origin: number; name: string; temp: "ambient" | "cold"; freeAt?: number }>; freightMode?: "origin" | "flat"; rates?: RateTable }) {
  const { cart, setQty, remove } = useCart();
  const subtotal = cart.reduce((s, i) => s + i.price * i.qty, 0);
  /* 與結帳表單、伺服器同一份運費引擎；購物車階段還沒選取貨方式，先按宅配估 */
  const infoOf = (id: number): OriginInfo => {
    const o = origins[id];
    return { origin: o?.origin ?? 0, originName: o?.name ?? "問爽的本店", temp: o?.temp ?? "ambient", freeAt: o?.freeAt ?? 0 };
  };
  /* 購物車階段還沒選取貨方式，一律先按宅配估（結帳頁選了超商會重算） */
  const rateTable: RateTable = rates ?? {
    charge: { "ambient-home": shipFee, "ambient-cvs": shipFee, "cold-home": 280, "cold-cvs": 145 },
    cost: { "ambient-home": 0, "ambient-cvs": 0, "cold-home": 0, "cold-cvs": 0 },
    free: { "ambient-home": freeShip, "ambient-cvs": freeShip, "cold-home": 3000, "cold-cvs": 3000 },
  };
  const freight = computeFreight(cart.map((i) => ({ id: i.id, price: i.price, qty: i.qty })), infoOf, {
    mode: freightMode, isCvs: false, rates: rateTable, allFree: false,
  });
  const ship = freight.total;
  const inCart = new Set(cart.map((i) => i.id));
  const recPool = recs.filter((r) => !inCart.has(r.id));
  /* 只有一種可推薦時不顯示「湊一件」（沒得選就不湊） */
  const showRecs = recPool.length > 1 ? recPool.slice(0, 3) : [];

  if (cart.length === 0) {
    return (
      <div className="empty">
        購物車是空的
        <br />
        <br />
        <Link className="btn" href="/shop">去逛逛</Link>
      </div>
    );
  }

  /* 結帳表單是否已經在畫面上，決定 sticky 列那顆按鈕的文字與目的地 */
  const [atForm, setAtForm] = useState(false);
  useEffect(() => {
    const el = document.getElementById("checkout-form");
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setAtForm(e.isIntersecting), { threshold: 0 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <>
      <div className="cart-table">
        {cart.map((i) => (
          <div className="cart-row" key={i.key}>
            {i.img ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img className="thumb img-fill" src={i.img} alt={i.name} />
            ) : (
              <div className="thumb ph" />
            )}
            <div className="n">
              <b>{i.name}</b>
              <small>
                {i.choice ? `${i.choice}　` : ""}單價 {money(i.price)}
              </small>
            </div>
            <div className="qty">
              <button aria-label="減少數量" onClick={() => setQty(i.key, i.qty - 1)}>−</button>
              <span className="sans">{i.qty}</span>
              <button aria-label="增加數量" onClick={() => setQty(i.key, i.qty + 1)}>＋</button>
            </div>
            <div className="sub-p sans">{money(i.price * i.qty)}</div>
            <button className="rm" onClick={() => remove(i.key)}>刪除</button>
          </div>
        ))}
      </div>

      <FreeShipMeter groups={freight.groups} />
      {/* 金額明細與結帳都在同一頁下方的表單；信任小字移到頁尾金流說明區（cart/page.tsx） */}

      {/* 湊單推薦：不在購物車裡的精選商品（也是湊免運的路） */}
      {showRecs.length > 0 && (
        <div className="cart-recs">
          <div className="h">順 便 湊 一 件</div>
          <div className="rec-grid">
            {showRecs.map((r) => (
              <Link key={r.id} className="rec" href={`/shop/${r.id}`}>
                {r.image ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img className="img-fill" src={r.image} alt={r.name} />
                ) : (
                  <div className="ph" style={{ height: 90 }} />
                )}
                <b>{r.name}</b>
                <span className="sans">{money(r.price)}</span>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* 手機 sticky 結帳列：總金額一直在手邊。
          還沒捲到結帳表單時是「往下結帳」（把人帶下去），
          已經在表單裡了就改成「前往結帳」並指向送出鈕——這時再說「往下」沒有意義。 */}
      <div className="cart-sticky">
        <div className="cs-total">
          <small>總金額{ship === 0 ? "（免運）" : "（含運費）"}</small>
          <b className="sans">{money(subtotal + ship)}</b>
        </div>
        {/* 只有「往下結帳」那一次算 InitiateCheckout：那是真的開始結帳的動作。
            已經在表單裡再按「前往結帳」只是捲到送出鈕，同一次瀏覽再送一次會灌水。 */}
        <a
          className="btn fill"
          href={atForm ? "#checkout-submit" : "#checkout-form"}
          onClick={() => { if (!atForm) fbTrack("InitiateCheckout", subtotal + ship); }}
        >
          {atForm ? "前往結帳" : "往下結帳"}
        </a>
      </div>
    </>
  );
}
