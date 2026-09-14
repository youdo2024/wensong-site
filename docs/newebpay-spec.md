# 藍新金流（NewebPay）串接說明

第 3 段：讓商店訂單與單筆贊助能用信用卡、ATM 虛擬帳號付款。設定 `shop_gateway="newebpay"`
時商店走藍新；贊助則是「綠界沒開、藍新有金鑰」時自動優先於 Portaly／PayUni（比照綠界原本
的優先序寫法，見 `app/support/actions.ts`）。

沒有藍新的測試金鑰，所以這次施工的驗收標準是：

- 程式完整（表單組裝、回呼解析、對帳查詢都寫好，接進商店與贊助兩條結帳路）
- 加密與簽章有單元測試（`tests/smoke.ts`，自己造一組合法長度的假金鑰做來回測試）
- 環境變數留空時 `newebpayEnabled()` 為 false，全站藍新相關程式安靜不動，不影響其他金流

## 流程圖

```
                    顧客結帳（商店 /api/orders 或贊助 /support/pay/[id]）
                              │
                    buildMpgForm({...}) 組出 MerchantID／TradeInfo／TradeSha／Version
                              │ 存 MerchantOrderNo 進 orders.trade_no／sponsorships.trade_no
                              ▼
                    自動 POST 到藍新 MPG（ccore／core.newebpay.com/MPG/mpg_gateway）
                              │
              ┌───────────────┼────────────────────┐
              │ 信用卡（即時）  │ ATM（取號）           │ 失敗／取消
              ▼               ▼                     │
      ReturnURL（瀏覽器跳回）  CustomerURL（瀏覽器跳回） │
      /api/newebpay/return    /api/newebpay/atm       │
      只負責導頁，不寫入        寫入 ATM 代碼＋寄信，       │
      付款結果                導感謝頁看代碼（pending）    │
              │               │                     │
              └───────┬───────┴─────────────────────┘
                      ▼
            NotifyURL（背景通知，永遠回 200）
            /api/newebpay/notify
            解密驗簽 → 依 WO／WS 前綴分流
              PayTime 有值＝真的入帳 → applyNewebpayOrderResult／
                                        applyNewebpaySponsorResult(paid)
              PaymentType=VACC 且無 PayTime＝只是取號成功 → 補寫 ATM 資訊（冪等）
              Status≠SUCCESS＝失敗 → 標記付款失敗、回補庫存

對帳（lib/reconcile.ts，每 5 分鐘一輪）：
  待付款訂單／贊助 → queryTrade(MerchantOrderNo, 金額) → TradeStatus=1 才算已付款，
  查無或未付款就照原本的提醒／逾期取消流程走。
```

## 每支路由做什麼

| 路徑 | 誰打進來 | 做什麼 |
|---|---|---|
| `lib/newebpay.ts` | 不對外，純函式庫 | `newebpayEnabled()`／`newebpayConfig()`、AES-256-CBC 加解密、TradeSha 簽章與驗證、`buildMpgForm()` 組表單、`parseNotify()` 解回呼、`queryTrade()` 打交易查詢 API。刻意不 import db，`tests/smoke.ts` 才能直接測加解密 |
| `app/api/newebpay/notify` | 藍新伺服器（背景，POST） | 驗簽 → 解密 → 依 `MerchantOrderNo` 前綴（`WO`＝訂單、`WS`＝贊助）分流 → 呼叫 `lib/payment-sync.ts` 的 `applyNewebpay*` 系列。永遠回 200 純文字，未設金鑰／驗簽失敗也一樣回 200，只記 log |
| `app/api/newebpay/return` | 顧客瀏覽器（POST，信用卡即時付款完成跳回） | 只負責導頁：驗簽通過且 `Status=SUCCESS` 導 `/shop/thanks` 或 `/support/thanks`（帶 `pay=paid`），否則帶 `pay=failed`。不寫入任何付款結果，實際入帳交給 notify |
| `app/api/newebpay/atm` | 顧客瀏覽器（POST，ATM 取號完成跳回，即 CustomerURL） | 寫入 `BankCode`／`CodeNo`／`ExpireDate` 到訂單或贊助（`applyNewebpayOrderAtmInfo`／`applyNewebpaySponsorAtmInfo`，寄信），導去感謝頁顯示繳費代碼（`pay=pending`） |
| `lib/payment-sync.ts` 新增 4 支 | 上面三支路由呼叫 | `applyNewebpayOrderResult`／`applyNewebpayOrderAtmInfo`／`applyNewebpaySponsorResult`／`applyNewebpaySponsorAtmInfo`。條件式 UPDATE 搶佔（`WHERE status='pending'`），重複呼叫是安全的；付款成功的贊助統一交給既有的 `settleSponsorOncePaid`（開發票、寄信、通知站長、GA 都在裡面，不另外寫一套） |
| `lib/reconcile.ts` 新增 | 排程（每 5 分鐘） | 待付款訂單／贊助主動查 `queryTrade()`，查到已付款就補入帳；查無或未付款就照原本的提醒／逾期取消流程 |

