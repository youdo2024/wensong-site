import type { Metadata } from "next";
import Link from "next/link";
import { getSetting } from "@/lib/db";
import {
  sendTestNotifyMail, sendTestOwnerMail, sendTemplateTestMails, sendGaTestEvent,
  runBackupNow, regenShopPreviewKey, regenPlanPreviewKey, refreshNpobanList,
  linepayProbeAndEnable, ecpayGenPayProbeAction,
} from "@/app/admin/actions";
import { npobanCount, npobanUpdatedAt, npobanName, DEFAULT_NPOBAN } from "@/lib/npoban";
import { mailEnabled, mailTransportLabel } from "@/lib/mail";
import { newsleopardEnabled } from "@/lib/newsleopard";
import CopyField from "@/components/CopyField";
import ConfirmSubmit from "@/components/ConfirmSubmit";
import SettingsHead from "@/components/admin/SettingsHead";
import { requireAdmin } from "@/lib/admin-guard";

export const metadata: Metadata = { title: "設定・系統" };

/*
 * 設定・系統（ia.md §2）：備份、預覽金鑰、測試信、環境資訊，
 * 加上原本散在各段裡的工具鈕（LINE Pay 探測、綠界幕後取號探測、捐贈碼清單、GA 測試事件）。
 *
 * 為什麼要集中：這些鈕跟設定長得一樣，但性質完全相反，設定是「填好按儲存」，
 * 這些是「按下去當場發生一件事，而且收不回來」（寄七封信、撤銷別人手上的連結、
 * 向綠界取一組真的虛擬帳號）。混在設定中間，站長滑過去順手按到才是真的問題。
 *
 * 這一頁沒有任何設定欄位，所以沒有儲存鈕，也不需要黏底儲存列。
 * 每一顆鈕各自一個小表單，各走各的 server action，不會互相帶到別人的欄位。
 */
