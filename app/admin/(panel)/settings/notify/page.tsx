import type { Metadata } from "next";
import Link from "next/link";
import { Fragment } from "react";
import { getSetting } from "@/lib/db";
import { saveSettings } from "@/app/admin/actions";
import { COPY_EVENTS, copyDefault, copyIsCustom, type CopyField } from "@/lib/notify-copy";
import NotifyCopyCard from "@/components/admin/NotifyCopyCard";
import MultiInput from "@/components/MultiInput";
import Switch from "@/components/admin/Switch";
import StickySave from "@/components/admin/StickySave";
import SettingsHead from "@/components/admin/SettingsHead";
import { requireAdmin } from "@/lib/admin-guard";

export const metadata: Metadata = { title: "設定・通知" };

const FIELDS: CopyField[] = ["subject", "p1", "btn", "btn2", "line", "sms"];
const COPY_GROUPS = ["商品訂單", "贊助"] as const;

/*
 * 設定・通知（ia.md §2）：舊頁的「自動提醒」「信件副本」「LINE 推播」，
 * 加上原本自己一頁的「通知文案」。畫布 SettingsPhone/SettingsDesktop 就是照這一頁畫的。
 *
 * 通知文案原本有自己的 action（saveNotifyCopy），這裡併進同一顆儲存：
 * 「這一頁一顆儲存」是站長訂的規則，兩個表單就會出現兩條黏底列、兩個未儲存計數，
 * 站長按了上面那顆會以為下面也存了。saveSettings 對 ncopy_ 開頭的欄位沿用同一條規則
 * （表單裡沒有那一格就不動），行為跟原本完全一樣。
 *
 * 桌機分兩欄（四段以上才分）：左邊提醒與副本，右邊 LINE 與文案。
 */