## MerchantOrderNo 編碼規則

- 訂單：`WO` ＋ 訂單編號（去非英數）。重試時加 `R` ＋ 時間碼（藍新不接受重複編號，比照
  `lib/ecpay.ts` 的 `retryTradeNo`）。還原：`orderNoFromNewebpayMtn()` 剝掉前綴與重試尾碼。
- 贊助：`WS` ＋ 贊助 id ＋ `X` ＋ 時間戳尾 6 碼（`X` 是固定分隔字元，見下方假設 3）。
  還原：`sponsorIdFromNewebpayMtn()` 直接從編號解回 id，**不需要查資料庫**，這點跟綠界的
  贊助單號（另外一張 `sponsor_trade_nos` 歷史表才找得回身分）不同，也是為什麼
  `lib/newebpay.ts` 完全不 import db。

## 上線前要用測試金鑰驗的清單

藍新測試特店金鑰到手後，把 `NEWEBPAY_MERCHANT_ID`／`NEWEBPAY_HASH_KEY`／`NEWEBPAY_HASH_IV`
設進 `.env`、`NEWEBPAY_TEST=1`，後台「設定・金流」切到「藍新金流」，逐項手動驗證：

- [ ] 信用卡成功：商店走一次完整結帳，確認 `/api/newebpay/notify` 收到通知、訂單狀態變
      `paid`、光貿開票、確認信寄出、GA purchase 有送出
- [ ] 信用卡失敗：用會被拒絕的測試卡號，確認導回 `/shop/thanks?pay=failed`，訂單狀態變
      `cancelled`，庫存有回補
- [ ] ATM 取號：選 ATM，確認 `/api/newebpay/atm` 有把代碼寫進訂單、繳費信寄出、感謝頁看得到
      代碼；同時檢查 `/api/newebpay/notify` 是否也會在取號當下打一次（決定假設 2 是否成立）
- [ ] ATM 入帳通知：真的用測試環境的方式讓 ATM 代碼「付款」，確認 notify 這次帶
      `PayTime`、訂單真的變 `paid`
- [ ] 重複通知：同一組 `TradeInfo` 對 notify 重送兩次，確認不會開兩張發票、不會寄兩封信
- [ ] 贊助單筆：`/support` 走一次藍新流程，確認 `sponsorships.trade_no` 寫的是
      `buildMpgForm` 回傳的 `merchantOrderNo`，付款完成後 `settleSponsorOncePaid` 有跑（發
      票、感謝信、站長通知、GA）
- [ ] 對帳補正：手動把一筆訂單／贊助的通知「弄丟」（例如本機開發環境沒有對外網址收不到
      notify），等 `lib/reconcile.ts` 那一輪跑完，確認 `queryTrade()` 把它補上

## 做這次串接時，因為沒有藍新規格書或測試金鑰而自己假設的地方

1. **ATM 繳費期限固定 3 天**（`lib/newebpay.ts` 的 `taipeiExpireDate(3)`）。文件片段沒有寫
   死天數上限，這裡抓一個跟綠界跳轉頁常見說法一致的天數，比對帳判定 ATM 逾期的 4 天窗
   （`FAIL_AFTER_HOURS_ATM`）短，留了緩衝。正式串接時如果藍新後台可以設定天數，以站長設定
   為準，這裡的常數要跟著改。
