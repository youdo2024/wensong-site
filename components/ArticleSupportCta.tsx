import LeadLetter from "@/components/LeadLetter";
import SupportForm from "@/components/SupportForm";
import SupportPillars from "@/components/SupportPillars";
import { getSetting, json } from "@/lib/db";
import { enabledPays, monthlyExternalUrl } from "@/lib/shop";
import { ecpayEnabled } from "@/lib/ecpay";
import { linepayEnabled } from "@/lib/linepay";
import { portalyEnabled } from "@/lib/portaly";

/* 兩邊共用同一句；首頁那組也改用這個常數，破折號一起拿掉（站規） */
export const PILLARS_CAPTION = "這些是節目收入真正流向的地方，我們想把它做成一件可以長久的事。";

/*
 * 文章文末支持模組（2026-09-13 改版）：跟首頁底下那組同一套。
 *
 * 站長：「文章底下的贊助模組，可不可以跟首頁底下那組一樣？」
 * 首頁那組是信封框、一封長信（主持人敬上）、四格「你的支持會變成」、長期／單次表單。
 * 原本文末只有一個標題加一兩句話就接表單，讀者不知道錢會變成什麼。
 *
 * 三個跟首頁不一樣的地方，都是站長決定的：
 *   一、長信預設收合。文末的人剛讀完一篇長文，再攤一封三段的信太長；
 *       想讀的人點一下，不想讀的直接看四格卡、按支持。
 *   二、紅色那句用「這一篇」的話（後台每篇可設的 cta_text），不是全站通用句。
 *       它是整個模組視覺最重的一句，本來就該講這篇文章的事。
 *   三、首頁信封外那顆「大額支持或企業合作」不搬，文末夠長了。
 *
 * 伺服器元件：自行讀設定，一般文章模板與所有一頁式共用，改一次全站生效。
 * 外層沿用 .article-cta 這個 class：幾篇舊一頁式（樹、黑熊、水獺）用它掛了自己的
 * 底色與外框覆寫，換掉 class 那些覆寫會失效，所以加一個 .support-letter 疊在後面。
 */
export default function ArticleSupportCta({ ctaText, initAmount, tiers, note }: { ctaText: string; initAmount?: number; tiers?: number[]; note?: string }) {
  const lead = getSetting("sponsor_lead", "沒有回饋品，只有一直錄下去的問爽的");
  return (
    <div className="article-cta support-letter">
      <div className="band" />
      <div className="inner">
        <h2>小額支持創作者</h2>
        {/* 這一篇自己的那句話：紅色、粗體，站在信的位置上 */}
        <p className="cta-line">{ctaText}</p>
        {/* 單篇專屬金額註記（例如黑熊篇的 568 元） */}
        {note && <p className="cta-note">{note}</p>}
        {/* 長信收合。原生 details：內容在 DOM 裡，沒有 JS 也點得開 */}
        <details className="letter-fold">
          <summary>主持人寫給你的一封信<i>▸</i></summary>
          <LeadLetter text={lead} variant={2} />
        </details>
        <SupportPillars caption={PILLARS_CAPTION} />
        <div className="formwrap">
          <SupportForm
            tiers={tiers || json<number[]>(getSetting("sponsor_tiers", "[888,5000,30000,80000]"), [888, 5000, 30000, 80000])}
            initAmount={initAmount ?? 888}
            initMode="monthly"
            modeTabs
            bare
            monthlyExternal={monthlyExternalUrl()}
            /* 付款方式看「贊助」那份開關，跟贊助頁一致（原本看的是商店那份） */
            pays={ecpayEnabled() ? enabledPays(["LINE Pay", "Apple Pay", "信用卡", "ATM 轉帳", "多元支付"], "support").filter((p) => p !== "LINE Pay" || linepayEnabled()) : enabledPays(["LINE Pay", "Apple Pay", "信用卡", "銀行轉帳"], "support")}
            provider={ecpayEnabled() ? "ecpay" : portalyEnabled() ? "portaly" : "payuni"}
          />
        </div>
      </div>
      <div className="band" />
    </div>
  );
}
