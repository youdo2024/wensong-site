import type { Metadata } from "next";
import Link from "next/link";
import { getSetting } from "@/lib/db";
import { saveSettings } from "@/app/admin/actions";
import { PAY_METHOD_KEYS, freightMode, payMethodsOff } from "@/lib/shop";
import { ECPAY_ATM_BANKS } from "@/lib/ecpay";
import { NEWEBPAY_ATM_BANKS } from "@/lib/newebpay";
import MultiInput from "@/components/MultiInput";
import Switch from "@/components/admin/Switch";
import StickySave from "@/components/admin/StickySave";
import SettingsHead from "@/components/admin/SettingsHead";
import { requireAdmin } from "@/lib/admin-guard";

export const metadata: Metadata = { title: "設定・商店" };

/*
 * 設定・商店（ia.md §2）：舊頁的「商店」「運費費率表」「付款方式」
 * 「文章頁的支持商品 CTA」「首頁圖片」五段收在這裡。
 *
 * 原本散在這幾段裡的工具鈕（預覽連結、寄測試信、LINE Pay 探測、幕後取號探測）
 * 全部搬到設定・系統：那些是「按一下會發生一件事」，跟「填好按儲存」是兩種操作，
 * 混在同一頁時站長分不清哪一顆會存、哪一顆會寄信出去。
 *
 * 版面維持單欄。四段以上照規格要分兩欄，但這一頁的費率表是四欄數字、
 * 付款方式是兩張並排的卡，塞進半個欄寬會被壓爛，寧可單欄滑久一點。
 */