export default async function SettingsSystem({
  searchParams,
}: {
  searchParams: Promise<{ mailtest?: string; gatest?: string; backup?: string; npoban?: string; linepay?: string; tmplmail?: string; genpay?: string }>;
}) {
  await requireAdmin();
  const { mailtest, gatest, backup, npoban, linepay, tmplmail, genpay } = await searchParams;
  const site = (process.env.SITE_URL || "https://www.wensong.tw").replace(/\/$/, "");

  return (
    <>
      <SettingsHead name="系 統" title="設 定 ・ 系 統" sub="備份、審查用的預覽連結、測試信與各種探測、環境資訊" />

      {linepay === "ok" && <p className="msg-ok">LINE Pay 金鑰通了，商店與贊助的 LINE Pay 都已重新開啟。</p>}
      {linepay && linepay !== "ok" && <p className="msg-err">LINE Pay 探測失敗：{linepay}。金鑰沒有改動，LINE Pay 維持關閉。</p>}
      {genpay === "ok" && <p className="msg-ok">綠界幕後取號通了，可以到設定・商店勾「ATM 改走幕後取號」。</p>}
      {genpay === "fail" && <p className="msg-err">綠界幕後取號探測失敗，正式特店可能沒有開通這項服務。</p>}
      {mailtest === "ok" && <p className="msg-ok">測試信已寄出，請到通知信箱收信（含垃圾信匣）。</p>}
      {mailtest === "fail" && <p className="msg-err">測試信寄送失敗，請確認主機的 SMTP 環境變數（SMTP_HOST／SMTP_USER／SMTP_PASS）。</p>}
      {mailtest === "noemail" && <p className="msg-err">還沒有信箱可以寄。請先到設定・商店填好通知信箱並儲存。</p>}
      {tmplmail?.startsWith("ok:") && <p className="msg-ok">交易信範本已全部寄到 {tmplmail.slice(3)}，請到那個信箱收信（含垃圾信匣）。</p>}
      {tmplmail && !tmplmail.startsWith("ok:") && <p className="msg-err">範本測試信沒寄出：{tmplmail}</p>}
      {npoban && <p className="msg-ok">捐贈碼清單：{npoban}</p>}
      {gatest === "ok" && (
        <p className="msg-ok">
          GA 測試事件已送出（sponsor_complete 與 purchase，金額 0）。約 5 到 30 分鐘後到 GA →
          管理 → 事件 →「近期事件」就會看到這兩個名稱，點左邊星號即可標為重要事件。
        </p>
      )}
      {gatest && gatest !== "ok" && <p className="msg-err">GA 測試失敗：{decodeURIComponent(gatest)}</p>}
      {backup?.startsWith("ok:") && <p className="msg-ok">備份已寄到站長通知信箱：{decodeURIComponent(backup.slice(3))}</p>}
      {backup?.startsWith("err:") && <p className="msg-err">備份失敗：{decodeURIComponent(backup.slice(4))}</p>}

      <div className="ad-set">
        <div className="ad-part">
          <div className="ad-sect"><h2>備 份</h2><div className="rule" /></div>
          <p className="fine">
            每天凌晨 4 點自動把「資料庫＋後台上傳的圖片」打包寄到站長通知信箱（資料沒變動的日子不寄）。
            程式碼本身在 GitHub，這份備份是唯一一份營運資料。訂單與贊助憑證依法須保存 5 到 7 年，請保留這些信件。
            {getSetting("backup_last_at", "") && `　最近一次備份：${getSetting("backup_last_at", "").slice(0, 16).replace("T", " ")} UTC`}
          </p>
          {/* 自動備份失敗時要看得見。以前失敗只寫進主機的 log，站長不會知道備份已經斷了 */}
          {getSetting("backup_last_error", "") && (
            <p className="msg-err">
              自動備份沒有成功：{getSetting("backup_last_error", "")}
              <br />
              當天自動重試次數已用完的話，按下面的「立即備份一次」可以馬上補一份；成功之後這則訊息會自動消失。
            </p>
          )}
          <form action={runBackupNow} className="adm-actions">
            <button className="btn" type="submit">立即備份一次</button>
          </form>
        </div>

        <div className="ad-part">
          <div className="ad-sect"><h2>預 覽 金 鑰</h2><div className="rule" /></div>
          {/* 商店休息中時的審查通道：把這條連結給金流審查人員，點開就能看到完整商店與結帳 */}
          <div className="ad-note">
            <b>商店預覽連結（給審查人員）</b>
            <p className="fine">
              商店關閉時只有你看得到。把下面這條連結交給金流審查人員，對方點開後 30 天內可以瀏覽商店、購物車與結帳頁（也能實際下單測試）。
              審查結束按「重新產生」，舊連結與對方裝置上的權限立即全部失效。
            </p>
            <CopyField value={`${site}/api/shop-preview?k=${getSetting("shop_preview_key", "")}`} />
            <form action={regenShopPreviewKey} className="adm-actions">
              <ConfirmSubmit className="btn danger" formNoValidate message="確定重新產生？所有舊連結與審查人員裝置上的權限會立即失效。">
                重新產生（撤銷所有舊連結）
              </ConfirmSubmit>
            </form>
          </div>

          {/* 權益說明頁：永遠不對外公開，只靠這條連結給人看（例如金流審查） */}
          <div className="ad-note warn">
            <b>支持方案權益說明頁連結（給審查人員）</b>
            <p className="fine">
              這一頁列出 888／3000／6000／12000 四個階段各自提供的內容，<b>不會公開、也不會被搜尋到</b>，贊助頁上同樣看不到。
              把下面這條連結交給金流審查人員，對方點開後 30 天內都能查看。審查結束按「重新產生」，舊連結與對方裝置上的權限立即全部失效。
              你自己登入後台時可以直接開 <span className="sans">/support/plan</span>。
            </p>
            <CopyField value={`${site}/api/plan-preview?k=${getSetting("plan_preview_key", "")}`} />
            <form action={regenPlanPreviewKey} className="adm-actions">
              <ConfirmSubmit className="btn danger" formNoValidate message="確定重新產生？所有舊連結與審查人員裝置上的權限會立即失效。">
                重新產生（撤銷所有舊連結）
              </ConfirmSubmit>
            </form>
          </div>
        </div>

        <div className="ad-part">
          <div className="ad-sect"><h2>測 試 信</h2><div className="rule" /></div>
          <p className="fine">
            信箱本身在<Link href="/admin/settings/shop">設定・商店</Link>填，這裡只負責寄出去驗證真的收得到。
            按下去用的是已經存起來的那份信箱，不是畫面上的暫存值。
          </p>
          <form action={sendTestNotifyMail} className="adm-actions">
            <button className="btn" type="submit">寄測試信到商品訂購通知信箱</button>
          </form>
          <form action={sendTestOwnerMail} className="adm-actions">
            <button className="btn" type="submit">寄測試信到站長通知信箱</button>
          </form>
          {/* 走 server action（POST）而不是舊的 /api/admin/test-mails?to=…。
              GET 版本會被別的網站用一條連結誘導站長點下去，就替對方寄信出去 */}
          <form action={sendTemplateTestMails}>
            <div className="field">
              <label>寄一整套交易信範本給自己（訂單確認、出貨通知、贊助感謝、每月扣款、未完成付款提醒共 7 封；改過信件版型後用這個看實際長相。留空就寄給寄件帳號自己）</label>
              <input type="email" name="tmpl_test_to" placeholder="例如：你自己的@gmail.com" />
            </div>
            <div className="adm-actions">
              <button className="btn" type="submit">寄範本測試信</button>
            </div>
          </form>
        </div>

        <div className="ad-part">
          <div className="ad-sect"><h2>探 測 與 清 單</h2><div className="rule" /></div>

          <div className="ad-note">
            <b>LINE Pay</b>
            <p className="fine">
              {getSetting("linepay_last_error", "") ? <>系統最近一次自動暫停：<b>{getSetting("linepay_last_error", "")}</b>。</> : "目前沒有失敗紀錄。"}
              換完 Zeabur 金鑰後按下面這顆，用金鑰去 LINE 查一筆不存在的訂單（不建交易、不扣款），
              通了就自動把商店與贊助的 LINE Pay 一起打開。
            </p>
            <form action={linepayProbeAndEnable} className="adm-actions">
              <ConfirmSubmit className="btn danger" formNoValidate message="確定測試 LINE Pay？金鑰通了會直接把商店與贊助的 LINE Pay 一起打開。">
                測試 LINE Pay 並開啟商店與贊助
              </ConfirmSubmit>
            </form>
          </div>

          <div className="ad-note">
            <b>綠界幕後取號</b>
            <p className="fine">
              要讓客人連綠界頁面都不出現，得改走綠界「幕後取號」API（另一套服務，特店要有開通）。
              測試環境已實測可用；你的正式特店能不能用，按下面這顆探測：會真的取一組 100 元、隔天到期的虛擬帳號，
              沒人繳就自動作廢，取號本身不收費。探測成功後到設定・商店勾起那個開關。
              {getSetting("ecpay_genpay_last", "") && <><br />上次探測：<b>{getSetting("ecpay_genpay_last", "")}</b></>}
            </p>
            <form action={ecpayGenPayProbeAction} className="adm-actions">
              <ConfirmSubmit className="btn danger" formNoValidate message="確定探測？會真的向綠界取一組 100 元、隔天到期的虛擬帳號，沒人繳會自動作廢。">
                探測綠界幕後取號
              </ConfirmSubmit>
            </form>
          </div>

          {/* 捐贈碼清單：平常不用管、但壞了要看得到的維運項目 */}
          <div className="ad-note">
            <b>電子發票捐贈碼清單</b>
            <p className="fine">
              結帳頁的「捐發票」用這份清單驗證客人填的捐贈碼、並顯示受贈單位名稱。
              來源是財政部「受捐贈機關或團體捐贈碼清單」開放資料，官方每月更新一次。
              <br />
              光貿也會驗，但那是在<b>收完錢之後</b>：碼錯了會被退件，系統改開成寄 Email 的發票，
              客人以為自己捐了、其實沒捐。捐贈不可逆，所以要在他按下付款之前就擋下來。
              <br />
              目前 <b className="sans">{npobanCount().toLocaleString()}</b> 筆
              版本：{npobanUpdatedAt() || "未知"}
              預設受贈單位：{npobanName(DEFAULT_NPOBAN) || "（查不到，清單可能有問題）"}（{DEFAULT_NPOBAN}）
              <br />
              抓失敗、格式解析不出來、或抓到的筆數少於現有的一半，都會保留舊清單不覆蓋。
            </p>
            <form action={refreshNpobanList} className="adm-actions">
              <button className="btn" type="submit">到財政部更新清單</button>
            </form>
          </div>

          <div className="ad-note">
            <b>Google Analytics 轉換追蹤</b>
            <p className="fine">
              贊助與購買的轉換由伺服器在「確認入帳」時直接回報 GA（ATM 入帳、瀏覽器擋追蹤器都記得到）。
              按下按鈕會送一筆金額 0 的測試事件，用來驗證設定，並讓事件名出現在 GA 清單裡以便標成「重要事件」。
            </p>
            <form action={sendGaTestEvent} className="adm-actions">
              <button className="btn" type="submit">送 GA 測試事件</button>
            </form>
          </div>
        </div>

        <div className="ad-part">
          <div className="ad-sect"><h2>環 境 資 訊</h2><div className="rule" /></div>
          <p className="fine">
            寄信管道：<b className={mailEnabled() ? "tone-ok" : "tone-fail"}>{mailTransportLabel()}</b>
            {newsleopardEnabled()
              ? "（感謝信、發票通知走電子豹；每日備份因為帶附件一律走 SMTP）"
              : "（設了 NEWSLEOPARD_API_KEY 與 NEWSLEOPARD_FROM 就會改走電子豹）"}
            <br />
            金流與發票現在跑在哪個環境，看<Link href="/admin/settings/pay">設定・金流</Link>最上面那張表。
            <br />
            後台登入密碼由環境變數 ADMIN_PASSWORD 控制，資料庫是 SQLite（data/site.db），兩者都不在後台裡改。
          </p>
          {/* 出貨夥伴改到專屬管理頁（多夥伴版）：一人一把金鑰、一組密碼、一份通知名單 */}
          <div className="ad-note">
            <b>出貨夥伴工作台</b>
            <p className="fine">
              每位夥伴有自己的連結與密碼，只看得到自己商品的訂單。
              連結、通知信箱、停用啟用都在<Link href="/admin/partners">夥伴管理</Link>。
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
