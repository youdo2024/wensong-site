<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# 問爽的官網：工作手冊（2026-09-14 從佑在幹嘛官網 fork）

## 這個站是什麼
- 《問爽的 WenSong》Podcast 官網，wensong.tw。維尼與安妮主持，於悅商行營運。
- 決策定案與架構盤點在 iCloud `AI資料庫/其他開發/問爽的/`，動工前先讀那兩份。
- fork 來源：youdo2024/youdoyou-site @ b6351de。骨架沿用（Next 16 App Router + better-sqlite3 + Zeabur），內容模組全部換掉。

## 站點與部署
- 正式站 www.wensong.tw（裸網域 301 到 www），Zeabur 部署：push 到 main 即觸發，約 3 到 6 分鐘。
- 部署驗證打 `/api/version`，`commit` 對上剛推的 sha 才算上了，不要只看 200。
- 環境變數在 `.env`（gitignore，永遠不進 repo），完整清單是 `.env.example`。站長自己貼進 Zeabur，Claude 不經手密碼與金鑰。
- 資料庫 SQLite `data/site.db`（gitignore）。schema 在 `lib/db.ts`，只有 CREATE TABLE、預設設定與捐贈碼種子，**內容一律走後台，不寫遷移灌內容**。
- 備份 `lib/backup.ts`：台北 4 到 6 點 VACUUM INTO 打包寄到 `owner_notify_emails`（預設 hi@wensong.tw）。

## 集數與來賓（這個站的核心）
- 集數來源永遠是 SoundOn RSS（`podcast_rss_url` 設定）。`lib/episodes.ts` 負責抓、解析、upsert；每小時醒一次、距上次超過 23 小時才抓；表空的立刻抓。後台「集數」右上角有「立即同步」。
- **分群契約**：RSS 唯讀欄（title、pub_date、duration、audio_*、image、rss_description、rss_link）每次同步覆蓋；手動欄（key、series、ep_no、short_title、summary、notes、transcript、chapters、tags、seo_title、slug_alias、published、sort、cover）只在第一次匯入給預設值。改 upsert 時不准把手動欄放進 UPDATE。
- 網址 `/ep/<key>`：正篇 `23`、投稿 `submit-03`、試播 `0`。`slug_alias` 是英文別名，301 到主網址。
- 來賓 `/guests/<slug>`：同步時從標題 `feat.` 自動建（slug `guest-N`，只有名字），站長在後台補頭銜、簡介、照片、連結，並改成英文 slug。
- 逐字稿存 `episodes.transcript`（Markdown），前台收合顯示並固定標「AI 辨識可能有錯字」。回填流程（第 2 段）：本機 WhisperX 分講者 → Claude Code 輕校對 → 貼後台。

## 站長模式
- 商店、支持、電子報三塊做完但鎖住：`shop_enabled=0`（帶 `shop_preview_key` 的連結才看得到）、`support_mode=off`、`newsletter_block=0`。第 3 段接藍新後才開。
- 藍新（NewebPay）幕前支付 MPG 已串（`lib/newebpay.ts`）：`shop_gateway="newebpay"` 時商店走藍新（信用卡／ATM），
  贊助單筆在綠界沒開、藍新有金鑰時自動優先於 Portaly／PayUni。信用卡定期定額也已串（`lib/newebpay-period.ts`），
  後台設定・贊助的 `monthly_gateway` 選 `newebpay` 時，長期支持在站內走藍新每月扣款，選 `portaly` 才外連。
  沒有測試金鑰跑過，正式收款前照 `docs/newebpay-spec.md` 的清單用測試金鑰驗過一輪再開。綠界／PayUni／TapPay／LINE Pay 程式保留但不設金鑰。

## 開發與測試
- `npm run smoke`：純邏輯測試，改完必跑。`npm run build` 過了才准推。
- 測試資料測完必清。不准改測試遷就結果。不准讓系統停止或崩潰。
- iCloud 會生「* 2.ts」重複檔弄壞 tsc：`find .next -name "* [0-9].*" -delete`。本機 rm -rf .next 前先關 dev server。
- 換 Node 版本後 `npm rebuild better-sqlite3`（只影響本機）。

## 品牌與樣式
- 品牌常數只在 `lib/brand.ts`（站名、法人、統編、地址、信箱、主持人預設、RSS）。會變的（社群、平台連結、主持人照片）在 settings，後台「設定・內容」改。
- 色票與字體規範在 `BRAND.md`。`app/globals.css` 是佑在幹嘛留下的骨架（舊變數名 --rice 等指向新色）；**問爽的專屬樣式一律寫在 `app/podcast.css`**，不再往 globals.css 堆。
- 文案：不用破折號（——），少用分號，手動換行斷在標點後面，數字用阿拉伯數字。

## 已知限制
- 集數頁與文章頁是 force-dynamic，不是 ISR：這版 Next 正式模式下 `revalidate` 頁會因 layout 讀 cookie 炸 DYNAMIC_SERVER_USAGE（2026-09-14 實測 500）。要 ISR 得先把 layout 的 `shopViewable()` 改成不讀 cookie。
- 藍新已串（第 3 段，程式完整但沒有測試金鑰跑過，見 `docs/newebpay-spec.md`）。`/business-model` 與 `/corrections` 的內文還是佑在幹嘛口吻換品牌名，第 3 段送審前重寫。
- 後台帳號制（第 2 段，2026-09-14 完成）：設任何一個 `ADMIN_USER_1..3`（格式 `帳號|顯示名|scrypt$salt$hash`，雜湊用 `lib/admin-users.ts` 的 `hashPassword()` 產生）就整站切成 3 人各自登入；三個都沒設維持舊的 `ADMIN_PASSWORD` 單一密碼。修改記錄在 `/admin/log`（`admin_log` 表，寫入端 `lib/admin-log.ts`）。

## 其他
- 圖片派生 `/api/images?w=480|768|1200|1600`（AVIF/WebP），原圖永不改動。
- CSP 目前 Report-Only，Zeabur logs 搜 [csp]。SoundOn 的 `*.soundon.fm` 已放進 img/media 白名單。
- 頁面瀏覽白名單在 `app/api/pv/route.ts`（home、episodes、guests、articles、support、shop）。