export default async function SettingsNotify({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string }>;
}) {
  await requireAdmin();
  const { saved } = await searchParams;

  /*
   * 兩格都空＝有人下單也沒有任何人會知道（2026-09-07）。
   *
   * 站長把自己的信箱填在「站長通知信箱」，以為訂單通知會寄過來，結果那時候訂單通知
   * 只讀「商品訂購通知信箱」。程式已改成兩格聯集，這裡再補一句警告，
   * 讓「兩格都空」這種真的沒人收的狀態在頁面上看得見，不用等到漏掉一張單才發現。
   */
  const hasAddr = (k: string) => getSetting(k, "").split(/[,，;\s]+/).some((t) => t.trim().includes("@"));
  const noNotifyAddr = !hasAddr("notify_emails") && !hasAddr("owner_notify_emails");

  /* 每一格：站長自己改過的才帶值，沒改過留空，placeholder 顯示預設，一眼看出哪些是預設 */
  const cards = COPY_EVENTS.map((ev) => {
    const custom = {} as Record<CopyField, string>;
    for (const f of FIELDS) custom[f] = copyIsCustom(ev.key, f) ? getSetting(`ncopy_${ev.key}_${f}`, "").trim() : "";
    return { ...ev, defaults: copyDefault(ev.key), custom };
  });

  return (
    <>
      <SettingsHead name="通 知" title="設 定 ・ 通 知" sub="提醒節奏、副本、LINE、文案" />
      {saved && <p className="msg-ok">已儲存，之後寄出的通知立即生效。</p>}
      {noNotifyAddr && (
        <p className="msg-err">
          下面兩格通知信箱都是空的：現在有人下單也不會有任何人收到通知。
          填一格就夠（訂單通知兩格都會收到），存好之後到設定・系統按「寄測試信」確認收得到。
        </p>
      )}

      <form className="adm-form ad-set wide" action={saveSettings}>
        <input type="hidden" name="_back" value="/admin/settings/notify" />

        <div className="ad-2col">
          <div className="col">
            <div className="ad-part">
              {/* 誰會收到通知：從商店頁搬過來（2026-09-05），這兩個信箱管的是通知，不是商店 */}
              <div className="ad-sect"><h2>通 知 信 箱</h2><div className="rule" /></div>
                <div className="sw-list">
                  <Switch
                    name="notify_all_products"
                    label="整間商店只要有人下單就通知我"
                    hint="勾選＝任何商品被買都寄一封到下面的信箱（建議保持勾選）。取消勾選＝退回舊模式，只通知在商品管理勾了「購買通知」的那幾樣。夥伴的通知不受這個開關影響，他們一律只收到自己商品的單。"
                    defaultChecked={getSetting("notify_all_products", "1") === "1"}
                  />
                </div>
                <div className="field">
                  <label>商品訂購通知信箱（有人訂購就寄到這裡，全部商品的單都看得到，只收訂單通知。要一起收投稿、贊助那些通知的話，填下面那格就好，訂單通知兩格都會收到，同一個信箱填兩格也只會收到一封。出貨夥伴的通知不要填這裡，到「夥伴出貨 → 夥伴管理」設定，夥伴只會收到自己商品的單；一格一個，按＋新增）</label>
                  <MultiInput name="notify_emails" sans defaultValues={getSetting("notify_emails", "").split(",").map((t) => t.trim()).filter(Boolean)} placeholder="例如：倉庫夥伴@gmail.com" />
                </div>
                <div className="field">
                  <label>站長通知信箱（你自己的信箱：有人訂購一樣會寄到這裡，另外還收投稿、贊助、備份這些「商品以外」的通知。只想收訂單就填上面那格；一格一個，按＋新增）</label>
                  <MultiInput name="owner_notify_emails" sans defaultValues={getSetting("owner_notify_emails", "").split(",").map((t) => t.trim()).filter(Boolean)} placeholder="例如：你自己的@gmail.com" />
                  <p className="fine">
                    兩個信箱填好存起來之後，到<Link href="/admin/settings/system">設定・系統</Link>按「寄測試信」確認真的收得到。
                  </p>
                </div>
            </div>
            <div className="ad-part">
              <div className="ad-sect"><h2>自 動 提 醒</h2><div className="rule" /></div>
              <div className="sw-list">
                <Switch name="notify_pause" label="暫停所有自動提醒" hint="出國、系統有狀況時開。開著時待付款提醒、失敗通知、扣款失敗通知一律不寄，後台每頁會提示。" defaultChecked={getSetting("notify_pause", "0") === "1"} />
                <Switch name="notify_dry_run" label="只記錄不寄（上線第一天用）" hint="開著時系統照規則算「本來會寄給誰」記在提醒中心，但一封都不寄、次數也不推進；看過沒問題再關掉。" defaultChecked={getSetting("notify_dry_run", "0") === "1"} />
              </div>
              <p className="fine">節奏：下單後 10 分、12 小時、24 小時各提醒一次，48 小時判失敗；有綁 LINE 走信＋LINE，沒綁走信＋簡訊；晚上 10 點到早上 8 點的 LINE 與簡訊延到早上 8 點。細節見 docs/notify-spec.md。</p>
            </div>

            <div className="ad-part">
              <div className="ad-sect"><h2>信 件 副 本</h2><div className="rule" /></div>
              <p className="fine">
                填了信箱，系統寄出去的信就會暗中多寄一份給它，客人看不到。留空就整個不副本。
                手寫信一次寄多人只會收到一封總副本，最上面列出寄給了誰。每封寄過的信另外都有紀錄，在「發送」頁最下面。
              </p>
              <div className="field">
                <label>副本信箱</label>
                <input type="email" name="mail_copy_to" className="sans" defaultValue={getSetting("mail_copy_to", "")} placeholder="hi@wensong.tw" inputMode="email" autoComplete="off" />
              </div>
              <div className="sw-list">
                <Switch name="mail_copy_manual" label="手寫信" hint="發送頁寫的信。" defaultChecked={getSetting("mail_copy_manual", "1") === "1"} />
                <Switch name="mail_copy_remind" label="提醒與失敗通知" hint="待付款提醒、付款失敗、扣款失敗。" defaultChecked={getSetting("mail_copy_remind", "1") === "1"} />
                <Switch name="mail_copy_routine" label="客人例行信" hint="訂單成立、付款完成、ATM 帳號、出貨、贊助感謝。一張訂單三四封，開了收件匣會很吵。" defaultChecked={getSetting("mail_copy_routine", "0") === "1"} />
                <Switch name="mail_copy_owner" label="站長通知" hint="投稿、有人下單、發票失敗這類本來就寄給你的信，通常不用再多一份。" defaultChecked={getSetting("mail_copy_owner", "0") === "1"} />
              </div>
            </div>
          </div>

          <div className="col">
            <div className="ad-part">
              <div className="ad-sect"><h2>L I N E 推 播</h2><div className="rule" /></div>
              {/* 兩個開關併成一個 sw-list。不包在 .field 裡：.field label 的字距與底邊距會蓋到開關列 */}
              <div className="sw-list">
                <Switch
                  name="line_notify_on"
                  label="開啟 LINE 通知（結帳勾選、感謝頁與信件的綁定入口、會員中心、推播）"
                  hint="關著的時候客人完全看不到 LINE 相關的東西，通知維持 Email 加簡訊；串接與測試都完成再打開。webhook 與金鑰不受這格影響。"
                  defaultChecked={getSetting("line_notify_on", "0") === "1"}
                />
                <Switch
                  name="line_collect_email"
                  label="LINE 登入時同時索取 Email"
                  hint="開著：登入 LINE 會一併要 Email（LINE 那邊的 Email 權限審核過才拿得到），有 Email 會員中心才對得到訂單。沒拿到的人只能從訂單確認信裡的綁定連結進來，系統會用那張訂單的 Email。會員自己填 Email 的功能已拿掉（任何人都能填別人的）。關掉就完全不問。"
                  defaultChecked={getSetting("line_collect_email", "1") === "1"}
                />
              </div>
              <div className="field">
                <label>LINE 每月額度（則）</label>
                <input className="sans" type="number" name="line_quota_monthly" min={0} defaultValue={getSetting("line_quota_monthly", "200")} />
                <p className="fine">
                  你在 LINE 官方帳號買的方案額度（輕用量 200、中用量 3,000、高用量 6,000）。系統看不到 LINE 那邊，升級後記得來改。
                  到 75% 會寄信提醒你，到 100% 自動改走簡訊與 Email。
                </p>
              </div>
              <div className="field">
                <label>LINE 只推給這些 userId（測試用）</label>
                <MultiInput name="line_test_user_ids" sans defaultValues={getSetting("line_test_user_ids", "").split(",").map((t) => t.trim()).filter(Boolean)} placeholder="Uxxxxxxxx（自己綁定後在會員名單頁看得到）" />
                <p className="fine">
                  有填的時候是<b>測試模式</b>：只推給名單內的人，其他人照常走 Email 與簡訊，後台每頁會顯示提醒。測完清空這格就是正式上線。
                </p>
              </div>
            </div>

            <div className="ad-part">
              <div className="ad-sect"><h2>通 知 文 案</h2><div className="rule" /></div>
              <p className="fine">
                每一則通知一張卡：主旨、第一段、按鈕文字、LINE、簡訊。留空＝用預設（灰字就是預設內容）。
                變數用中文大括號，按文字框下面的按鈕就會插到游標處；下面的預覽會用範例資料即時代入。
                共 {COPY_EVENTS.length} 則。
              </p>
              {COPY_GROUPS.map((g) => (
                <Fragment key={g}>
                  <h3 className="f">{g}</h3>
                  {cards.filter((c) => c.group === g).map((c) => (
                    <NotifyCopyCard key={c.key} event={c.key} label={c.label} hasSms={c.hasSms} defaults={c.defaults} initial={c.custom} />
                  ))}
                </Fragment>
              ))}
            </div>
          </div>
        </div>

        <StickySave />
      </form>
    </>
  );
}