2. **NotifyURL 在 ATM 取號當下會不會也打一次**：規格片段只寫「ATM 取號成功時 Status 也是
   SUCCESS 但尚未付款，真正入帳由 NotifyURL 再通知一次（PayTime 有值）」，沒有明講取號當
   下那一次是不是也會打 NotifyURL，還是只有 CustomerURL。程式已經把兩支路由都設計成「收到
   ATM 資訊就冪等地寫一次」，所以不管藍新實際上怎麼打，行為都正確；但這是用測試金鑰跑過才
   能徹底確認的地方。
3. **贊助 MerchantOrderNo 用固定分隔字元 `X`**：`WS${id}X${時間戳}`。時間戳是 36 進位，有
   機率以數字開頭，若直接接在 id 後面（`WS57...`），還原 id 時貪婪比對會把時間戳的前幾碼一
   起吃進去（例如 id=57、時間戳 013ABC 會被讀成 id=57013）。這個分隔字元是本次施工自己的設
   計決定，不是藍新規格要求，純粹是我方編號規則的一部分，藍新只會原封不動地把它放在
   `MerchantOrderNo` 裡通知回來。
4. **（2026-09-14 之前的舊假設，已被定期定額取代）** 曾經寫過「藍新沒有定期定額 API，長期
   支持一律不會用藍新」。站長已在藍新開通「信用卡定期定額」，這條假設不成立了，見下面
   「定期定額」一節。這裡留著只是紀錄曾經的判斷，不要照舊字面理解。
5. **NotifyURL／ReturnURL 回應內容**：規格只要求 HTTP 200，沒有規定回應文字格式（不像綠界
   要求 `1|OK`）。三支路由一律回純文字 `OK`（notify）或 303 redirect（return／atm），沒有刻
   意模仿綠界的協定字串。

## 定期定額（信用卡每月扣款，Version 1.5）

站長已在藍新開通「信用卡定期定額」，讓贊助的「長期支持」也能走站內藍新，不必再全部導去
Portaly。後台「設定・贊助」新增 `monthly_gateway`（`portaly` 外連 | `newebpay` 站內定期定
額），只在 `support_mode=hybrid` 時生效；`support_mode=api` 時只要 `newebpayEnabled()` 就
自動走站內定期定額。

```
                贊助頁選「長期支持」，送出 createSponsorship（mode=monthly, provider=newebpay）
                          │ 建 sponsorships（status=pending），導去 /support/pay/[id]
                          ▼
                buildPeriodForm({...}) 組出 MerchantID_／PostData_（Version 1.5）
                          │ 存 MerOrderNo（WP<id>X…）進 trade_no，同時記進單號歷史表
                          ▼
                自動 POST 到藍新（ccore／core.newebpay.com/MPG/period）
                          │
              ┌───────────┴────────────┐
              │ 首期立即扣款（PeriodStartType=2）│
              ▼                         │
      ReturnURL（瀏覽器跳回，只導頁）      │
      /api/newebpay/period/return       │
              │                         │
              └───────────┬─────────────┘
                          ▼
              NotifyURL（背景通知，永遠回 200）
              /api/newebpay/period/notify
              解密 Period 欄位 → MerOrderNo 還原贊助 id（不查資料庫）
                AlreadyTimes<=1（或委託還在 pending）＝首期
                  → settleSponsorOncePaid（開發票、寄感謝信、通知站長、GA）
                  → 另外把 credit_token 存 PeriodNo、trade_no 換成這期的 TradeNo、
                    next_charge_at 設下個月
                AlreadyTimes>1＝續期扣款
                  → sponsor_charges 加一筆、開發票、寄 sendSponsorChargedMail、
                    next_charge_at 往後推一個月
                Status≠SUCCESS＝失敗
                  → 首期失敗：贊助標 failed
                  → 續期失敗：記錄＋lib/remind.ts 的 onMonthlyChargeFailed（藍新自己重試，
                    不是我方發動）

解約（贊助者點確認信裡的取消連結，app/support/cancel/actions.ts）：
  provider=newebpay → 從單號歷史表找回建立委託當初的 MerOrderNo（WP 開頭），
  搭配 credit_token 存的 PeriodNo，打 alterPeriodStatus(merOrderNo, periodNo, "terminate")，
  成功才把 status 改 cancelled。
```

### 每支檔案做什麼（定期定額這條）

