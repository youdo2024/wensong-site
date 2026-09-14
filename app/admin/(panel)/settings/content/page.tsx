import type { Metadata } from "next";
import { Fragment } from "react";
import { getSetting } from "@/lib/db";
import { saveSettings } from "@/app/admin/actions";
import { COPY_GROUPS, t } from "@/lib/copy";
import StickySave from "@/components/admin/StickySave";
import SettingsHead from "@/components/admin/SettingsHead";
import { requireAdmin } from "@/lib/admin-guard";
import ImagePicker from "@/components/ImagePicker";
import Switch from "@/components/admin/Switch";
import { BRAND } from "@/lib/brand";

export const metadata: Metadata = { title: "設定・內容" };

/*
 * 設定・內容（ia.md §2）：舊頁的「社群連結」「隱私權」「使用條款」「退換貨政策」
 * 「投稿條款」，加上原本自己一頁的「文案信件」。
 *
 * 文案信件併進同一顆儲存，理由跟通知頁一樣：一頁一顆儲存是站長訂的規則。
 * saveSettings 對 copy_ 開頭的欄位沿用 saveCopy 原本那條規則（清空＝回復預設，
 * 表單裡沒有那一格就完全不動），行為沒有變。
 *
 * 版面單欄：四段以上照規格要分兩欄，但這一頁全是整片的條款文字框與
 * 文案信件自己的兩欄格線，塞進半欄只會把每一行擠成十個字。
 */
