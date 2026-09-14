# 支持方案 v3 規格：純數位商品

觸發指令：**「製作新版贊助系統」**。收到這句話開這份，不是 v2。

本文件是規格，不是已完成的功能。動工前先確認資料表現況，schema 可能已經變了。

## 這一版與 v2 的關係

`docs/sponsor-system-v2.md` 那套四級距權益（折扣券、免運券、選題投票、繪本紙本）**暫緩施工**，站長另外設計後送金流審查。v2 檔案保留備查，但不要照它動工。

這一版只做一件事：**付款成功就交付一份桌布集下載**。沒有級距、沒有券、沒有紙本、沒有投票。

降級掉的不只是工，還有一個沒解的稅務問題。v2 最後留著「折扣券讓性質偏向預付消費，發票品名與稅務認列跟純贊助不同，要問記帳人員」。純數位商品沒有這個問題，發票品名維持現在的「數位內容服務」就對得起來，不必問人。

---

## 一、現況盤點（動工前的事實，全部實際查過）

1. **交付其實已經在跑了。** 感謝頁 `app/support/thanks/page.tsx:102` 和感謝信 `lib/mail.ts:403` 都有一顆下載按鈕，指向 `/downloads/doudzao-wallpapers.zip`（884KB，2026-08-04 放上去的豆棗手繪桌布集）。
2. **但那個檔是全公開的。** 它躺在 `public/downloads/` 底下，任何人知道網址就下載得到，不必付一毛錢，搜尋引擎也可能索引到。
3. **使用條款已經承諾了專屬性。** `lib/terms-support-v1.ts` 第八條第 3 款白紙黑字寫「提供支持者**專屬**之數位圖像（桌布集）下載」。以現況來說，這句話是不成立的。
4. **發票品名不用改。** `lib/amego.ts:64` 的註解寫得很清楚：發票品名寫交易標的而不是付款動機，現在是「數位內容服務」。第八條第 1 款也已把支持方案定性為數位內容服務之銷售。
5. **入帳確認的呼叫點有七處**：`app/support/actions.ts:169`、`app/api/ecpay/return/route.ts:75`、`app/api/ecpay/period/route.ts:50`、`app/api/linepay/confirm/route.ts:94`、`app/api/portaly/callback/route.ts:68`、`lib/payment-sync.ts:504`、`lib/reconcile.ts:108`。續期扣款另有 `lib/recurring.ts:62` 與 `app/api/ecpay/period/route.ts:65`。
6. `/support/plan` 仍在公開承諾四級距權益，底下沒有任何系統支撐。

**所以這一版的核心工程不是「新增交付」，是「把已經在承諾的交付變成真的」。**

---

## 二、只解三個問題

1. **專屬性**：沒付錢的人不該拿得到
2. **可換檔**：站長之後畫了新桌布要能換，不必改程式、不必重新部署
3. **月繳每期都要有**：條款寫「每月提供」，那就每期都要真的發

---

## 三、資料模型

### 新增 `download_grants`

| 欄位 | 說明 |
|---|---|
| `id` | |
| `token` | 32 字元隨機（`crypto.randomBytes(16).toString("hex")`），唯一，網址就是它 |
| `sponsorship_id` | 來源支持 |
| `charge_id` | 第幾期（單筆與月繳首期為 0，續期填 `sponsor_charges.id`） |
| `email` | 發放當下的信箱，全部轉小寫存，只為了後台查找與重寄 |
| `asset` | 檔名，對應 `data/downloads/` 底下那一份 |
| `issued_at` / `expires_at` | 發放日與到期日（發放日 +180 天） |
| `hits` | 已下載次數 |
| `last_at` | 最後一次下載時間 |

**`UNIQUE(sponsorship_id, charge_id)`**。這條是防重複的關鍵：金流回呼、redirect 補查、對帳排程三條路都可能對同一筆重跑，沒有唯一鍵就會發出三個網址。發放函式用 `INSERT ... ON CONFLICT DO NOTHING` 再讀回既有那筆，重跑必定拿到同一個 token。這是 v2 就寫過的教訓，照抄。

### 檔案放哪

**從 `public/downloads/` 搬到 `data/downloads/`。**

理由是 `public/` 底下的東西 Next 會當靜態資產直接送出，擋不住。`data/` 在 Zeabur 是掛載的 volume，程式碼碰得到、外界碰不到，而且站長換檔不必動 git。

上傳沿用現成機制：後台圖片上傳 `/api/admin/upload` 寫的就是 `DATA_DIR/images`，桌布照同一套寫 `DATA_DIR/downloads` 即可。

**備份要一起改。** `lib/backup.ts:89` 現在只把 `site.db` 和 `images` 打進 tar，不改的話主機掛掉桌布檔就沒了。tar 參數加 `downloads`，體積判斷 `tooBig` 那行也要把它算進去。

---

## 四、發放：寫在哪一層

**絕對不要寫在那七個呼叫端。** 漏一個就是有人付了錢拿不到東西，而且是靜悄悄地漏。

開 `lib/downloads.ts`，對外一支 `grantDownload(sponsorshipId, chargeId = 0): string`（回傳 token），由**寄信函式的內部**呼叫：

