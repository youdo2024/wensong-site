import type { Metadata } from "next";
import { partnerOk, partnerPinOk, viewerScope, allPartners } from "@/lib/partner";
import { partnerData } from "@/lib/partner-data";
import PartnerShip from "@/components/PartnerShip";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "出貨工作台｜問爽的",
  robots: { index: false, follow: false },
};

/*
 * 出貨夥伴工作台。不掛站上的 Nav 與 Footer：這是給夥伴的工具頁，
 * 不需要贊助按鈕與行銷動線，越像一張乾淨的工作單越好。
 * 資料每次載入都是現況（force-dynamic），重新整理＝最新清單。
 */
export default async function PartnerPage({
  searchParams,
}: {
  searchParams: Promise<{ pin?: string; p?: string }>;
}) {
  const { pin, p: pickRaw } = await searchParams;
  /* 連結（金鑰 cookie）驗過、還沒輸入密碼：出密碼畫面。
     多這一道是站長要求：連結被轉傳或信箱被翻，光有連結還進不來。 */
  if ((await partnerOk()) && !(await partnerPinOk())) {
    return (
      <div className="frame" style={{ maxWidth: 420, padding: "96px 20px" }}>
        <div className="box center">
          <div className="band" />
          <div className="inner" style={{ padding: "40px 22px" }}>
            <h2 style={{ fontSize: 19, fontWeight: 900, letterSpacing: ".16em" }}>出 貨 工 作 台</h2>
            <p style={{ color: "var(--grey)", fontSize: 13.5, marginTop: 8 }}>請輸入密碼</p>
            {pin === "err" && <p className="msg-err" style={{ marginTop: 10 }}>密碼不對，再試一次</p>}
            <form method="post" action="/api/partner/pin" style={{ marginTop: 16, display: "flex", gap: 8, justifyContent: "center" }}>
              <input
                className="sans"
                type="password"
                name="pin"
                inputMode="numeric"
                autoComplete="off"
                maxLength={12}
                style={{ width: 140, textAlign: "center", fontSize: 20, letterSpacing: ".3em", border: "2px solid var(--ink)", padding: "10px 12px", background: "#FFFDF6" }}
              />
              <button className="btn fill" type="submit" style={{ padding: "10px 22px" }}>進入</button>
            </form>
          </div>
          <div className="band" />
        </div>
      </div>
    );
  }
  const scope = await viewerScope();
  if (!scope) {
    return (
      <div className="frame" style={{ maxWidth: 560, padding: "96px 20px" }}>
        <div className="box center">
          <div className="band" />
          <div className="inner" style={{ padding: "44px 22px" }}>
            <h2 style={{ fontSize: 20, fontWeight: 900, letterSpacing: ".14em" }}>這個頁面目前沒有開放</h2>
            <p style={{ color: "var(--grey)", fontSize: 14, marginTop: 10, lineHeight: 2 }}>
              請用站長提供的專屬連結開啟。連結失效的話，請跟站長要一條新的。
            </p>
          </div>
          <div className="band" />
        </div>
      </div>
    );
  }

  /*
   * 夥伴只拿自己的商品。站長預設看全部，但可用上方的分頁挑一位——
   * 夥伴一多，總覽會長到要捲很久才找得到某一家的清單。
   */
  const partnerList = scope === "admin" ? allPartners().filter((x) => x.active) : [];
  /*
   * pick：undefined＝全部、0＝本店（partner_id 為 NULL 的自有商品）、正整數＝某位夥伴。
   * 不能用 0 當「全部」的哨兵——0 已經是本店的代號了。
   */
  const pick: number | undefined =
    scope !== "admin" ? undefined
    : pickRaw === "0" ? 0
    : pickRaw && partnerList.some((x) => String(x.id) === pickRaw) ? Number(pickRaw)
    : undefined;
  const products = scope === "admin" ? partnerData(pick) : partnerData(scope.id);
  const partnerNames = scope === "admin" ? new Map(allPartners().map((p) => [p.id, p.name])) : null;
  const now = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 16).replace("T", " ");

  return (
    <div className="frame ptn" style={{ maxWidth: 880, padding: "40px 20px 100px" }}>
      <header className="ptn-hd">
        <b>問 爽 的 ｜ 出 貨 工 作 台{scope !== "admin" && `｜${scope.name}`}</b>
        <span className="sans">{now}（台北時間）・重新整理就是最新現況</span>
      </header>
      {/* 站長視角的明示：站長登入後開這頁看到的是全部夥伴的總覽，
          跟夥伴本人看到的不一樣。不標清楚的話，站長會以為隔離壞了（實際發生過）。 */}
      {scope === "admin" && partnerList.length > 0 && (
        <nav className="adm-tabs sans" style={{ marginBottom: 14 }}>
          <a className={`t${pick === undefined ? " on" : ""}`} href="/partner">全部</a>
          <a className={`t${pick === 0 ? " on" : ""}`} href="/partner?p=0">問爽的本店</a>
          {partnerList.map((x) => (
            <a key={x.id} className={`t${pick === x.id ? " on" : ""}`} href={`/partner?p=${x.id}`}>{x.name}</a>
          ))}
        </nav>
      )}
      {scope === "admin" && (
        <p style={{ border: "2px solid var(--indigo)", color: "var(--indigo)", background: "var(--rice-lt)", padding: "10px 14px", fontSize: 13.5, lineHeight: 1.9, marginBottom: 18 }}>
          你正以<b>站長身分</b>檢視——這是全部夥伴的總覽（商品旁的灰字是所屬夥伴）。
          夥伴本人用自己的連結開，只看得到自己的商品與訂單。想看夥伴眼中的畫面，用無痕視窗開他的連結。
          「問爽的本店」是你自己出貨的商品，只列出目前有未出貨訂單的品項。
        </p>
      )}

      {products.length === 0 && (
        <p className="empty">目前沒有要經手的商品（站長在後台商品把「出貨夥伴」設成這一位，商品才會出現在這裡）。</p>
      )}

      {products.map((p) => (
        <section className="ptn-prod" key={p.id}>
          <div className="ptn-prodhd">
            <h2>{p.name}{partnerNames && <span className="sans" style={{ fontSize: 13, color: "var(--grey)", marginLeft: 10 }}>（{p.partnerId === 0 ? "本店自出" : partnerNames.get(p.partnerId) || "?"}）</span>}</h2>
            <a className="ptn-csv sans" href={`/api/partner/csv?id=${p.id}`}>下載 Excel（CSV）</a>
          </div>

          {/* 上半部：產能總表。要做的量＝待出貨＋已出貨（付款成功才算數） */}
          <div className="ptn-tbwrap">
            <table className="ptn-tb sans">
              <thead>
                <tr>
                  <th style={{ textAlign: "left" }}>{p.optionName || "分組"}</th>
                  <th>待出貨</th>
                  <th>已出貨</th>
                  <th>要做的量</th>
                  <th>待付款(參考)</th>
                  <th>已保留(參考)</th>
                  <th>剩餘可賣</th>
                </tr>
              </thead>
              <tbody>
                {p.weeks.map((w) => (
                  <tr key={w.choice || "＿"}>
                    <td style={{ textAlign: "left" }}>{w.choice || "（無規格）"}</td>
                    <td className={w.paidQty > 0 ? "hot" : undefined}>{w.paidQty}</td>
                    <td>{w.shippedQty}</td>
                    <td><b>{w.paidQty + w.shippedQty}</b></td>
                    <td className="dim">{w.pendingQty}</td>
                    <td className="dim">{w.reservedQty || "—"}</td>
                    <td className="dim">{w.remain === null ? "不限" : w.remain}</td>
                  </tr>
                ))}
                <tr className="sum">
                  <td style={{ textAlign: "left" }}>合計</td>
                  <td>{p.totalPaid}</td>
                  <td>{p.totalShipped}</td>
                  <td><b>{p.totalPaid + p.totalShipped}</b></td>
                  <td className="dim">{p.totalPending}</td>
                  <td className="dim">{p.totalReserved || "—"}</td>
                  <td />
                </tr>
              </tbody>
            </table>
          </div>
          <p className="fine" style={{ margin: "8px 0 0", lineHeight: 1.9 }}>
            「待付款」是還沒完成付款的單（多半是 ATM 還沒轉帳），<b>不用備貨也不用出</b>，付款成功會自動移進待出貨。
            「已保留」是站長談好、名額先留起來但對方還沒下單的量（多半是企業訂購），<b>也先不用做</b>，對方付款後會自己移進待出貨。
          </p>

          {/* 下半部：各出貨週的寄件清單 */}
          {p.weeks.map((w) => (
            <div className="ptn-week" key={`wk-${w.choice || "＿"}`}>
              <div className="ptn-weekhd">
                <b>{w.choice || "（無規格）"}</b>
                <span className="sans">待出貨 {w.toShip.length} 筆・已出貨 {w.shipped.length} 筆</span>
              </div>

              {w.toShip.length === 0 && w.shipped.length === 0 && (
                <p className="fine" style={{ padding: "10px 14px" }}>這一週還沒有訂單。</p>
              )}

              {w.toShip.map((r) => (
                <div className="ptn-row" key={`${r.orderNo}-${r.itemIdx}-${r.recipIdx ?? "x"}`}>
                  <div className="l">
                    <b>{r.name}</b>
                    <div className="sans meta">
                      {r.phone}　{r.shipMethod}
                      <br />
                      {r.address}
                      {/* 郵遞區號推不出來（或客人寫的跟系統對不上）才會有字。
                          夥伴照樣能出貨，只是那一單的郵遞區號要自己查一下寫上託運單 */}
                      {r.zipNote && <span style={{ color: "#B8402C" }}>　{r.zipNote}</span>}
                      {r.note && (<><br /><b style={{ color: "#B8402C" }}>備註：{r.note}</b></>)}
                      {r.buyerName && (
                        <>
                          <br />
                          <span style={{ color: "var(--gold)" }}>多地址配送・訂購人 {r.buyerName}</span>
                        </>
                      )}
                    </div>
                    <div className="sans no">{r.orderNo}・{r.createdAt.slice(5, 16).replace("T", " ")} 下單</div>
                  </div>
                  <div className="r">
                    {/* 數量是備貨時最常看的數字，放右側大徽章，跟出貨按鈕同一視線 */}
                    <span className="ptn-qty sans">{r.qty}<small>盒</small></span>
                    <PartnerShip orderNo={r.orderNo} itemIdx={r.itemIdx} recipIdx={r.recipIdx ?? null} />
                  </div>
                </div>
              ))}

              {w.shipped.length > 0 && (
                <details className="ptn-done">
                  <summary className="sans">已出貨 {w.shipped.length} 筆（點開核對）</summary>
                  {w.shipped.map((r) => (
                    <div className="ptn-row done" key={`${r.orderNo}-${r.itemIdx}-${r.recipIdx ?? "x"}`}>
                      <div className="l">
                        <b>{r.name}</b>
                        <span className="sans qty">× {r.qty} 盒</span>
                        <div className="sans meta">{r.phone}　{r.shipMethod}　{r.address}{r.zipNote && <span style={{ color: "#B8402C" }}>　{r.zipNote}</span>}</div>
                        <div className="sans no">{r.orderNo}</div>
                      </div>
                    </div>
                  ))}
                </details>
              )}
            </div>
          ))}
        </section>
      ))}

      <p className="fine" style={{ marginTop: 30, lineHeight: 2 }}>
        按「出貨」只會標記那一列的品項（同一筆訂單買多週的，各週分開出、分開按），
        顧客每批都會自動收到出貨通知信。
        按錯了跟站長說一聲，後台可以改回來。這個頁面請不要轉傳連結給其他人。
      </p>
    </div>
  );
}
