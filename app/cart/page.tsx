import { lineNotifyOn } from "@/lib/line";
import type { Metadata } from "next";
import { buildMetadata } from "@/lib/seo";
import Nav from "@/components/Nav";
import Footer from "@/components/Footer";
import CartView from "@/components/CartView";
import CheckoutForm from "@/components/CheckoutForm";
import TapPayBadge from "@/components/TapPayBadge";
import db, { getSetting } from "@/lib/db";
import { getMember } from "@/lib/member";
import { addonEnabled, addonTiers, coldEnabled, enabledPays, freightMode, freightRates, publicFreightRates, navSupportShop, productOrigins, shopGateway } from "@/lib/shop";
import { linepayEnabled } from "@/lib/linepay";
import { t } from "@/lib/copy";
import { shopViewable } from "@/lib/shop-preview";
import ShopClosed from "@/components/ShopClosed";
import { tappayConfig, tappayEnabled } from "@/lib/tappay";
import { isCvsMethod } from "@/lib/cvs";

export const metadata: Metadata = buildMetadata({ title: "購物車", path: "/cart", noindex: true });
export const dynamic = "force-dynamic";

/* 購物車＝結帳：清單、免運進度、收件資料、付款，同一頁一次完成（不再跳轉 /checkout） */
export default async function CartPage() {
  if (!(await shopViewable())) return <ShopClosed />;
  const freeShip = Number(getSetting("free_ship_threshold", "1500"));
  const shipFee = Number(getSetting("ship_fee", "120"));
  /* 湊單推薦：精選優先、有庫存、上架中（前端會再濾掉已在購物車裡的） */
  const recs = db
    .prepare("SELECT id,name,price,image,category FROM products WHERE published=1 AND stock>0 ORDER BY featured DESC, sort, id LIMIT 6")
    .all() as { id: number; name: string; price: number; image: string; category: string }[];

  /* 會員登入時自動帶入上次的收件資料 */
  const member = await getMember();
  const presets = { name: member?.name || "", phone: "", email: member?.email || "", address: "" };
  if (member?.email) {
    const last = db.prepare("SELECT name,phone,address,ship_method FROM orders WHERE email=? ORDER BY id DESC LIMIT 1")
      .get(member.email) as { name: string; phone: string; address: string; ship_method: string } | undefined;
    if (last) {
      presets.name = last.name;
      presets.phone = last.phone;
      if (!isCvsMethod(last.ship_method)) presets.address = last.address;
    }
  }

  /* 金流：文案跟著後台設定走；TapPay 金鑰未設時欄位隱藏、送出鎖住（不會默默變回 PayUni） */
  const gateway = shopGateway();
  const tp = tappayConfig();
  const tpReady = gateway === "tappay" && tappayEnabled();

  return (
    <>
      <Nav showCart hideSupport={!navSupportShop()} />
      <div className="frame" style={{ padding: "48px 20px 100px" }}>
        <div className="page-head">
          <span className="tag">購 物 車</span>
          <h1>確認選物，直接結帳</h1>
        </div>
        <CartView freeShip={freeShip} shipFee={shipFee} recs={recs} origins={productOrigins()} freightMode={freightMode()} rates={publicFreightRates()} />

        {/* 同頁結帳表單（含金額明細、折扣碼、加購）；sticky 列的「往下結帳」捲到這裡 */}
        <div id="checkout-form" style={{ marginTop: 44 }}>
          <CheckoutForm
            lineNotify={lineNotifyOn()}
            freeShip={freeShip}
            shipFee={shipFee}
            cvsFee={Number(getSetting("ship_fee_cvs", "65"))}
            rates={publicFreightRates()}
            coldOn={coldEnabled()}
            origins={productOrigins()}
            freightMode={freightMode()}
            addonTiers={addonTiers()}
            addonPitch={t("addon_pitch")}
            /*
             * 付款方式的順序＝畫面順序，也是預設選中的那一個（CheckoutForm 取 pays[0]）。
             * 站長指定的常規順序：LINE Pay → ATM → 信用卡 → Apple Pay。
             * 多元支付（綠界 TWQR）沒有指定，維持在最後。
             * 停用的方式由 enabledPays 濾掉，濾完的第一個就成為預設。
             */
            pays={
              gateway === "tappay"
                ? enabledPays(["信用卡"])
                : gateway === "ecpay"
                  ? enabledPays(["LINE Pay", "ATM 轉帳", "信用卡", "Apple Pay", "多元支付"]).filter((p) => p !== "LINE Pay" || linepayEnabled())
                  : enabledPays(["LINE Pay", "ATM 轉帳", "信用卡", "Apple Pay"])
            }
            showAddon={addonEnabled()}
            presets={presets}
            gateway={gateway}
            tappay={tpReady ? { appId: Number(tp.appId), appKey: tp.appKey, sandbox: tp.sandbox } : null}
          />
        </div>
        {/* 金流說明區：信任小字＋（TapPay 模式）官方 logo 與安全性文字（審核要求） */}
        <p className="cart-trust center" style={{ marginTop: 26 }}>
          付款由金流公司加密處理，本站不儲存卡號・易碎品加強包材，破損直接補寄・
          <a href="/returns">退換貨規則</a>
        </p>
        {gateway === "tappay" && (
          <p className="center" style={{ marginTop: 14 }}>
            <TapPayBadge full />
          </p>
        )}
      </div>
      <Footer hideBusinessModel={!navSupportShop()} />
    </>
  );
}
