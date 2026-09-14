import type { Metadata } from "next";
import Link from "next/link";
import { getSetting } from "@/lib/db";
import { saveSettings } from "@/app/admin/actions";
import { shopGateway } from "@/lib/shop";
import { tappayConfig, tappayEnabled } from "@/lib/tappay";
import { ecpayConfig, ecpayEnabled } from "@/lib/ecpay";
import { amegoConfig } from "@/lib/amego";
import { linepayEnabled } from "@/lib/linepay";
import { payuniEnabled } from "@/lib/payuni";
import { mailEnabled, mailTransportLabel } from "@/lib/mail";
import { newsleopardEnabled } from "@/lib/newsleopard";
import Check from "@/components/admin/Check";
import StickySave from "@/components/admin/StickySave";
import SettingsHead from "@/components/admin/SettingsHead";
import { requireAdmin } from "@/lib/admin-guard";

export const metadata: Metadata = { title: "設定・金流" };

/*
 * 設定・金流（ia.md §2）：舊頁的「金流與發票環境」「商店金流」「金流與信件」三段。
 * 兩段「金流與…」的說明合併成一段（原本一段在最上面、一段在整頁最下面，
 * 講的其實是同一件事：錢從哪一條路進來、信從哪一條路出去）。
 * 三段所以單欄。
 */
