"use client";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { money } from "@/lib/format";
import { useRouter } from "next/navigation";
import { useCart } from "./CartProvider";
import { splitChoices } from "@/lib/choice-split";
import { fbTrack } from "./MetaPixel";

export default function BuyPanel({
  id,
  name,
  price,
  stock,
  optionName,
  choices,
  soldout = [],
  soldoutLabel = "已滿",
  collapseSoldout = false,
  corpEntry = false,
  image = "",
}: {
  id: number;
  name: string;
  price: number;
  stock: number;
  optionName: string | null;
  choices: string[];
  soldout?: string[];
  soldoutLabel?: string;
  collapseSoldout?: boolean;
  /* 顯示企業訂購入口（禮盒類商品）：站長指示放在數量正下方 */
  corpEntry?: boolean;
  image?: string;
}) {
  /* 預設選第一個還買得到的規格 */
  const [choice, setChoice] = useState<string | null>(choices.find((c) => !soldout.includes(c)) ?? choices[0] ?? null);
  const [qty, setQty] = useState(1);
  const [added, setAdded] = useState(false);
  const { add } = useCart();
  const router = useRouter();

  /* 固定列必須掛到 body 才會真的貼齊視窗底部。
     版面外層的 .page-fade 帶著 transform（頁面淡入動畫），而只要祖先有 transform，
     position:fixed 就改成相對那個祖先定位，實測固定列被丟到畫面外六千多像素。
     用 Portal 跳出去最乾淨，不必為了一顆按鈕改動全站的進場動畫。 */
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  /* 手機固定購買列：一進商品頁就固定在畫面底部，捲到哪裡都按得到。
     原本設計成「捲過內文按鈕才出現」，但站長要的是一直都在，
     所以改成常駐，並在手機把內文那組按鈕隱藏（同一組東西不必出現兩份）。
     桌機是左右兩欄、按鈕一直在右側視線內，這一列由 CSS 在 820px 以上隱藏。 */

  const oos = stock === 0;
  /* 可選的、額滿的、要不要收合，判斷全在 lib/choice-stock.ts（純函式，有冒煙測試） */
  const split = splitChoices(choices, soldout, collapseSoldout);
  /* 全規格都額滿＝跟沒庫存一樣不能買 */
  const allFull = split.allFull;
  const blocked = oos || allFull || (optionName !== null && choice !== null && soldout.includes(choice));

  function doAdd() {
    if (blocked) return;
    add({ id, name, choice: optionName ? choice : null, price, qty, img: image });
    /* 金額用這次加入的數量算，不是單價 */
    fbTrack("AddToCart", price * qty, name);
    setAdded(true);
    setTimeout(() => setAdded(false), 1800);
  }

  return (
    <>
      {optionName && choices.length > 0 && (
        <div className="opt">
          <label>{optionName}</label>
          {/* 收合時上面只留可選的，額滿的收進 details；沒收合就照原本的順序全部列出 */}
          <div className="choices">
            {(split.collapse ? split.open : choices).map((c) => {
              const full = soldout.includes(c);
              return (
                <span
                  key={c}
                  className={`c${choice === c ? " on" : ""}${full ? " dis" : ""}`}
                  onClick={() => !full && setChoice(c)}
                >
                  {c}
                  {full && `（${soldoutLabel}）`}
                </span>
              );
            })}
          </div>
          {/* details 是原生標籤：鍵盤走得到、螢幕閱讀器讀得出來，而且不必寫任何 JS。
              每次進頁面都是收合狀態，不記憶展開與否（記憶要動 localStorage，不值得）。
              裡面的格子不再重複標「額滿」，標題已經講完了。 */}
          {split.collapse && (
            <details className="fold">
              <summary>已額滿的選項（{split.full.length}）</summary>
              <div className="choices">
                {split.full.map((c) => (
                  <span key={c} className="c dis">{c}</span>
                ))}
              </div>
            </details>
          )}
          {/* 全部額滿：不收合（收了就一個格子都不剩，看起來像壞掉），改成把話講明白。
              文案不能寫「出貨週」，這是共用元件，衣服尺寸全滿時也會走到這裡。 */}
          {split.allFull && collapseSoldout && (
            <p className="allfull">目前所有選項都已額滿，補貨會在 IG 公告。</p>
          )}
        </div>
      )}
      <div className="opt">
        <label>數量</label>
        <div className="qty">
          <button onClick={() => setQty(Math.max(1, qty - 1))}>−</button>
          <span className="sans">{qty}</span>
          <button onClick={() => setQty(Math.min(stock || 1, qty + 1))}>＋</button>
        </div>
      </div>
      {/* 站長指示（2026-08-29）：拿掉「立即購買」，換成「查看購物車」——
          商品頁原本沒有任何通往購物車的入口，客人加完東西找不到車在哪。
          加入購物車升為主色；查看購物車是純導頁，不加東西，所以永遠可按（不吃 blocked）。 */}
      <div className="d-actions">
        <button className="btn fill" onClick={() => doAdd()} disabled={blocked}>
          {added ? "已加入 ✓" : "加入購物車"}
        </button>
        <button className="btn" onClick={() => router.push("/cart")}>
          查看購物車
        </button>
      </div>

      {/* 常駐固定購買列（手機）。桌機由 CSS 隱藏。掛在 body 上，見上方說明。 */}
      {mounted &&
        createPortal(
          <div className="buy-bar">
            <div className="inner">
              <div className="p">
                <span className="lb">{optionName && choice ? choice : "單價"}</span>
                <b>{money(price * qty)}</b>
              </div>
              <div className="b">
                <button className="btn fill" onClick={() => doAdd()} disabled={blocked}>
                  {added ? "已加入 ✓" : "加入購物車"}
                </button>
                <button className="btn" onClick={() => router.push("/cart")}>
                  查看購物車
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
