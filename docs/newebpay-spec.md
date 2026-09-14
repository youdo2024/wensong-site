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
4. **藍新沒有定期定額（每月扣款）API**：規格只提到 MPG 單筆與 ATM，所以贊助的「長期支持」
   一律不會用藍新（`app/support/actions.ts` 的 `useNewebpay` 只在 `mode==="once"` 時成立），
   月費繼續走 Portaly／PayUni。`SupportForm.tsx` 也把「長期支持」分頁在 `provider=newebpay`
   時關閉，避免使用者選了長期卻在送出後被靜靜導去別家金流而搞不清楚狀況。
5. **NotifyURL／ReturnURL 回應內容**：規格只要求 HTTP 200，沒有規定回應文字格式（不像綠界
   要求 `1|OK`）。三支路由一律回純文字 `OK`（notify）或 303 redirect（return／atm），沒有刻
   意模仿綠界的協定字串。

## 相關檔案

- `lib/newebpay.ts`：加解密、簽章、表單組裝、回呼解析、查詢 API
- `lib/payment-sync.ts`：`applyNewebpayOrderResult`／`applyNewebpayOrderAtmInfo`／
  `applyNewebpaySponsorResult`／`applyNewebpaySponsorAtmInfo`
- `lib/reconcile.ts`：`checkNewebpaySponsor()`、`cleanupStaleOrders()` 內的藍新回查段
- `lib/shop.ts`：`ShopGateway` 型別、`shopGateway()`、`retryPayOptions()`
- `app/api/newebpay/{notify,return,atm}/route.ts`
- `app/api/orders/route.ts`、`app/api/orders/pay/route.ts`：商店結帳與免重填再付一次
- `app/support/actions.ts`、`app/support/pay/[id]/page.tsx`：贊助建立與付款頁
- `components/CheckoutForm.tsx`、`components/SupportForm.tsx`：前端付款方式與跳轉
- `app/admin/(panel)/settings/pay/page.tsx`、`app/admin/actions.ts`：後台金流切換
- `tests/smoke.ts`：加解密來回、TradeSha、MerchantOrderNo 產生與還原、`parseNotify` 驗簽測試
