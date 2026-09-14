import type { Metadata } from "next";
import Link from "next/link";
import Nav from "@/components/Nav";
import Footer from "@/components/Footer";
import CheckoutForm from "@/components/CheckoutForm";
import { getSetting } from "@/lib/db";
import { addonEnabled, addonTiers, coldEnabled, enabledPays, freightMode, freightRates, publicFreightRates, navSupportShop, productOrigins, shopGateway, applePayOnsiteEnabled } from "@/lib/shop";
import { linepayEnabled } from "@/lib/linepay";
import { money } from "@/lib/format";
import { t } from "@/lib/copy";
import { buildMetadata } from "@/lib/seo";
import { json } from "@/lib/db";
import { payLinkByToken, payLinkItems, payLinkTotal } from "@/lib/pay-link";

/* 談好的專屬結帳頁，不進索引也不該被搜尋到 */
export const metadata: Metadata = buildMetadata({ title: "專屬結帳", path: "/pay", noindex: true });
export const dynamic = "force-dynamic";

function Frame({ title, body }: { title: string; body: React.ReactNode }) {
  return (
    <>
      <Nav hideSupport={!navSupportShop()} />
      <div className="frame" style={{ maxWidth: 620, padding: "80px 20px 120px" }}>
        <div className="box center">
          <div className="band" />
          <div className="inner" style={{ padding: "44px 22px" }}>
            <h2 style={{ fontSize: 21, fontWeight: 900, letterSpacing: ".12em" }}>{title}</h2>
            <div style={{ color: "var(--grey)", fontSize: 14.5, marginTop: 12, lineHeight: 2 }}>{body}</div>
          </div>
          <div className="band" />
        </div>
      </div>
      <Footer hideBusinessModel={!navSupportShop()} />
    </>
  );
}

export default async function PayLinkPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const link = payLinkByToken(token);

  if (!link)
    return <Frame title="找不到這個付款連結" body={<>連結可能打錯了，或已經被收回。請跟我們確認一條新的連結。</>} />;

  /* 一次性是以「訂單成立」為準：已經成立過訂單的連結不能再走一次，
     否則同一批貨會被鎖兩份庫存。要重試付款走的是訂單自己的免重填連結。 */
  if (link.status === "used")
    return (
      <Frame
        title="這條連結已經成立訂單了"
        body={
          <>
            訂單編號 <b className="sans" style={{ color: "var(--seal)" }}>{link.order_no}</b>。
            <br />
            還沒完成付款的話，請看訂單成立時寄給你的那封信，裡面有可以直接接續付款的連結，資料不用重填。
            <p style={{ marginTop: 18 }}>
              <Link className="btn" href="/orders">查詢訂單</Link>
            </p>
          </>
        }
      />
    );

  /* released＝已作廢或保留到期，庫存已經放回去了。原本這裡會直接落到下面渲染
     一個看起來能用的結帳表單，對方整張填完送出才被伺服器打回，體驗很糟。 */
  if (link.status !== "open")
    return <Frame title="這條連結已經失效" body={<>保留的名額已經釋出，或這條連結被收回了。需要的話請跟我們要一條新的。</>} />;

  const items = payLinkItems(link);
  const subtotal = payLinkTotal(items);
  /* 後台之後把某種付款方式停用時，這裡要跟著濾掉。
     先濾再判斷有沒有剩，順序反過來的話會把空清單交給表單，
     表單只好退回預設的「信用卡」，而那可能正是這條連結沒開放的方式，
     對方填完送出才被伺服器擋下。 */
  const needAddress = Boolean(link.need_address);
  const gateway = shopGateway();
  /* 藍新做信用卡、ATM、Apple Pay，連結原本開放的其他方式（LINE Pay／多元支付）在這個模式下不能出現 */
  const pays = enabledPays(
    json<string[]>(link.pays, [])
      .filter((p) => p !== "LINE Pay" || linepayEnabled())
      .filter((p) => gateway !== "newebpay" || p === "信用卡" || p === "ATM 轉帳" || p === "Apple Pay")
  );
  if (pays.length === 0)
    return <Frame title="這條連結目前無法結帳" body={<>連結開放的付款方式現在都不可用，請跟我們聯絡換一條新的。</>} />;

  return (
    <>
      <Nav hideSupport={!navSupportShop()} />
      <div className="frame" style={{ maxWidth: 760, padding: "48px 20px 100px" }}>
        <div className="page-head">
          <span className="tag">專 屬 結 帳</span>
          <h1>{link.title || "為你準備的結帳頁"}</h1>
        </div>

        {/* 品項與金額都是談好的，鎖死不能改，所以這裡只呈現不給操作 */}
        <div className="box" style={{ marginTop: 24 }}>
          <div className="inner" style={{ padding: "22px 24px" }}>
            <table width="100%" style={{ borderCollapse: "collapse" }}>
              <tbody>
                {items.map((i, n) => (
                  <tr key={n}>
                    <td style={{ padding: "7px 0", fontSize: 15 }}>
                      {i.name}
                      {i.choice ? <span style={{ color: "var(--grey)" }}>（{i.choice}）</span> : null}
                      <span style={{ color: "var(--grey)" }}> × {i.qty}</span>
                    </td>
                    <td align="right" className="sans" style={{ fontSize: 15 }}>{money(i.price * i.qty)}</td>
                  </tr>
                ))}
                <tr>
                  <td style={{ padding: "12px 0 0", borderTop: "2px dashed var(--line, #E3D3AC)", fontSize: 16 }}><b>小計</b></td>
                  <td align="right" className="sans" style={{ padding: "12px 0 0", borderTop: "2px dashed var(--line, #E3D3AC)", fontSize: 17 }}>
                    <b>{money(subtotal)}</b>
                  </td>
                </tr>
              </tbody>
            </table>
            <p className="fine" style={{ marginTop: 12, marginBottom: 0 }}>
              以上品項與金額是先前談定的內容，無法在這一頁修改。需要調整請跟我們說，我們會給你一條新的連結。
              {!needAddress && <> 這筆沒有需要寄送的商品，所以不用填收件地址，也不會收運費。</>}
            </p>
          </div>
        </div>

        <div id="checkout-form" style={{ marginTop: 36 }}>
          <CheckoutForm
            freeShip={Number(getSetting("free_ship_threshold", "1500"))}
            shipFee={Number(getSetting("ship_fee", "120"))}
            cvsFee={Number(getSetting("ship_fee_cvs", "65"))}
            rates={publicFreightRates()}
            coldOn={coldEnabled()}
            origins={productOrigins()}
            freightMode={freightMode()}
            addonTiers={addonTiers()}
            addonPitch={t("addon_pitch")}
            pays={pays}
            showAddon={addonEnabled()}
            presets={{ name: link.preset_name, phone: link.preset_phone, email: link.preset_email, address: "" }}
            gateway={gateway}
            tappay={null}
            applePayOnsite={applePayOnsiteEnabled()}
            payLink={{
              token: link.token,
              items,
              needAddress,
              invTaxId: link.inv_tax_id,
              invCompany: link.inv_company,
            }}
          />
        </div>

        <p className="cart-trust center" style={{ marginTop: 26 }}>
          付款由金流公司加密處理，本站不儲存卡號・<a href="/returns">退換貨規則</a>
        </p>
      </div>
      <Footer hideBusinessModel={!navSupportShop()} />
    </>
  );
}
