import { getSetting } from "@/lib/db";
import { t } from "@/lib/copy";
import { footerBusinessModel, supportEnabled } from "@/lib/shop";
import { BRAND } from "@/lib/brand";
import { platformLinks } from "@/lib/site-config";
import PlatformLinks from "@/components/PlatformLinks";

/* hideBusinessModel 給商店動線用：商店的贊助入口關掉時，「數位內容服務說明」也要跟著收起來 */
export default function Footer({ hideBusinessModel = false }: { hideBusinessModel?: boolean }) {
  const showBizModel = footerBusinessModel() && !hideBusinessModel && supportEnabled();
  const social = [
    { label: "Instagram", url: getSetting("social_ig", "") },
    { label: "Facebook", url: getSetting("social_fb", "") },
    { label: "YouTube", url: getSetting("social_yt", "") },
  ].filter((s) => s.url);
  const platforms = platformLinks();
  const contact = process.env.CONTACT_EMAIL || BRAND.email;
  return (
    <footer className="site-footer">
      <div className="inner">
        <div className="cols">
          <div className="brandline">
            <b>{BRAND.fullName}</b>
            <p>{t("footer_line")}</p>
          </div>
          {/* 收聽平台做成各家品牌色的按鈕（站長 2026-09-14：要一眼看出是 Apple、Spotify），社群與客服維持文字連結 */}
          <PlatformLinks platforms={platforms} small />
          <ul>
            {social.map((s) => (
              <li key={s.label}><a href={s.url} target="_blank" rel="noopener">{s.label}</a></li>
            ))}
            <li><a href="/rss.xml">RSS</a></li>
            {/* 金流審核要求：客服聯絡資訊需明文揭露（Email 直接顯示，不只放連結） */}
            <li><a href={`mailto:${contact}`}>合作與客服：{contact}</a></li>
          </ul>
        </div>

        {/* 營業人資訊：金流與消保法規要求明文揭露商號、統編與地址 */}
        <address className="biz-info">
          <b>{BRAND.legalName}</b>
          <span>統一編號：{BRAND.taxId}</span>
          <span>地址：{BRAND.address.full}</span>
          {showBizModel && <span>本站支持方案為數位內容服務，依法開立統一發票</span>}
        </address>
        <div className="fine-row">
          <span>
            © {new Date().getFullYear()} {BRAND.legalName}　All rights reserved.
            {/* 站主後台暗門：rel=nofollow 讓搜尋引擎不追蹤，/admin 本身也是 noindex */}
            <a href="/admin" rel="nofollow" aria-hidden="true" tabIndex={-1} style={{ color: "inherit", textDecoration: "none", cursor: "default" }}>..</a>
          </span>
          <span>
            <a href="/privacy">隱私權保護</a>　·　<a href="/terms">使用條款</a>　·　<a href="/returns">退換貨與退款</a>　·　<a href="/corrections">更正回報</a>
            {showBizModel && <>　·　<a href="/business-model">數位內容服務說明</a></>}
          </span>
        </div>
      </div>
    </footer>
  );
}
