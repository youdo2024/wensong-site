import type { Metadata } from "next";
import { buildMetadata } from "@/lib/seo";
import Nav from "@/components/Nav";
import Footer from "@/components/Footer";
import SupportForm from "@/components/SupportForm";
import LeadLetter from "@/components/LeadLetter";
import SupportPillars from "@/components/SupportPillars";
import { getSetting, json } from "@/lib/db";
import { redirect } from "next/navigation";
import { enabledPays, monthlyExternalUrl, supportEnabled, supportMode, supportUrl } from "@/lib/shop";
import { portalyEnabled } from "@/lib/portaly";
import { ecpayEnabled } from "@/lib/ecpay";
import { newebpayEnabled } from "@/lib/newebpay";
import { linepayEnabled } from "@/lib/linepay";
import { isAdmin } from "@/lib/auth";
import PageViewPing from "@/components/PageViewPing";

export const metadata: Metadata = buildMetadata({ title: "支持方案｜數位內容服務", path: "/support", description: "問爽的 WenSong的內容支持方案：單次支持與長期支持，均為數位內容服務，依法開立統一發票。" });
export const dynamic = "force-dynamic";

export default async function SupportPage({
  searchParams,
}: {
  searchParams: Promise<{ amount?: string; mode?: string; error?: string; custom?: string; preview?: string }>;
}) {
  const sp = await searchParams;
  /* 站長預覽模式：登入後台後開 /support?preview=1，可在訪客仍導去外部頁時實測站內表單 */
  const preview = sp.preview === "1" && (await isAdmin());
  /* 外部連結模式：有人直接開 /support 就導去指定的外部贊助頁 */
  if (!preview && supportMode() === "link" && supportUrl()) redirect(supportUrl());
  /* 贊助暫停顯示時給友善說明頁；既有訂閱的取消連結（/support/cancel）不受影響 */
  if (!preview && !supportEnabled()) {
    return (
      <>
        <PageViewPing page="support" />
        <Nav />
        <div className="frame" style={{ maxWidth: 560, padding: "72px 20px 120px" }}>
          <div className="box center">
            <div className="band" />
            <div className="inner" style={{ paddingTop: 44, paddingBottom: 44 }}>
              <h2 style={{ fontSize: 24, fontWeight: 900, letterSpacing: ".14em" }}>支持功能整理中</h2>
              <p style={{ color: "var(--grey)", fontSize: 14.5, marginTop: 12, lineHeight: 2 }}>
                目前暫停接受新的支持，既有的長期支持不受影響。想支持我們，先看看文章、訂閱頻道，或到商店逛逛。
              </p>
            </div>
            <div className="band" />
          </div>
        </div>
        <Footer />
      </>
    );
  }
  const tiers = json<number[]>(getSetting("sponsor_tiers", "[888,5000,30000,80000]"), [888, 5000, 30000, 80000]);
  const lead = getSetting("sponsor_lead", "沒有回饋品，只有一直拍下去的台灣現場");
  const initAmount = Number(sp.amount) || tiers[0] || 888;
  const initMode = sp.mode === "once" ? "once" : "monthly";

  return (
    <>
      {/* 瀏覽計數：先前只埋在「支持整理中」分支，正常贊助頁漏了 → 後台永遠顯示 0 */}
      <PageViewPing page="support" />
      <Nav />
      <div className="frame" style={{ maxWidth: 680, padding: "56px 20px 100px" }}>
        <div className="page-head">
          <span className="tag">支 持 方 案</span>
          <h1>小額支持創作者</h1>
        </div>
        {/* 跑馬燈信封（與首頁支持區同構）：線條包住信文、圖示卡與表單 */}
        <div className="box support-box">
          <div className="band" />
          <div className="inner">
            <LeadLetter text={lead} closing="每一次支持，都讓故事被更多人看見。" variant={2} />
            {/* 四格圖示卡：取代信件裡整段「收入流向」文字敘述（sponsor_lead_v2 遷移移除） */}
            <SupportPillars caption="這些是頻道收入真正流向的地方，我想把它做成一件可以長久的事。" />
        {preview && (
          <p className="msg-ok" style={{ borderColor: "var(--indigo)", color: "var(--indigo)" }}>
            站長預覽模式：這頁只有登入後台的你看得到，訪客目前仍導向外部支持頁。實測付款會真的扣款，測完可在綠界後台退刷。
          </p>
        )}
        {sp.error === "phone" ? (
          <p className="msg-err">請留一支手機，09 開頭的 10 碼號碼。萬一 Email 寄不到，這是我們唯一找得到你的方式，不會用來推銷。</p>
        ) : sp.error === "npoban" ? (
          <p className="msg-err">查不到這個捐贈碼，請確認後再送出（捐贈碼是 3 到 7 位數字，可到財政部電子發票平台查詢）。</p>
        ) : sp.error === "taxid" ? (
          <p className="msg-err">統一編號不正確，請再確認一次（8 位數字，含檢查碼）。</p>
        ) : sp.error === "carrier" ? (
          <p className="msg-err">手機條碼載具格式不對，斜線開頭共 8 碼（例如 /AB12CD3）。</p>
        ) : sp.error === "email" ? (
          <p className="msg-err">Email 看起來不對，請確認網域選對了再送出（收據與電子發票會寄到這個信箱）。</p>
        ) : sp.error ? (
          <p className="msg-err">資料不完整，請確認金額與 Email 後再送出。</p>
        ) : null}
        <SupportForm tiers={tiers} initAmount={initAmount} initMode={initMode} initShowCustom={sp.custom === "1"} pays={ecpayEnabled() ? enabledPays(["LINE Pay", "Apple Pay", "信用卡", "ATM 轉帳", "多元支付"], "support").filter((p) => p !== "LINE Pay" || linepayEnabled()) : newebpayEnabled() ? enabledPays(["信用卡", "ATM 轉帳"], "support") : enabledPays(["LINE Pay", "Apple Pay", "信用卡", "銀行轉帳"], "support")} provider={ecpayEnabled() ? "ecpay" : newebpayEnabled() ? "newebpay" : portalyEnabled() ? "portaly" : "payuni"} monthlyExternal={monthlyExternalUrl()} modeTabs bare />
          </div>
          <div className="band" />
        </div>
        {/* 大額支持／企業合作：從信件內移到 CTA 下方（sponsor_lead_v2 遷移已移除信內字句） */}
        <p className="center" style={{ marginTop: 22 }}>
          <a
            className="btn"
            href={`mailto:hi@wensong.tw?subject=${encodeURIComponent("大額支持／企業合作")}`}
            style={{ fontSize: 13.5, padding: "9px 20px", letterSpacing: ".12em" }}
          >
            大額支持或企業合作，歡迎點此來信
          </a>
        </p>
      </div>
      <Footer />
    </>
  );
}
