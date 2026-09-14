import Link from "next/link";
import Nav from "@/components/Nav";
import Footer from "@/components/Footer";
import ScrollFx from "@/components/ScrollFx";
import Highlight from "@/components/Highlight";
import NbText from "@/components/NbText";
import PageViewPing from "@/components/PageViewPing";
import EpisodeCard from "@/components/EpisodeCard";
import EpisodePlayer from "@/components/EpisodePlayer";
import PlatformLinks from "@/components/PlatformLinks";
import LeadLetter from "@/components/LeadLetter";
import QuickSupport from "@/components/QuickSupport";
import SupportForm from "@/components/SupportForm";
import db, { getSetting, json } from "@/lib/db";
import { money } from "@/lib/format";
import { t } from "@/lib/copy";
import { buildMetadata } from "@/lib/seo";
import { BRAND } from "@/lib/brand";
import { displayTitle, epLabel, fmtDuration, type EpisodeRow } from "@/lib/episodes";
import { hosts, newsletterBlock, platformLinks } from "@/lib/site-config";
import { enabledPays, homeSupportSection, navSupportHome, shopEnabled, supportHref, supportMode, supportUrl, monthlyExternalUrl } from "@/lib/shop";
import { ecpayEnabled } from "@/lib/ecpay";
import { newebpayEnabled } from "@/lib/newebpay";
import { linepayEnabled } from "@/lib/linepay";
import { portalyEnabled } from "@/lib/portaly";
import { fmtDate } from "@/lib/format";

export const dynamic = "force-dynamic";

/* 首頁 canonical：帶 utm 的落地網址一律指回乾淨首頁 */
export const metadata = buildMetadata({ path: "/" });

type GuestCard = { id: number; slug: string; name: string; title: string; photo: string; n: number };

