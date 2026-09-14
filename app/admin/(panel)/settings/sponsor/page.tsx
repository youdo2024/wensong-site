import type { Metadata } from "next";
import Link from "next/link";
import { getSetting, json } from "@/lib/db";
import { saveSettings } from "@/app/admin/actions";
import Switch from "@/components/admin/Switch";
import Check from "@/components/admin/Check";
import StickySave from "@/components/admin/StickySave";
import SettingsHead from "@/components/admin/SettingsHead";
import { requireAdmin } from "@/lib/admin-guard";

export const metadata: Metadata = { title: "設定・贊助" };

/*
 * 設定・贊助（ia.md §2）：舊頁的「贊助方案」「結帳加購贊助」「贊助」三段。
 * 三段所以維持單欄，硬分兩欄只會左右不等高。
 *
 * 權益說明頁的金鑰與夥伴工作台那兩塊搬到設定・系統：一個是會撤銷連結的工具鈕，
 * 一個是「這裡沒有設定、去別頁」的指路牌，兩個都不是這一頁要按儲存的東西。
 */
export default async function SettingsSponsor({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string }>;
}) {
  await requireAdmin();
  const { saved } = await searchParams;

  const tiers = json<number[]>(getSetting("sponsor_tiers", "[888,5000,30000,80000]"), []);
  const addons = json<number[]>(getSetting("addon_tiers", "[300,3000,12000,30000]"), []);
  const addonOn = getSetting("addon_enabled", "1") === "1";
  const navHomeOn = getSetting("nav_support_home", "1") === "1";
  const navShopOn = getSetting("nav_support_shop", "1") === "1";
  const homeSecOn = getSetting("home_support_section", "1") === "1";
  const bizModelOn = getSetting("footer_business_model", "1") === "1";
  const mode = ["api", "hybrid", "link", "off"].includes(getSetting("support_mode", ""))
    ? getSetting("support_mode", "")
    : (getSetting("support_enabled", "1") === "1" ? "api" : "off");
  const monthlyGw = getSetting("monthly_gateway", "portaly") === "newebpay" ? "newebpay" : "portaly";

  return (
    <>
      <SettingsHead name="贊 助" title="設 定 ・ 贊 助" sub="四階金額、給觀眾的信、加購支持，以及贊助入口開在哪裡" />
      {saved && <p className="msg-ok">已儲存。</p>}

      <form className="adm-form ad-set" action={saveSettings}>
        <input type="hidden" name="_back" value="/admin/settings/sponsor" />

        <div className="ad-part">
          <div className="ad-sect"><h2>贊 助 方 案</h2><div className="rule" /></div>
          <div className="field">
            <label>四階金額（由低到高，一格一個金額）</label>
            <div className="adm-4num">
              {[0, 1, 2, 3].map((i) => (
                <input
                  key={i}
                  className="sans"
                  type="number"
                  min={100}
                  name={`tier_${i + 1}`}
                  defaultValue={tiers[i] ?? ""}
                  placeholder={`第 ${i + 1} 階`}
                  required
                />
              ))}
            </div>
          </div>
          <div className="field">
            <label>贊助文案（首頁與贊助頁「給觀眾的信」；空一行＝分段，句尾按 Enter＝段內換行）</label>
            <textarea className="ta-l ta-lead" name="sponsor_lead" defaultValue={getSetting("sponsor_lead")} />
          </div>

          {/* 導覽列右上角那顆「小額支持創作者」要出現在哪些頁面。
              分成兩個開關的理由：想讓購物動線乾淨、與想讓首頁乾淨，是兩件不同的事。 */}
          <div className="ad-note">
            <b>導覽列的「小額支持創作者」要出現在哪裡</b>
            <div className="sw-list">
              <Switch name="nav_support_home" label="首頁" defaultChecked={navHomeOn} />
              <Switch name="nav_support_shop" label="商店動線（商店、商品頁、購物車、訂單完成頁）" defaultChecked={navShopOn} />
            </div>
            <p className="fine">
              只影響導覽列那一顆按鈕。<b>文章頁、贊助頁都不受影響</b>，照常顯示；
              首頁內容裡的支持段落由下面那一組開關控制。
              贊助總開關（下面「贊助」設為關閉）時，這裡不論勾選與否都不會出現。
            </p>
          </div>

          {/* 頁面內容裡的支持露出。跟上面那組不同：上面管導覽列按鈕，這裡管版面上的區塊與頁尾連結。 */}
          <div className="ad-note">
            <b>頁面內容裡的支持區塊與頁尾連結</b>
            <div className="sw-list">
              <Switch name="home_support_section" label="首頁最下方的「小額支持創作者」整段（含金額按鈕與大額合作來信）" defaultChecked={homeSecOn} />
              <Switch name="footer_business_model" label="頁尾的「數位內容服務說明」連結" defaultChecked={bizModelOn} />
            </div>
            <p className="fine">
              頁尾連結關掉後，<span className="sans">/business-model</span> 這一頁本身還在，
              直接把網址給金流審查人員照樣打得開，只是站上找不到入口。
              另外，上面「商店動線」沒有勾選時，商店那幾頁的頁尾連結一律不出現，不受這裡勾選影響。
            </p>
          </div>
          <p className="fine">
            要給審查人員看的「支持方案權益說明頁」連結在<Link href="/admin/settings/system">設定・系統</Link>。
          </p>
        </div>

        <div className="ad-part">
          <div className="ad-sect"><h2>結 帳 加 購 贊 助</h2><div className="rule" /></div>
          <div className="sw-list">
            <Switch
              name="addon_enabled"
              label="結帳頁顯示加購支持"
              hint={<>就是結帳頁那一區「要不要順手多支持一點」。取消勾選後結帳頁不再出現，已成立的訂單不受影響。<b>導覽列的贊助按鈕不受這個開關影響</b>，那是上面那兩個。</>}
              defaultChecked={addonOn}
            />
          </div>
          <div className="field">
            <label>四階金額（由低到高，一格一個金額）</label>
            <div className="adm-4num">
              {[0, 1, 2, 3].map((i) => (
                <input
                  key={i}
                  className="sans"
                  type="number"
                  min={1}
                  name={`addon_${i + 1}`}
                  defaultValue={addons[i] ?? ""}
                  required
                />
              ))}
            </div>
          </div>
        </div>

        <div className="ad-part">
          <div className="ad-sect"><h2>贊 助</h2><div className="rule" /></div>
          <div className="chk-list">
            <Check
              type="radio" name="support_mode" value="api" defaultChecked={mode === "api"}
              label={<b>使用站內 API 收款</b>}
              hint="（贊助頁在自己網站完成，付款進後台贊助紀錄、發品牌感謝信、算入統計）"
            />
            <Check
              type="radio" name="support_mode" value="hybrid" defaultChecked={mode === "hybrid"}
              label={<b>綜合：單筆站內・每月依下方選擇</b>}
              hint={<>（單筆贊助一律在自己網站用藍新完成收款；每月定額依下面「每月定額怎麼收」的設定，走站內藍新定期定額，或改成一顆「下一步」連到外部網址）</>}
            />
            <div className="field ad-sub-field">
              <b style={{ fontSize: 13, letterSpacing: ".06em" }}>每月定額怎麼收（只在上面選「綜合」時生效）</b>
              <div className="chk-list" style={{ marginTop: 8 }}>
                <Check
                  type="radio" name="monthly_gateway" value="newebpay" defaultChecked={monthlyGw === "newebpay"}
                  label="站內藍新信用卡定期定額"
                  hint="（要先在藍新後台開通「信用卡定期定額」；付款進後台贊助紀錄、發品牌感謝信）"
                />
                <Check
                  type="radio" name="monthly_gateway" value="portaly" defaultChecked={monthlyGw !== "newebpay"}
                  label="前往外部網址（例如 Portaly）"
                  hint={<>（外部網址請填在下面「前往指定頁面贊助」的欄位，兩者共用同一個設定）</>}
                />
              </div>
            </div>
            <Check
              type="radio" name="support_mode" value="link" defaultChecked={mode === "link"}
              label={<b>前往指定頁面贊助</b>}
              hint={<>（贊助按鈕改成連到下方外部網址，例如 Portaly 傳送門。紀錄與通知在對方平台，<b>不會進本站後台</b>）</>}
            />
            <div className="field ad-sub-field">
              <input className="sans" type="url" name="support_url" placeholder="https://portaly.cc/youdo/support" defaultValue={getSetting("support_url", "")} />
            </div>
            <Check
              type="radio" name="support_mode" value="off" defaultChecked={mode === "off"}
              label={<b>關閉贊助</b>}
              hint="（前台隱藏所有贊助入口與結帳加購；既有每月定額的扣款與取消連結不受影響）"
            />
          </div>
        </div>

        <StickySave />
      </form>
    </>
  );
}