export default async function SettingsShop({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; linepay?: string }>;
}) {
  await requireAdmin();
  const { saved, linepay } = await searchParams;

  const shopOn = getSetting("shop_enabled", "1") === "1";
  /* 預設值要跟 lib/shop.ts 寫的一樣，不然勾選框顯示的狀態會跟前台實際行為對不上 */
  const artShopOn = getSetting("article_shop_cta", "0") === "1";
  const artShopHref = getSetting("article_shop_href", "/shop");
  const paysOffShop = payMethodsOff("shop");
  const paysOffSupport = payMethodsOff("support");

  return (
    <>
      <SettingsHead name="商 店" title="設 定 ・ 商 店" sub="商店開不開、運費怎麼算、能用哪些付款方式、首頁那幾張照片" />
      {saved && <p className="msg-ok">已儲存。</p>}
      {linepay && linepay !== "ok" && <p className="msg-err">LINE Pay 探測失敗：{linepay}。金鑰沒有改動，LINE Pay 維持關閉。</p>}

      <form className="adm-form ad-set" action={saveSettings}>
        {/* 存完回這一頁。白名單在 actions.ts 的 settingsBack() */}
        <input type="hidden" name="_back" value="/admin/settings/shop" />

        <div className="ad-part">
          <div className="ad-sect"><h2>商 店</h2><div className="rule" /></div>
          <div className="sw-list">
            <Switch
              name="shop_enabled"
              label="商店開放中"
              hint="（取消勾選＝整個商店暫停：前台隱藏商店與購物車，商品頁顯示「休息中」）"
              defaultChecked={shopOn}
            />
          </div>
          {!shopOn && (
            <p className="fine">
              商店目前只有你看得到。要給金流審查人員看完整商店與結帳，到
              <Link href="/admin/settings/system">設定・系統</Link>拿商店預覽連結。
            </p>
          )}
          <div className="field">
            <label>商品分類（一格一個，按＋新增；新增分類後到商品編輯選用）</label>
            <MultiInput name="product_categories" defaultValues={getSetting("product_categories", "服飾,食品,其他").split(/[,，、]/).map((t) => t.trim()).filter(Boolean)} placeholder="例如：服飾" />
          </div>
          {/* 舊制三格：只有把運費模式切成「全站單一運費」時才生效。
              平常請改下面那張四格費率表，免得兩邊數字打架、站長不知道改了哪一個。 */}
          <details>
            <summary>舊制運費欄位（只有切到「全站單一運費」才用得到，平常不用動）</summary>
            <div className="adm-3col">
              <div className="field">
                <label>免運門檻（NT$）</label>
                <input className="sans" type="number" name="free_ship_threshold" defaultValue={getSetting("free_ship_threshold", "1500")} />
              </div>
              <div className="field">
                <label>宅配運費（NT$）</label>
                <input className="sans" type="number" name="ship_fee" defaultValue={getSetting("ship_fee", "120")} />
              </div>
              <div className="field">
                <label>7-11 店到店運費（NT$）</label>
                <input className="sans" type="number" name="ship_fee_cvs" defaultValue={getSetting("ship_fee_cvs", "65")} />
              </div>
            </div>
          </details>
        </div>

        <div className="ad-part">
          <div className="ad-sect"><h2>運 費 費 率 表</h2><div className="rule" /></div>
          <p className="fine">
            四種組合各自獨立：溫層（常溫／冷凍）× 取貨方式（宅配／店到店）。
            <b>「我付的成本」只有你看得到</b>，夥伴的工作台不會出現，它只用來算結算報表的
            「運費成本」與「運費損益」。<b>免運的包裹成本照算</b>，貨照樣要寄、錢照樣要付，
            那是行銷成本不該從報表消失。
          </p>
          <div className="adm-table-wrap">
            <table className="adm-table sans wide ad-rate">
              <thead>
                <tr>
                  <th></th>
                  <th>常溫宅配</th>
                  <th>常溫店到店</th>
                  <th>冷凍宅配</th>
                  <th>冷凍店到店</th>
                </tr>
              </thead>
              <tbody>
                {[
                  { label: "跟客人收", pre: "rate_charge", def: ["125", "65", "280", "145"] },
                  { label: "我付的成本", pre: "rate_cost", def: ["120", "60", "250", "140"] },
                  { label: "免運門檻", pre: "rate_free", def: ["1440", "1440", "3000", "3000"] },
                ].map((row) => (
                  <tr key={row.pre}>
                    <td><b>{row.label}</b></td>
                    {["ambient_home", "ambient_cvs", "cold_home", "cold_cvs"].map((k, i) => (
                      <td key={k}>
                        <input
                          className="sans" type="number" min={0} name={`${row.pre}_${k}`}
                          defaultValue={getSetting(`${row.pre}_${k}`, row.def[i])}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="sw-list">
            <Switch
              name="cold_enabled"
              label="開放冷凍商品"
              hint="沒勾＝冷凍功能整個關閉：就算有商品被設成冷凍，也買不了（結帳會擋）。第一檔期只收常溫夥伴時保持關閉，等真的有冷凍夥伴再打開。"
              defaultChecked={getSetting("cold_enabled", "0") === "1"}
            />
          </div>
          <div className="adm-3col">
            <div className="field">
              <label>出貨逾期警報（天）：0＝關閉。有填下架日的週次只看截止日；沒填的用「付款後滿 N 天未出」。預購檔請先把週次填好下架日再開啟</label>
              <input className="sans" type="number" name="partner_late_days" defaultValue={getSetting("partner_late_days", "0")} min={0} />
            </div>
            <div className="field">
              <label>本店的超商通路（你自己出貨的商品用哪家；夥伴的貨用夥伴自己設的）</label>
              <select name="cvs_brand_own" defaultValue={getSetting("cvs_brand_own", "7-11")}>
                <option value="7-11">7-11</option>
                <option value="全家">全家</option>
              </select>
            </div>
            <div className="field">
              <label>運費模式</label>
              <select name="freight_mode" defaultValue={freightMode()}>
                <option value="origin">按出貨地計運（每個出貨來源各收一次、各自免運）</option>
                <option value="flat">全站單一運費（舊制：整單收一次）</option>
              </select>
            </div>
          </div>
        </div>

        <div className="ad-part">
          <div className="ad-sect"><h2>付 款 方 式</h2><div className="rule" /></div>
          <p className="fine">
            商店與贊助分開設定。兩邊的條件本來就不一樣，而且換金流時常常是一邊換好、另一邊還沒，
            共用一組開關就一定有一邊被迫將就。關掉信用卡時，每月定額贊助會一併暫停。
          </p>
          {/*
            這一格是給後端認的標記，不是設定。
            沒勾的 checkbox 完全不會送出，所以「全部關掉」跟「這一頁根本沒有付款方式那一區」
            送上去長得一模一樣。有這個標記，saveSettings 才分得出來要不要動這三個鍵。
          */}
          <input type="hidden" name="pm_form" value="1" />
          {/* 兩張卡片並排：左商店右贊助，一眼看得出哪些開著 */}
          <div className="pm-grid">
            {([
              { scope: "shop", title: "商店結帳", sub: "購物車與付款連結", off: paysOffShop },
              { scope: "support", title: "贊助", sub: "支持方案頁", off: paysOffSupport },
            ] as const).map((col) => (
              <div className="pm-card" key={col.scope}>
                <div className="pm-head">
                  <b>{col.title}</b>
                  <span>{col.sub}</span>
                </div>
                {PAY_METHOD_KEYS.map((m) => (
                  <label className="pm-row" key={m.key}>
                    <span>{m.label}</span>
                    <input
                      type="checkbox"
                      name={`pm_${col.scope}_${m.key}`}
                      value="1"
                      defaultChecked={!col.off.includes(m.key)}
                    />
                    <i className="pm-sw" aria-hidden />
                  </label>
                ))}
              </div>
            ))}
          </div>
          {/* LINE Pay 只有這兩排開關在管：系統遇到金鑰層級錯誤會自動把它關掉（畫面會反映），
              勾回來時會先探測金鑰，不通就不准開。 */}
          <p className="fine">
            LINE Pay：{getSetting("linepay_last_error", "") ? <>系統最近一次自動暫停：<b>{getSetting("linepay_last_error", "")}</b>。</> : "目前沒有失敗紀錄。"}
            直接勾上面的開關存檔會先用金鑰去 LINE 探測，不通就維持關閉。
            換完 Zeabur 金鑰後想一次打開商店與贊助兩邊，到<Link href="/admin/settings/system">設定・系統</Link>按「測試 LINE Pay」。
          </p>
          <div className="field">
            <label>ATM 轉帳直接指定銀行（綠界，問爽的不用）</label>
            <select name="ecpay_atm_bank" defaultValue={getSetting("ecpay_atm_bank", "")}>
              <option value="">不指定，讓客人在綠界頁自己選</option>
              {ECPAY_ATM_BANKS.map((b) => <option key={b.key} value={b.key}>{b.label}</option>)}
            </select>
            <p className="fine">
              指定了就直接產該銀行的虛擬帳號，客人少一步選銀行；客人用同一家銀行轉帳不用跨行手續費，所以選你客人最常用的那家。
              綠界頁面還是會出現一下（訂單成立頁），只是不用選。台新、玉山、富邦目前綠界暫不提供，所以不在清單。
              這組只在商店金流選「綠界」時生效，問爽的目前走藍新，不會用到這組。
            </p>
          </div>
          {/* 開關放在 .field 外面：.field label 的字距與底邊距會蓋到開關列 */}
          <div className="sw-list">
            <Switch
              name="ecpay_atm_backstage"
              label="商店與贊助的 ATM 改走幕後取號（綠界，問爽的不用；客人不進綠界頁面，帳號直接顯示在感謝頁與信裡）"
              hint="要先到設定・系統探測成功才勾。銀行用上面那格選的（沒選就中國信託）。取號失敗會自動退回原本的綠界頁，客人不會卡住。商店與贊助同一個開關。這組只在商店金流選「綠界」時生效。藍新沒有這條路：藍新的「非信用卡應用 API 機制」（涵蓋 ATM／WebATM／超商代碼／條碼）需要另外書面申請並經藍新審核通過才能用，問爽的目前沒有申請，ATM 一律要經過藍新頁面才能取號；取號後帳號一樣會顯示在感謝頁與信裡，客人體驗差別不大。"
              defaultChecked={getSetting("ecpay_atm_backstage", "0") === "1"}
            />
          </div>
          <div className="field">
            <label>ATM 指定銀行（藍新）</label>
            <select name="newebpay_atm_bank" defaultValue={getSetting("newebpay_atm_bank", "BOT")}>
              <option value="">不指定，讓客人在藍新頁自己選</option>
              {NEWEBPAY_ATM_BANKS.map((b) => <option key={b.key} value={b.key}>{b.label}</option>)}
            </select>
            <p className="fine">
              商店金流選「藍新」時，ATM 轉帳會直接指定這家銀行的虛擬帳號，客人在藍新頁不用再選銀行，預設台灣銀行。
              藍新目前 BankType 只支援台灣銀行、華南銀行、凱基銀行三家（第一銀行藍新已於 2023 年從這個參數移除）。
              客人還是會短暫看到藍新的付款頁（取號那一步），藍新沒有提供不經過頁面直接取號的做法，見上面幕後取號的說明。
            </p>
          </div>
        </div>

        <div className="ad-part">
          <div className="ad-sect"><h2>文 章 頁 的 支 持 商 品 C T A</h2><div className="rule" /></div>
          <div className="sw-list">
            <Switch
              name="article_shop_cta"
              label="文章頁顯示「支持商品」"
              hint={<>
                檔期用的（中秋、年節）。勾了之後，<b>每一篇文章</b>的文末會多一塊金色的商品 CTA，
                放在「小額支持創作者」之前。檔期的當下商品是主角，但支持創作者那一塊不會消失，兩個都在。
                <br />
                連自己設了「文末 CTA 關閉」的文章也會出現，因為檔期的意思就是全站一起推。
                商店休息中的時候，就算勾了也不會出現，連過去只會看到一頁休息公告，那是白花的點擊。
                <br />
                文字（標題、內文、按鈕）在設定・內容的「文章頁」那一組可以改。
              </>}
              defaultChecked={artShopOn}
            />
          </div>
          <div className="field">
            <label>點下去要去哪裡</label>
            <input type="text" name="article_shop_href" defaultValue={artShopHref} placeholder="/shop" />
            <p className="fine">
              預設 <code>/shop</code>（整個商店）。檔期主打單一商品的話填那個商品的網址，例如 <code>/shop/12</code>。
              只收站內路徑，填了外部網址會自動退回 /shop。
            </p>
          </div>
        </div>


        <StickySave />
      </form>
    </>
  );
}
