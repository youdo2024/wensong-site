import type { Metadata } from "next";
import { buildMetadata } from "@/lib/seo";
import Link from "next/link";
import Nav from "@/components/Nav";
import { isPayMethodOff, navSupportShop } from "@/lib/shop";
import Footer from "@/components/Footer";
import db from "@/lib/db";
import { money } from "@/lib/format";
import { FbEvent } from "@/components/MetaPixel";
import { linepayEnabled } from "@/lib/linepay";
import { lineNotifyOn, findLineBinding, addFriendUrl, bindUrlFor } from "@/lib/line";
import LineAskCard from "@/components/LineAskCard";

export const metadata: Metadata = buildMetadata({ title: "訂單成立", path: "/shop/thanks", noindex: true });
export const dynamic = "force-dynamic";

export default async function ShopThanks({
  searchParams,
}: {
  searchParams: Promise<{ no?: string; pay?: string; k?: string; why?: string; line?: string }>;
}) {
  const { no, pay, k, why, line } = await searchParams;
  const failed = pay === "failed";
  /* 通知裡的「重選付款方式」：待付款也能看到三顆換方式按鈕，同一張單、庫存不動 */
  const choose = pay === "choose";
  const pending = pay === "pending";
  /* 帶出訂單金額與繳費資訊——但只有權杖（k）與該訂單相符才顯示，
     否則任何人都能用訂單編號枚舉金額與 ATM 繳費字串。權杖不符時仍正常顯示成功畫面
     （明細已寄到 email），付款流程完全不受影響。 */
  const row = no
    ? (db.prepare("SELECT pay_note,total,token,status,pay_method,pay_link,phone,email,line_optin FROM orders WHERE order_no=?").get(no) as
        { pay_note: string; total: number; token: string; status: string; pay_method: string; pay_link: string; phone: string; email: string; line_optin: number } | undefined)
    : undefined;
  /* 有 token 的訂單（2026-08-10 之後建立）要求權杖相符，擋掉編號枚舉；
     token 為空的舊訂單維持原行為照常顯示——否則舊的 ATM 待付款顧客
     回到這頁會看不到繳費帳號，那是功能退步不是修補。舊訂單會隨時間自然消失。 */
  const order = row && (!row.token || (k && k === row.token)) ? row : undefined;
  /*
   * 付款失敗救援：跟贊助頁同一套。原本這裡只寫「回商店重新下單即可」，
   * 但購物車在建立訂單當下就清空了，等於要顧客把收件人、地址、發票整張重打。
   * 實際發生過同一位顧客為了換付款方式而開出兩張訂單、兩筆都卡在待付款。
   * 訂單還在待付款、權杖也對得上，就給免重填的換方式按鈕。
   */
  /*
   * 救援按鈕的條件原本是「待付款」，但金流回報失敗時訂單已經被標成已取消，
   * 所以這顆按鈕在它最該出現的情境下反而不會出現。
   * 因刷卡失敗而取消的也要能重試，真正的庫存檢查在對方點下去時才做。
   */
  const failCancelled =
    order?.status === "cancelled" &&
    /付款未完成|付款失敗|授權失敗|LINE Pay 請款失敗/.test(order.pay_note || "") &&
    !(order.pay_note || "").includes("後續已由");
  const rescue = (failed || choose) && no && k && order && order.token === k && (order.status === "pending" || failCancelled) ? { no, k } : null;
  const payUrl = (m?: string) =>
    `/api/orders/pay?no=${encodeURIComponent(rescue?.no || "")}&t=${encodeURIComponent(rescue?.k || "")}${m ? `&m=${encodeURIComponent(m)}` : ""}`;
  return (
    <>
      {/* purchase 改由伺服器端在「確認入帳」當下回報 GA（lib/ga.ts gaPurchaseEvent，
          含金額與品項明細），這裡不再發瀏覽器端事件 */}
      {/* Meta 廣告優化要靠瀏覽器像素的 Purchase 事件（付款成功才發） */}
      {/* dedupeKey＝訂單編號：重新整理感謝頁不會重複計 Purchase */}
      {/* 連結型訂單不送廣告像素：那是站長私下談成的，灌進 Meta 會讓它以為
          某個廣告超級有效而把預算推往錯的地方，這種汙染很難事後拆開。
          錢是真的收到，後台業績照算（後台直接讀資料庫，不受這裡影響）。 */}
      {!failed && !pending && !choose && !row?.pay_link && <FbEvent name="Purchase" value={order?.total} dedupeKey={no} />}
      <Nav showCart hideSupport={!navSupportShop()} />
      <div className="frame" style={{ padding: "72px 20px 120px" }}>
        <div className="box" style={{ maxWidth: 560, margin: "0 auto" }}>
          <div className="band" />
          <div className="inner center">
            <h2 style={{ fontSize: 26, fontWeight: 900, letterSpacing: ".14em" }}>
              {failed ? "付款沒有完成" : choose ? "換一種付款方式" : pending ? "訂單成立，等你付款" : "訂單成立，謝謝你"}
            </h2>
            <p style={{ color: "var(--grey)", fontSize: 15, marginTop: 10 }}>
              訂單編號　<b className="sans" style={{ color: "var(--seal)" }}>{no}</b>
            </p>
            <p style={{ color: "var(--grey)", fontSize: 14, marginTop: 6 }}>
              {choose ? (
                <>這筆訂單還沒完成付款，商品先幫你留著。<br />選一種方式接著付，資料不用重填：</>
              ) : failed ? (
                rescue ? (
                  <>這筆訂單的付款沒有完成，沒有扣款，商品也還幫你留著。<br />別重填了，直接換一種方式再試一次：</>
                ) : (
                  <>這筆訂單的付款被取消或失敗了，商品沒有扣款。<br />想再試一次的話，回商店重新下單即可。</>
                )
              ) : pending ? (
                <>ATM 繳費資訊如下（也會寄到你的信箱），<br />完成轉帳後訂單會自動變成已付款，可用訂單編號 + Email 查詢。</>
              ) : (
                <>訂單確認信已寄到你的信箱，出貨當天會再寄一封通知你。<br />可隨時用訂單編號 + Email 查詢進度。</>
              )}
            </p>
            {pending && order?.pay_note && (
              <p style={{ fontSize: 15.5, border: "2px solid var(--indigo, #2C4A6B)", color: "var(--indigo, #2C4A6B)", padding: "14px 18px", marginTop: 16, lineHeight: 1.9 }}>
                {/* 「（xx 前完成）」自己一行（站長 2026-09-04） */}
                {(() => { const m = /^(.*?)(（[^）]*前完成）)\s*$/.exec(order.pay_note); return m ? <>{m[1].trim()}<br />{m[2].replace(/^（|）$/g, "").replace(/^/, "請於 ")}</> : order.pay_note; })()}
                <br />應付金額　<b className="sans">{money(order.total)}</b>
              </p>
            )}
            {rescue && (
              <div style={{ display: "flex", flexDirection: "column", gap: 10, maxWidth: 320, margin: "22px auto 0" }}>
                {/* ATM 不需跳轉驗證，實測成功率最高，放第一 */}
                {/* 每一顆都要過停用名單：後台關掉的方式，救援也不能給。
                    先前只有結帳頁看名單，這裡沒看，等於把人送去一個站方已停用的付款方式 */}
                {!isPayMethodOff("ATM 轉帳") && order?.pay_method !== "ATM 轉帳" && (
                  <Link className="btn fill" href={payUrl("ATM 轉帳")}>改用 ATM 轉帳（最穩）</Link>
                )}
                {linepayEnabled() && !isPayMethodOff("LINE Pay") && order?.pay_method !== "LINE Pay" && (
                  <Link className="btn" href={payUrl("LINE Pay")}>改用 LINE Pay</Link>
                )}
                {!isPayMethodOff("信用卡") && order?.pay_method !== "信用卡" && <Link className="btn" href={payUrl("信用卡")}>改用信用卡</Link>}
                {!(order?.pay_method && isPayMethodOff(order.pay_method)) && (
                  <Link className="btn" href={payUrl()}>用原方式再試一次</Link>
                )}
              </div>
            )}
            {/* 重試被擋下來的原因（多半是庫存已經賣掉了），要講清楚不要讓人一直按 */}
            {why && <p className="msg-err" style={{ marginTop: 12 }}>{why}</p>}
            {/*
              * LINE 通知綁定（規格 docs/line-notify-spec.md 第三節）。
              * 只在權杖相符、且訂單有權杖時出現。狀態四種：已綁定／登入了沒加好友／結帳有勾（大按鈕）／沒勾（再問一次的卡片）。
              */}
            {lineNotifyOn() && order?.token && no && (() => {
              const b = findLineBinding({ phone: order.phone, email: order.email });
              const bound = line === "bound" || b?.status === "bound";
              const nofriend = !bound && (line === "nofriend" || b?.status === "nofriend");
              const bindUrl = `${bindUrlFor(no, order.token)}&src=thanks`;
              if (bound)
                return <p className="msg-ok" style={{ marginTop: 18 }}>已用 LINE 綁定，付款與出貨進度會直接在 LINE 通知你。</p>;
              if (nofriend)
                return (
                  <div style={{ marginTop: 18, padding: "14px 16px", border: "2px solid #06C755", textAlign: "center" }}>
                    <p style={{ fontSize: 14.5, lineHeight: 1.9, margin: "0 0 10px" }}>還差一步：要加官方帳號好友，通知才送得到。</p>
                    {addFriendUrl() && <a className="btn" href={addFriendUrl()} target="_blank" rel="noopener" style={{ background: "#06C755", color: "#fff", borderColor: "#06C755" }}>加入 LINE 好友</a>}
                    <p className="fine" style={{ marginTop: 10 }}>加好友之後<a href={bindUrl} style={{ textDecoration: "underline" }}>再按一次綁定</a>就完成。</p>
                  </div>
                );
              if (line === "fail")
                return <p className="msg-err" style={{ marginTop: 18 }}>LINE 綁定沒有完成，<a href={bindUrl} style={{ textDecoration: "underline" }}>再試一次</a>，或之後從確認信裡的按鈕綁定。</p>;
              if (order.line_optin)
                return (
                  <div style={{ marginTop: 18, padding: "16px 18px", border: "2px solid #06C755", textAlign: "center" }}>
                    <p style={{ fontSize: 15, fontWeight: 700, lineHeight: 1.9, margin: "0 0 10px" }}>最後一步：加入 LINE 好友，完成通知綁定</p>
                    <a className="btn" href={bindUrl} style={{ background: "#06C755", color: "#fff", borderColor: "#06C755", fontSize: 16, padding: "13px 30px" }}>用 LINE 收通知</a>
                    <p className="fine" style={{ marginTop: 10, fontSize: 11.5 }}>按一下就好，不用打字。綁定即同意用 LINE 接收訂單通知，封鎖官方帳號即取消。</p>
                  </div>
                );
              return <LineAskCard orderNo={no} bindUrl={bindUrl} />;
            })()}
            {/* 金流回應：LINE Pay 建立失敗那種是金鑰層級的錯，客人看到「1104 Merchant not found」只會更慌，改講人話 */}
            {failed && order?.pay_note && (
              <p style={{ fontSize: 12.5, color: "var(--grey)", marginTop: 10 }}>
                {/LINE Pay 建立失敗/.test(order.pay_note)
                  ? "LINE Pay 暫時無法使用，這不是你的問題。請改用上面的 ATM 轉帳或信用卡，資料都不用重填。"
                  : `金流回應：${order.pay_note}`}
              </p>
            )}
            <div style={{ marginTop: 24, display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
              <Link className="btn" href="/orders">查詢訂單</Link>
              <Link className="btn fill" href="/shop">繼續逛逛</Link>
            </div>
          </div>
          <div className="band" />
        </div>
      </div>
      <Footer hideBusinessModel={!navSupportShop()} />
    </>
  );
}