| 檔案 | 做什麼 |
|---|---|
| `lib/newebpay-period.ts` | 不對外，純函式庫（跟 `lib/newebpay.ts` 一樣不 import db）。`buildPeriodForm()` 組建立委託的表單、`parsePeriodNotify()` 解 ReturnURL／NotifyURL 收到的 `Period` 欄位、`alterPeriodStatus()` 打解約 API、`newebpayPeriodMtn()`／`sponsorIdFromNewebpayPeriodMtn()`／`isNewebpayPeriodMtn()` 是 MerOrderNo 的編碼與還原 |
| `app/api/newebpay/period/notify/route.ts` | 藍新伺服器（背景，POST）。首期成功交給 `settleSponsorOncePaid`（跟單筆共用同一支唯一實作），續期扣款直接寫 `sponsor_charges`、開發票、寄扣款信；失敗依首期／續期分別處理。永遠回 200 |
| `app/api/newebpay/period/return/route.ts` | 顧客瀏覽器（POST）。只負責導去 `/support/thanks`，不寫入任何結果 |
| `app/support/pay/[id]/page.tsx` | `sp.provider==='newebpay' && sp.mode==='monthly'` 時呼叫 `buildPeriodForm()` 而不是 `buildMpgForm()`，並把 MerOrderNo 記進 `lib/sponsor-trade-no.ts` 的歷史表（解約時要用） |
| `app/support/cancel/actions.ts` | `provider==='newebpay'` 時呼叫 `alterPeriodStatus()` 解約，成功才改本地狀態 |
| `lib/recurring.ts` | `chargeDueSponsorships()` 的 WHERE 子句排除 `provider='newebpay'`：那是 PayUni 舊制「我方主動扣款」的迴圈，藍新委託是它自己每月扣、自己打 NotifyURL，不能由這裡重複扣一次 |
| `lib/reconcile.ts` | `provider='newebpay' && mode='monthly'` 的待付款委託不查詢（規格沒有提供委託狀態查詢 API，只有建立與解約兩支），一律跳過交給 NotifyURL 或使用者放棄 |
| `lib/shop.ts` | `monthlyGateway()`、`monthlyExternalUrl()`（`monthly_gateway=newebpay` 時回空字串） |
| `app/admin/(panel)/settings/sponsor/page.tsx`、`app/admin/actions.ts` | 後台新增 `monthly_gateway` 單選 |

### 做這段時，因為只有站長轉述的規格文字而自己假設的地方

1. **同一份委託每期通知沿用同一組 MerOrderNo**：規格只寫「之後每期扣款藍新會用 NotifyURL
   再送一次（含 AlreadyTimes、AuthTime、TradeNo）」，沒有明講 MerOrderNo 是否每期都一樣。
   這裡假設跟綠界定期定額的實際行為一致（同一個 MerchantTradeNo 用到底，只有 TradeNo／
   Gwsr 每期不同），因為 MerOrderNo 本身帶著贊助 id、藍新原封不動地把它放進每次通知，
   如果每期都變就沒辦法免查資料庫地認出身分。用測試金鑰驗證時要特別對這一點。
2. **AlterStatus 的回應格式**：規格說「回傳 period 加密 JSON」，跟 NotifyURL／ReturnURL 一
   樣的講法，但那兩支是瀏覽器或藍新伺服器 POST 表單過來、欄位就叫 `Period`；AlterStatus
   是我方主動打過去的 API，回應可能是「整包 JSON 裡包一個加密的 `Period` 欄位」，也可能是
   「直接就是解密後的 JSON（`{Status,Message,...}`）」。`alterPeriodStatus()` 兩種都接：
   先看有沒有 `Period` 欄位，有就解密再判斷 `Status`，沒有就直接看外層的 `Status`。
3. **解約要用「建立當初的 MerOrderNo」**：`credit_token` 只存 `PeriodNo`（照站長規格文字），
   但 `AlterStatus` 的欄位另外要 `MerOrderNo`。首期成功後 `trade_no` 會被換成這一期的
   `TradeNo`，原始委託編號因此只留在 `sponsor_trade_nos` 歷史表（本來就是為了「這一欄只有
   一格，後面會被蓋掉」這種情境而存在的表，見 `lib/sponsor-trade-no.ts` 開頭的說明）。解約
   時從歷史表找回最新一筆 WP 開頭的編號使用。如果藍新解約其實只認 `PeriodNo`、`MerOrderNo`
   給誰都能過，這個額外查詢是多做但無害；如果藍新真的比對 `MerOrderNo`，這裡給的就是對的
   那一組。