- `sendSponsorThanksMail()` 開頭呼叫 `grantDownload(sp.id, 0)`
- `sendSponsorChargedMail()` 開頭呼叫 `grantDownload(sp.id, chargeId)`

這兩支是七個入口最後都會匯流過去的地方，塞在這裡就自動全涵蓋，日後再接新金流也不會漏。代價是 `sendSponsorChargedMail` 的參數要多帶 `chargeId`（呼叫端兩處要補），這是划算的。

信裡的按鈕網址從寫死的 zip 改成 `${siteUrl()}/d/${token}`。

感謝頁的處理：`/support/thanks` 拿得到 `sid` 與 `t`（失敗救援已經在用這組參數），有效就查 grant 顯示下載按鈕，查不到就改顯示「下載連結已寄到你的信箱」，不要留一顆按不動的按鈕。ATM 轉帳當下還沒入帳，走的本來就是這條路。

---

## 五、下載端點 `/d/[token]`

| 情況 | 回應 |
|---|---|
| token 不存在 | 404 |
| 已過期 | 410，導向 `/support/download-help` 說明可來信重寄 |
| `hits` 超過 20 | 同上說明頁 |
| 正常 | 串流檔案，`Content-Disposition: attachment`，`Cache-Control: private, no-store`，`hits+1`、寫 `last_at` |

- 效期 **180 天**、次數上限 **20 次**。上限給得寬是因為換手機重下很正常，它要擋的是連結被整串貼到論壇，不是擋支持者本人。
- `/d/` 要 `noindex`，`robots.txt` 也 disallow，否則爬蟲逛一輪就把次數吃光。
- 讀檔用非同步（`fsp.readFile` 或 stream）。`/api/images/[name]/route.ts` 的註解已經記過這個教訓：同步讀檔會把 Node 唯一那條執行緒卡住整個讀檔時間，電子報一發幾百人同進來，卡住的不只是圖片，是同一時間所有人的結帳與贊助請求。

---

## 六、後台

- 支持者列表加一欄「下載」，顯示已發／已下載次數／到期日
- 一顆「重寄下載連結」按鈕。**重寄是寄同一個 token，不是發新的**，否則舊信裡的連結就死了
- 網站設定加一個「當期桌布檔」選單，列出 `data/downloads/` 底下的檔案供選，新發的 grant 用選中那份。已發出去的不受影響，各自綁自己的 `asset`

---

## 七、舊網址怎麼收尾

`/downloads/doudzao-wallpapers.zip` 這個網址已經寄進既有支持者的信箱了，檔案直接刪掉會讓那些信變成死連結。

做法：檔案搬走，`next.config.ts` 加一條 redirect 把這個路徑導去 `/support/download-help`，該頁說明「請改用信中的個人下載連結，或來信索取」。要更周到的話，後台批次對既有支持者重寄一次新連結，但那是加分項不是必要項。

---

## 八、明確不做

折扣券、免運券、選題投票權、繪本紙本、會員綁定、月繳預發整年、金額級距差異化。全部留給站長另外設計的送審版本。

不做的意思是連資料表都不要先開。先開了沒用到的欄位，下一個人接手會以為那是壞掉的功能。

---

## 九、待決（動工前要站長回答）

1. **`/support/plan` 怎麼辦。** 那頁公開承諾四級距權益，底下沒有系統。三選一：維持現狀／改寫成數位商品說明／暫時下架。站長 2026-08-27 指示「現有的頂著用就好」，所以本版不動它，但這是已知風險，而且金流審查很可能會看這一頁。
2. **桌布要不要分級**（888 以上給不同張數）。本版預設不分，所有成功入帳拿同一份。
3. **效期 180 天／上限 20 次**是我先給的預設值，要不要改。
4. **月繳續期發新 token 還是延長舊的**。本版預設發新，帳目清楚，也才對得起條款寫的「每月提供」。

---

## 十、施工順序與驗收

分三批推，每批推完先驗再往下：

1. **批次一**：`download_grants` 表＋`lib/downloads.ts`＋`/d/[token]` 端點。此時還沒人用得到，零風險。
2. **批次二**：兩支寄信函式接上發放，感謝頁改條件式按鈕，檔案搬進 `data/downloads/`，備份 tar 加 `downloads`。
3. **批次三**：後台欄位與重寄按鈕，舊網址 redirect，`robots.txt`。

`npm run smoke` 要加的純邏輯測試：token 產生的唯一性、過期判定、次數上限判定、`UNIQUE(sponsorship_id, charge_id)` 重跑不重發。

上線實測（照 AGENTS.md，不要只看 200）：
- 單次付款走完 → 信裡的連結真的下載得到檔案
- 同一筆重跑對帳 → 不會產生第二個 token
- 亂打一組 token → 404；手動把 `expires_at` 改到過去 → 410
- 舊網址 `/downloads/doudzao-wallpapers.zip` → 導到說明頁
- 月繳續期扣款 → 收到的是新連結

相關：[[tappay-integration-plan]]、`docs/sponsor-system-v2.md`（暫緩）