export default async function SettingsContent({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string }>;
}) {
  await requireAdmin();
  const { saved } = await searchParams;
  const copyCount = COPY_GROUPS.reduce((s, g) => s + g.items.length, 0);

  return (
    <>
      <SettingsHead name="內 容" title="設 定 ・ 內 容" sub="節目連結、主持人、社群連結、法務頁，以及前台每一句話與每一封信的文字" />
      {saved && <p className="msg-ok">已儲存，前台與之後寄出的信件立即生效。</p>}

      <form className="adm-form ad-set" action={saveSettings}>
        <input type="hidden" name="_back" value="/admin/settings/content" />

        <div className="ad-part">
          <div className="ad-sect"><h2>社 群 連 結</h2><div className="rule" /></div>
          <p className="fine">右側懸浮鈕與頁尾用這三條。留空那一個就不出現。</p>
          <div className="adm-3col">
            <div className="field">
              <label>Facebook</label>
              <input className="sans" type="url" name="social_fb" defaultValue={getSetting("social_fb", "")} />
            </div>
            <div className="field">
              <label>Instagram</label>
              <input className="sans" type="url" name="social_ig" defaultValue={getSetting("social_ig", "")} />
            </div>
            <div className="field">
              <label>YouTube</label>
              <input className="sans" type="url" name="social_yt" defaultValue={getSetting("social_yt", "")} />
            </div>
          </div>
        </div>

        <div className="ad-part">
          <div className="ad-sect"><h2>隱 私 權 保 護</h2><div className="rule" /></div>
          <p className="fine">前台 /privacy。</p>
          <div className="field">
            <textarea className="code ta-l" name="privacy_md" defaultValue={getSetting("privacy_md", "")} />
          </div>
        </div>

        <div className="ad-part">
          <div className="ad-sect"><h2>使 用 條 款</h2><div className="rule" /></div>
          <p className="fine">前台 /terms。</p>
          <div className="field">
            <textarea className="code ta-l" name="terms_md" defaultValue={getSetting("terms_md", "")} />
          </div>
        </div>

        <div className="ad-part">
          <div className="ad-sect"><h2>退 換 貨 與 退 款 政 策</h2><div className="rule" /></div>
          <p className="fine">前台 /returns。金流審查會看這一頁。</p>
          <div className="field">
            <textarea className="code ta-l" name="returns_md" defaultValue={getSetting("returns_md", "")} />
          </div>
        </div>

        <div className="ad-part">
          <div className="ad-sect"><h2>節 目 連 結</h2><div className="rule" /></div>
          <p className="fine">RSS 是集數的來源，每天自動同步一次；收聽平台留空的那個前台就不出現。</p>
          <div className="field">
            <label>Podcast RSS 網址（SoundOn 給的那條）</label>
            <input className="sans" type="url" name="podcast_rss_url" defaultValue={getSetting("podcast_rss_url", BRAND.rssUrl)} />
          </div>
          <div className="adm-3col">
            <div className="field"><label>Apple Podcasts</label><input className="sans" type="url" name="platform_apple" defaultValue={getSetting("platform_apple", "")} /></div>
            <div className="field"><label>Spotify</label><input className="sans" type="url" name="platform_spotify" defaultValue={getSetting("platform_spotify", "")} /></div>
            <div className="field"><label>KKBOX</label><input className="sans" type="url" name="platform_kkbox" defaultValue={getSetting("platform_kkbox", "")} /></div>
            <div className="field"><label>YouTube</label><input className="sans" type="url" name="platform_youtube" defaultValue={getSetting("platform_youtube", "")} /></div>
            <div className="field"><label>SoundOn</label><input className="sans" type="url" name="platform_soundon" defaultValue={getSetting("platform_soundon", BRAND.soundonLink)} /></div>
          </div>
          <div className="sw-list">
            <Switch name="newsletter_block" label="首頁顯示電子報訂閱區塊" hint="站長模式先關；開了首頁最下面會多一格 Email 訂閱" defaultChecked={getSetting("newsletter_block", "0") === "1"} />
          </div>
        </div>

        <div className="ad-part">
          <div className="ad-sect"><h2>主 持 人</h2><div className="rule" /></div>
          <p className="fine">首頁主持人區與關於頁用這兩組。照片建議正方形。</p>
          {[1, 2].map((n) => (
            <div className="adm-2col" key={n} style={{ marginBottom: 18 }}>
              <div className="field"><label>主持人 {n}：名字</label><input type="text" name={`host_${n}_name`} defaultValue={getSetting(`host_${n}_name`, BRAND.hosts[n - 1].name)} /></div>
              <div className="field"><label>頭銜或店家</label><input type="text" name={`host_${n}_title`} defaultValue={getSetting(`host_${n}_title`, BRAND.hosts[n - 1].title)} /></div>
              <div className="field full"><label>一段簡介</label><textarea className="ta-s" name={`host_${n}_intro`} defaultValue={getSetting(`host_${n}_intro`, BRAND.hosts[n - 1].intro)} /></div>
              <div className="field"><label>連結（Instagram、linktree 都可以）</label><input className="sans" type="url" name={`host_${n}_link`} defaultValue={getSetting(`host_${n}_link`, BRAND.hosts[n - 1].link)} /></div>
              <ImagePicker name={`host_${n}_photo`} label="照片" value={getSetting(`host_${n}_photo`, "")} height={120} />
            </div>
          ))}
        </div>

        <div className="ad-part">
          <div className="ad-sect"><h2>文 案 信 件</h2><div className="rule" /></div>
          <p className="fine">
            前台每一句話與每一種信件的文字都在這裡，共 {copyCount} 條。清空欄位＝回復預設文案。【】包住的字前台會以紅色強調。
            信件主旨與動態內容（姓名、金額、訂單編號）由系統自動帶入，不在此修改。
            改完信件文案可以到<span className="sans"> 設定・系統 </span>按「寄範本測試信」看實際長相。
          </p>
          {COPY_GROUPS.map((g) => (
            <Fragment key={g.title}>
              <h3 className="f">{g.title}</h3>
              <div className="adm-2col">
                {g.items.map((item) => (
                  <div className={`field${item.kind === "textarea" ? " full" : ""}`} key={item.key}>
                    <label>
                      {item.label}
                      {item.hint && <em>（{item.hint}）</em>}
                    </label>
                    {item.kind === "textarea" ? (
                      <textarea className="ta-s" name={`copy_${item.key}`} defaultValue={t(item.key)} placeholder={item.def} />
                    ) : (
                      <input type="text" name={`copy_${item.key}`} defaultValue={t(item.key)} placeholder={item.def} />
                    )}
                  </div>
                ))}
              </div>
            </Fragment>
          ))}
        </div>

        <StickySave />
      </form>
    </>
  );
}