4. **首期立即扣款失敗時不主動重試**：`PeriodStartType=2`（立即執行首期授權）失敗就直接標記
   贊助 `failed`，不像 PayUni 那條會自動重試——因為這是「委託根本沒有成立」，沒有已經生效
   的委託可以重試，客人要重新走一次贊助流程。
5. **PeriodPoint 用「建立委託當天」而不是「使用者填表當天」**：兩者理論上可能不同（填表後
   隔了幾天才真的完成付款頁），但 `buildPeriodForm()` 是在 `/support/pay/[id]` 頁面渲染時
   才呼叫，也就是使用者真正被送去藍新頁面的那一刻，跟「建立委託」這個動作本身同時發生，
   沒有時間差問題。

### 上線前要用測試金鑰驗的清單（定期定額）

- [ ] 首期授權成功：走一次長期支持，確認 `/api/newebpay/period/notify` 收到通知、贊助狀態
      變 `active`、`credit_token` 存到 `PeriodNo`、`next_charge_at` 是下個月同一天（29～31
      號要確認收斂成 28 號）、感謝信寄出、後台看得到第 1 期扣款紀錄
- [ ] 首期授權失敗：用會被拒絕的測試卡號，確認贊助狀態變 `failed`，不會卡在 `pending`
- [ ] 續期扣款：等（或用藍新測試環境的方式模擬）第 2 期扣款通知，確認 `sponsor_charges` 多
      一筆、`next_charge_at` 往後推一個月、`sendSponsorChargedMail` 寄出、發票開立
- [ ] 續期扣款失敗：確認 `onMonthlyChargeFailed` 有跑（第一次通知客人，連續兩次暫停贊助）
- [ ] 重複通知：同一筆首期或續期通知重送兩次，確認 `sponsor_charges` 不會多寫、不會寄兩封信
- [ ] 解約：從確認信的取消連結點下去，確認 `alterPeriodStatus` 打成功、狀態變 `cancelled`，
      之後藍新不會再扣款（要在藍新後台或下個月扣款日實際確認）
- [ ] 後台切換：`support_mode=hybrid` 時，`monthly_gateway` 在 newebpay／portaly 間切換，
      首頁與 `/support` 的「長期支持」分頁行為要跟著變（前者站內完成、後者外連一顆按鈕）

## 相關檔案

- `lib/newebpay.ts`：加解密、簽章、表單組裝、回呼解析、查詢 API（單筆 MPG）
- `lib/newebpay-period.ts`：定期定額委託建立、回呼解析、解約（見上面「定期定額」一節）
- `lib/payment-sync.ts`：`applyNewebpayOrderResult`／`applyNewebpayOrderAtmInfo`／
  `applyNewebpaySponsorResult`／`applyNewebpaySponsorAtmInfo`
- `lib/reconcile.ts`：`checkNewebpaySponsor()`、`cleanupStaleOrders()` 內的藍新回查段
- `lib/shop.ts`：`ShopGateway` 型別、`shopGateway()`、`retryPayOptions()`、`monthlyGateway()`
- `app/api/newebpay/{notify,return,atm}/route.ts`：單筆 MPG
- `app/api/newebpay/period/{notify,return}/route.ts`：定期定額
- `app/api/orders/route.ts`、`app/api/orders/pay/route.ts`：商店結帳與免重填再付一次
- `app/support/actions.ts`、`app/support/pay/[id]/page.tsx`：贊助建立與付款頁
- `app/support/cancel/actions.ts`：贊助者自行取消（含藍新定期定額解約）
- `components/CheckoutForm.tsx`、`components/SupportForm.tsx`：前端付款方式與跳轉
- `app/admin/(panel)/settings/pay/page.tsx`、`app/admin/(panel)/settings/sponsor/page.tsx`、
  `app/admin/actions.ts`：後台金流與贊助設定
- `tests/smoke.ts`：加解密來回、TradeSha、MerchantOrderNo／MerOrderNo 產生與還原、
  `parseNotify`／`parsePeriodNotify` 驗簽（或解密）測試、PeriodPoint 收斂規則