export default async function SettingsPay({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string }>;
}) {
  await requireAdmin();
  const { saved } = await searchParams;

  /* 各金流與發票的實際環境。判斷邏輯集中在這裡，不散在各處 */
  const tp = tappayConfig();
  const ec = ecpayConfig();
  const am = amegoConfig();
  const ENV_ROWS: { name: string; state: string; ok: boolean; hint: string }[] = [
    {
      name: "商店金流",
      state:
        shopGateway() === "ecpay"
          ? ec.live ? "綠界＋LINE Pay・正式" : ecpayEnabled() ? "綠界・測試特店" : "綠界・未設定"
          : shopGateway() === "tappay"
            ? (tappayEnabled() ? (tp.sandbox ? "TapPay・沙箱" : "TapPay・正式") : "TapPay・未設定")
            : payuniEnabled() ? "PayUni・啟用" : "未設定",
      ok: shopGateway() === "ecpay" ? ec.live : shopGateway() === "tappay" ? tappayEnabled() && !tp.sandbox : payuniEnabled(),
      hint:
        shopGateway() === "ecpay"
          ? "商店結帳與贊助共用綠界金鑰，發票由光貿開立"
          : shopGateway() === "tappay" && tp.sandbox
            ? "顧客刷卡不會真的扣款。開賣前在 Zeabur 設 TAPPAY_SANDBOX=0"
            : "商店結帳走的金流",
    },
    {
      name: "贊助金流",
      state: ec.live ? "綠界・正式" : ecpayEnabled() ? "綠界・測試特店" : "綠界・未設定",
      ok: ec.live,
      hint: ec.live ? "站內贊助收款" : "沒讀到 ECPAY_MERCHANT_ID／HASH_KEY／HASH_IV，收不到真正的款項",
    },
    {
      name: "LINE Pay",
      state: linepayEnabled() ? (process.env.LINEPAY_SANDBOX === "1" ? "沙箱" : "正式") : "未啟用",
      ok: !linepayEnabled() || (process.env.LINEPAY_SANDBOX !== "1" && !getSetting("linepay_last_error", "")),
      hint: getSetting("linepay_last_error", "")
        ? `最近一次失敗：${getSetting("linepay_last_error", "")}。1101／1102／1104／1106 是金鑰或環境對不上，系統會自動暫停 LINE Pay，修好後到設定・商店的付款方式重新勾選`
        : linepayEnabled() ? "贊助頁與商店的 LINE Pay 按鈕" : "沒設金鑰時前台不會出現此付款方式",
    },
    {
      name: "電子發票",
      state: am.live ? `光貿・正式（統編 ${am.taxId}）` : "光貿・測試環境",
      ok: am.live,
      hint: am.live ? "付款成功自動開立" : "沒讀到 AMEGO_TAX_ID／AMEGO_APP_KEY，開出的發票不是真的也不會寄信",
    },
    {
      name: "交易信件",
      state: mailTransportLabel(),
      ok: mailEnabled(),
      hint: newsleopardEnabled()
        ? "感謝信、發票通知走電子豹；每日備份因為帶附件，一律走 SMTP"
        : "感謝信、發票通知、每日備份都靠這個。設了 NEWSLEOPARD_API_KEY 與 NEWSLEOPARD_FROM 就會改走電子豹",
    },
  ];
  const gw = getSetting("shop_gateway", "payuni");

  return (
    <>
      <SettingsHead name="金 流" title="設 定 ・ 金 流" sub="錢走哪一條路進來、現在跑在正式還是測試環境" />
      {saved && <p className="msg-ok">已儲存。</p>}

      {/*
        金流與發票的環境總覽。
        五支服務「沒設環境變數時」的預設方向各不相同（TapPay 預設沙箱、
        PayUni 預設正式、LINE Pay 預設正式、綠界與光貿沒金鑰就退回測試），
        光看程式碼很難判斷現在到底跑在哪裡，而跑錯的後果是「畫面顯示成功但收不到錢」。
        把實際狀態集中列出來，漏設就一眼看得到。這一段沒有可以改的欄位，所以放在表單外面。
      */}
      <div className="ad-set">
        <div className="ad-part">
          <div className="ad-sect"><h2>金 流 與 發 票 環 境</h2><div className="rule" /></div>
          <div className="adm-table-wrap">
            <table className="adm-table sans kv ad-envtable">
              <tbody>
                {ENV_ROWS.map((r) => (
                  <tr key={r.name}>
                    <td>{r.name}</td>
                    <td className={`st ${r.ok ? "tone-ok" : "tone-fail"}`}>{r.state}</td>
                    <td className="tone-muted">{r.hint}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="fine">
            紅字代表「目前收不到真正的錢」或「開出的發票不是真的」。要正式收款前，這一欄必須全部是綠色。
            金鑰本身在 Zeabur 的環境變數，後台不經手。
          </p>
        </div>
      </div>

      <form className="adm-form ad-set" action={saveSettings}>
        <input type="hidden" name="_back" value="/admin/settings/pay" />

        <div className="ad-part">
          <div className="ad-sect"><h2>商 店 金 流</h2><div className="rule" /></div>
          <p className="fine">
            商店結帳走哪一家金流。TapPay 需先在 Zeabur 設好四個環境變數
            （TAPPAY_PARTNER_KEY／TAPPAY_MERCHANT_ID／TAPPAY_APP_ID／TAPPAY_APP_KEY，
            測試環境另設 TAPPAY_SANDBOX=1）；金鑰沒設好時就算選了 TapPay，結帳也會自動退回 PayUni，不會壞。
            發票：PayUni 模式由 PayUni 開立；TapPay 模式由光貿開立（多品項＋運費，號碼記在訂單上）。
          </p>
          <div className="chk-list">
            <Check
              type="radio" name="shop_gateway" value="ecpay" defaultChecked={gw === "ecpay"}
              label={<b>綠界 ＋ LINE Pay ＋ 光貿發票</b>}
              hint="（與贊助同一套金鑰；信用卡／Apple Pay／ATM／多元支付走綠界，LINE Pay 走官方金流，發票由本站光貿開立）"
            />
            <Check
              type="radio" name="shop_gateway" value="payuni" defaultChecked={gw !== "tappay" && gw !== "ecpay"}
              label={<b>統一金流 PayUni</b>}
              hint="（跳轉付款頁；信用卡／ATM／多元支付；發票由 PayUni 開）"
            />
            <Check
              type="radio" name="shop_gateway" value="tappay" defaultChecked={gw === "tappay"}
              label={<b>TapPay ＋ 光貿發票</b>}
              hint="（站內刷卡不跳轉、3D 驗證；目前僅信用卡，商店頁會出現 TapPay 標示）"
            />
          </div>
          <p className="fine">
            客人看得到哪些付款方式，是另一件事，在<Link href="/admin/settings/shop">設定・商店</Link>的「付款方式」那一段。
          </p>
        </div>

        <div className="ad-part">
          <div className="ad-sect"><h2>金 流 與 信 件</h2><div className="rule" /></div>
          {/* 原本這段說明拆成兩塊、分別在整頁的最上面與最下面，講的是同一件事，合成一段 */}
          <p className="fine">
            【商店】走 PayUni（環境變數 PAYUNI_MERID／PAYUNI_HASH_KEY／PAYUNI_HASH_IV），結帳跳轉 PayUni 支付頁，
            付款結果由 /api/payuni/notify 自動回寫；電子發票開通後把 PAYUNI_INVOICE 設為 1，由消費者在付款頁確認發票資訊。
            【贊助】走 Portaly Payment（環境變數 PORTALY_API_KEY／PORTALY_CALLBACK_SECRET，pcs_test_ 開頭為測試模式）：
            跳轉 Portaly 代管結帳，單筆與每月定額都由 Portaly 處理續扣與發票，結果由 /api/portaly/callback 簽名回呼回寫，
            贊助者可透過信中連結隨時取消。沒設 Portaly 金鑰時贊助表單會退回 PayUni 流程。
            【信件】交易信與通知信走上面那張表的「交易信件」那一列；每日備份因為帶附件一律走 SMTP。
            後台登入密碼由環境變數 ADMIN_PASSWORD 控制。
          </p>
        </div>

        <StickySave />
      </form>
    </>
  );
}
