import SupportForm from "@/components/SupportForm";
import StickySupport from "@/components/StickySupport";
import { getSetting, json } from "@/lib/db";
import { enabledPays, monthlyExternalUrl, supportHref, supportIsExternal } from "@/lib/shop";
import { ecpayEnabled } from "@/lib/ecpay";
import { linepayEnabled } from "@/lib/linepay";
import { portalyEnabled } from "@/lib/portaly";
import { t } from "@/lib/copy";

/*
 * 常駐支持貼條的伺服器端外殼：把要讀資料庫的設定都在這裡取好，
 * 再把組好的 SupportForm 交給客戶端的 StickySupport 去控制展開收合。
 *
 * 表單固定 initMode="once"：貼條的「單次支持」點下去就要直接看到金額，
 * 開在定額模式的話畫面上只會有一顆外連按鈕，等於白展開一次。
 * 「長期支持」不走表單，直接連去該去的地方。
 */
export default function ArticleStickySupport({ initAmount, tiers }: { initAmount?: number; tiers?: number[] }) {
  const ext = monthlyExternalUrl();
  /* 定額有指定外部頁就連過去；沒有的話回站內支持頁，
     再不然是整個贊助走外連模式（Portaly），也照那個網址走 */
  const monthlyHref = ext || (supportIsExternal() ? supportHref() : "/support");
  const isExternal = Boolean(ext) || supportIsExternal();

  return (
    <StickySupport text={t("sticky_text")} monthlyHref={monthlyHref} monthlyExternal={isExternal}>
      <SupportForm
        tiers={tiers || json<number[]>(getSetting("sponsor_tiers", "[888,5000,30000,80000]"), [888, 5000, 30000, 80000])}
        initAmount={initAmount ?? 888}
        initMode="once"
        bare
        pays={ecpayEnabled() ? enabledPays(["LINE Pay", "Apple Pay", "信用卡", "ATM 轉帳", "多元支付"]).filter((p) => p !== "LINE Pay" || linepayEnabled()) : enabledPays(["LINE Pay", "Apple Pay", "信用卡", "銀行轉帳"])}
        provider={ecpayEnabled() ? "ecpay" : portalyEnabled() ? "portaly" : "payuni"}
      />
    </StickySupport>
  );
}