export default function Home() {
  const podcastCover = getSetting("podcast_cover", "");
  const latest = db
    .prepare("SELECT * FROM episodes WHERE published=1 ORDER BY pub_date DESC, id DESC LIMIT 7")
    .all() as EpisodeRow[];
  const [first, ...recent] = latest;
  const guests = db
    .prepare(
      `SELECT g.id,g.slug,g.name,g.title,g.photo,COUNT(eg.episode_id) AS n
       FROM guests g LEFT JOIN episode_guests eg ON eg.guest_id=g.id
       WHERE g.published=1 GROUP BY g.id ORDER BY g.featured DESC, n DESC, g.sort, g.id LIMIT 8`
    )
    .all() as GuestCard[];
  const products = shopEnabled()
    ? (db.prepare("SELECT id,name,category,price,image FROM products WHERE published=1 ORDER BY featured DESC, sort, id LIMIT 3").all() as { id: number; name: string; category: string; price: number; image: string }[])
    : [];
  const tiers = json<number[]>(getSetting("sponsor_tiers", "[150,500,1500,5000]"), [150, 500, 1500, 5000]);
  const lead = getSetting("sponsor_lead", BRAND.sponsorLead);
  const platforms = platformLinks();
  const hostList = hosts();

  return (
    <>
      <ScrollFx />
      <PageViewPing page="home" />
      <Nav hideSupport={!navSupportHome()} />

      {/* 1 HERO：左邊一句話，右邊最新一集直接播 */}
      <header className="hero home-hero">
        <div className="band" />
        <div className="inner">
          <div className="mid" data-reveal>
            <span className="origin">{t("hero_tag")}</span>
            <h1><Highlight text={t("hero_title")} /></h1>
            <p className="dek"><NbText text={t("hero_dek")} /></p>
            {first ? <Link className="btn fill" href={`/ep/${first.key}`}>{t("hero_btn1")}</Link> : null}
            <Link className="btn" href="/ep">{t("hero_btn2")}</Link>
          </div>
          {first && (
            <div className="latest-ep" data-reveal style={{ "--rv-delay": ".15s" } as React.CSSProperties}>
              <span className="lab">{t("hero_latest")}</span>
              <Link href={`/ep/${first.key}`} className="head">
                {(first.cover || first.image || podcastCover) && (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img src={first.cover || first.image || podcastCover} alt="" />
                )}
                <div>
                  <small className="sans">{epLabel(first.series, first.ep_no)}・{fmtDate(first.pub_date.slice(0, 10))}・{fmtDuration(first.duration)}</small>
                  <b>{displayTitle(first)}</b>
                </div>
              </Link>
              <EpisodePlayer src={first.audio_url} type={first.audio_type} title={displayTitle(first)} compact />
            </div>
          )}
        </div>
      </header>

      {/* 2 收聽平台 */}
      {platforms.length > 0 && (
        <section className="platform-sec">
          <div className="frame">
            <p className="pf-title">{t("platforms_title")}</p>
            <PlatformLinks platforms={platforms} />
          </div>
        </section>
      )}

      {/* 3 最新 6 集 */}
      <section className="eps-sec">
        <div className="frame">
          <div className="sec-head" data-reveal>
            <span className="tag">{t("eps_tag")}</span>
            <h2>{t("eps_title")}</h2>
            <p><NbText text={t("eps_sub")} /></p>
          </div>
          {latest.length === 0 ? (
            <p className="empty">集數還沒同步進來。後台按「立即同步」，或等每天的自動同步。</p>
          ) : (
            <div className="ep-grid">
              {recent.slice(0, 6).map((e, i) => (
                <EpisodeCard key={e.id} e={e} fallbackCover={podcastCover} style={{ "--rv-delay": `${i * 0.08}s` } as React.CSSProperties} />
              ))}
            </div>
          )}
          <div className="more"><Link className="btn" href="/ep">{t("eps_btn")}</Link></div>
        </div>
      </section>

      {/* 4 主持人 */}
      <section className="hosts-sec">
        <div className="frame">
          <div className="sec-head" data-reveal>
            <span className="tag">{t("hosts_tag")}</span>
            <h2>{t("hosts_title")}</h2>
            <p><NbText text={t("hosts_sub")} /></p>
          </div>
          <div className="hosts-grid">
            {hostList.map((h, i) => (
              <div className="host-card" key={h.key} data-reveal style={{ "--rv-delay": `${i * 0.12}s` } as React.CSSProperties}>
                <div className={`photo${h.photo ? "" : " ph"}`}>
                  {h.photo ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img src={h.photo} alt={h.name} loading="lazy" />
                  ) : (
                    <span>{h.name.slice(0, 1)}</span>
                  )}
                </div>
                <div className="body">
                  <small>{h.title}</small>
                  <b>{h.name}</b>
                  <p>{h.intro}</p>
                  {h.link && <a href={h.link} target="_blank" rel="noopener">追蹤 {h.name} →</a>}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 5 來賓精選 */}
      {guests.length > 0 && (
        <section className="guests-sec">
          <div className="frame">
            <div className="sec-head" data-reveal>
              <span className="tag">{t("guests_tag")}</span>
              <h2>{t("guests_title")}</h2>
              <p><NbText text={t("guests_sub")} /></p>
            </div>
            <div className="guest-grid">
              {guests.map((g, i) => (
                <Link className="guest-card" key={g.id} href={`/guests/${g.slug}`} data-reveal style={{ "--rv-delay": `${i * 0.06}s` } as React.CSSProperties}>
                  <div className={`ava${g.photo ? "" : " ph"}`}>
                    {g.photo ? (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img src={g.photo} alt={g.name} loading="lazy" />
                    ) : (
                      <span>{g.name.replace(/^.*[\s：:]/, "").slice(0, 1)}</span>
                    )}
                  </div>
                  <b>{g.name}</b>
                  {g.title && <small>{g.title}</small>}
                  <span className="cnt sans">{g.n} 集</span>
                </Link>
              ))}
            </div>
            <div className="more"><Link className="btn" href="/guests">{t("guests_btn")}</Link></div>
          </div>
        </section>
      )}

      {/* 6 周邊商店（站長模式：shop_enabled=0 時對外不顯示） */}
      {shopEnabled() && products.length > 0 && (
        <section className="shop-sec">
          <div className="frame">
            <div className="sec-head" data-reveal>
              <span className="tag">{t("shopsec_tag")}</span>
              <h2>{t("shopsec_title")}</h2>
              <p><NbText text={t("shopsec_sub")} /></p>
            </div>
            <div className="prod-grid home">
              {products.map((p, i) => (
                <Link className="prod big" key={p.id} href={`/shop/${p.id}`} data-reveal style={{ "--rv-delay": `${i * 0.12}s` } as React.CSSProperties}>
                  <span className="cat-tag">{p.category}</span>
                  {p.image ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img src={p.image} alt={p.name} className="img img-fill" loading="lazy" />
                  ) : (
                    <div className="img ph">商品照</div>
                  )}
                  <div className="body" style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10 }}>
                    <b>{p.name}</b>
                    <span className="price">{money(p.price)}</span>
                  </div>
                </Link>
              ))}
            </div>
            <div className="more"><Link className="btn" href="/shop">{t("shopsec_btn")}</Link></div>
          </div>
        </section>
      )}

      {/* 7 支持我們（站長模式：support_mode=off 時整段不顯示） */}
      {homeSupportSection() && (
        <section className="support-sec" id="support">
          <div className="frame">
            <div className="box support-box" data-reveal>
              <div className="band" />
              <div className="inner">
                <h2>{t("support_title")}</h2>
                <LeadLetter text={lead} closing="每一次支持，都讓下一集有得錄。" variant={2} />
                {supportMode() === "link" ? (
                  <div className="center" style={{ marginTop: 8 }}>
                    <a className="btn fill" href={supportHref()} target="_blank" rel="noopener" data-ga="sponsor-external">前往支持</a>
                  </div>
                ) : (supportMode() === "api" || supportMode() === "hybrid") && !ecpayEnabled() && newebpayEnabled() ? (
                  /*
                   * 藍新有金鑰（綠界沒開）時，長期／單次兩個分頁都在站內完成：
                   * 單筆一律走藍新 MPG；長期定額依後台 monthly_gateway 設定，
                   * newebpay 就走站內定期定額委託，portaly 就沿用既有的外連「下一步」
                   * （monthlyExternalUrl 在 monthly_gateway=newebpay 時本來就回空字串）。
                   * 不再用 QuickSupport 中繼一次：那是為了「先選金額再進 /support 填資料」，
                   * 這裡兩個分頁都能直接在首頁完成，不需要那道中繼。
                   */
                  <SupportForm
                    tiers={tiers}
                    initAmount={tiers[0] ?? 150}
                    initMode="monthly"
                    modeTabs
                    bare
                    monthlyExternal={monthlyExternalUrl()}
                    pays={enabledPays(["信用卡", "ATM 轉帳"], "support")}
                    provider="newebpay"
                  />
                ) : supportMode() === "hybrid" && supportUrl() ? (
                  <SupportForm
                    tiers={tiers}
                    initAmount={tiers[0] ?? 150}
                    initMode="monthly"
                    modeTabs
                    bare
                    monthlyExternal={supportUrl()}
                    pays={ecpayEnabled() ? enabledPays(["LINE Pay", "Apple Pay", "信用卡", "ATM 轉帳", "多元支付"]).filter((p) => p !== "LINE Pay" || linepayEnabled()) : enabledPays(["LINE Pay", "Apple Pay", "信用卡", "銀行轉帳"])}
                    provider={ecpayEnabled() ? "ecpay" : portalyEnabled() ? "portaly" : "payuni"}
                  />
                ) : (
                  <>
                    <QuickSupport tiers={tiers} note={t("quick_note")} />
                    <div className="support-links">
                      <Link href="/support?mode=once">單次支持</Link>
                      <Link href="/support">查看完整支持說明</Link>
                    </div>
                  </>
                )}
              </div>
              <div className="band" />
            </div>
          </div>
        </section>
      )}

      {/* 8 電子報（站長模式：newsletter_block=0 時不顯示） */}
      {newsletterBlock() && (
        <section className="nl-sec">
          <div className="frame">
            <div className="sec-head" data-reveal>
              <span className="tag">{t("nl_tag")}</span>
              <h2>{t("nl_title")}</h2>
              <p><NbText text={t("nl_sub")} /></p>
            </div>
            <form className="nl-form" action="/api/subscribe" method="post">
              <input type="email" name="email" placeholder="你的 Email" required />
              <button className="btn fill" type="submit">訂閱</button>
            </form>
          </div>
        </section>
      )}

      <Footer />
    </>
  );
}
