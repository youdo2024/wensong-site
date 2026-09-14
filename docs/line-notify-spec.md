# LINE 通知規格（2026-09-03 與站長逐題定案）

> 此為佑在幹嘛時期的紀錄。第二節「LINE 後台結構」談的是佑在幹嘛自己的 LINE Provider／Messaging API
> 帳號搬遷，問爽的要用自己的 LINE 官方帳號與 Provider 走一遍，網址也要換成 wensong.tw，不能照抄。
> 程式機制（綁定表、webhook、推播節奏）本身是通用的，可以參考。

目標：訂單與投稿的通知走 LINE 官方帳號推播，沒綁 LINE 的人維持 Email 與簡訊。
本文件是共識紀錄，開工前站長確認過。改動前先讀 AGENTS.md 與 handoff-2026-09-02.md。

## 一、範圍（第一期）

推 LINE 的事件：
| 事件 | 觸發點（現有程式） | LINE | Email | 簡訊（沒綁 LINE 才發） |
|---|---|---|---|---|
| ATM／超商取號繳費資訊 | lib/payment-sync.ts 綠界 ATM 回呼、PayUni PayNo | 推 | 照舊 | 無 |
| 付款完成 | lib/payment-sync.ts afterOrderPaid | 推 | 照舊 | 無 |
| 已出貨 | app/admin/actions.ts updateOrder、app/api/partner/ship | 推 | 照舊 | 無 |
| 待付款提醒（最多 2 次） | lib/reconcile.ts 排程 | 推 | 照舊 | 照舊（pending） |
| 付款失敗救援 | lib/reconcile.ts | 推 | 照舊 | 照舊（failed） |
| 收到投稿 | app/api/submissions/route.ts | 推 | 照舊 | 無 |
| 投稿採用通知 | 站長手動寄的那封 | 推「已採用，詳情看 Email」，不放金額 | 照舊 | 無 |

不做（第二期或不做）：贊助類事件（沒有手機欄位、對象不同）、電子報與促銷推播、客人傳訊息查訂單的自動回覆、卡片式 Flex 訊息、企業訂購回覆信（現況缺口，另案）。

原則：
- 信用卡訂單只推兩則（付款完成、已出貨），ATM 訂單三則。不另推「訂單成立」。
- Email 每次都寄。簡訊維持現有兩個觸發點，不因 LINE 擴大。
- 沒綁 LINE 的人，Email 放「用 LINE 收通知」完整按鈕，簡訊放本站短網址（youdoyou.tw/l/代碼），兩者都連到同一條綁定流程。

## 二、LINE 後台結構（站長已決定：B 方案）

- 現況：Messaging API「佑在幹嘛｜則佑」在 Provider「於悅商行」；LINE Login「佑在幹嘛」在另一個 Provider「佑在幹嘛」。userId 跟 Provider 走，兩邊對不起來。channel 不能搬 Provider，Messaging API channel 不能單獨刪。
- 決定：把 LINE Login 搬到官方帳號那個 Provider，並把該 Provider 改名。
- 站長要做的（順序）：
  1. 舊 Provider「佑在幹嘛」改名「佑在幹嘛（舊）」；「於悅商行」改名「佑在幹嘛」。
  2. 在新的「佑在幹嘛」Provider 新開 LINE Login channel：Callback URL 設 `https://www.youdoyou.tw/api/auth/line/callback`（審核站另加一條）；申請 OpenID Connect email 權限（附隱私權政策網址）；發佈（Published）。
  3. 在該 Login channel 的「Linked LINE Official Account」連結官方帳號（加好友選項要靠這個）。
  4. Messaging API channel：發 channel access token（長效）、記 channel secret；webhook URL 填 `https://www.youdoyou.tw/api/line/webhook`，開啟 Use webhook；官方帳號後台把「自動回應訊息」關掉或保留（webhook 只處理加好友、封鎖、綁定碼，其他訊息交給官方帳號原本的回應）。
  5. Zeabur 環境變數：LINE_CHANNEL_ID、LINE_CHANNEL_SECRET 換成新 Login channel；新增 LINE_MESSAGING_ACCESS_TOKEN、LINE_MESSAGING_CHANNEL_SECRET、LINE_OA_ID（@ 開頭的官方帳號 ID，短網址與加好友用）。
  6. 上線兩週後確認沒人再用舊登入，刪舊 Login channel 與舊 Provider。
- Claude 絕不經手金鑰，只給網址與變數名稱。

## 三、綁定

資料表 `line_bindings`：line_user_id（唯一）、phone、email、user_id（會員，可空）、status（bound／blocked）、source（checkout／thanks／mail／sms／login／oa_code／account）、order_no（首次綁定的訂單）、created_at、updated_at、blocked_at。

對人規則（Q12）：訂單要推播時先比手機（normalizePhone），再比 email（小寫），任一命中且 status=bound 就推。

入口：
1. 結帳頁最後一格勾選「用 LINE 收訂單與出貨通知（免費）」，存 orders.line_optin。付款回到感謝頁，勾了的人看到大按鈕；沒勾的人看到一張卡片再問一次（「用 LINE 接收」／「不用了」，每張訂單問一次，已綁定的不顯示）。
2. 綁定網址 `/line/bind?no=訂單編號&t=訂單 token`：網站轉去 LINE 登入（bot_prompt=aggressive 順便加好友）→ 回來取 userId → 寫綁定表（手機、email 取自該訂單）→ 回感謝頁顯示「已綁定」。客人只按兩下，不打字。Email 按鈕與簡訊短網址都連到這裡。
3. 會員：LINE 登入回來若已加好友（friendship_status_changed 或查詢好友狀態 API），自動寫綁定表（email 取自會員）；會員中心顯示「LINE 通知：已開啟」，另有「開啟 LINE 通知」按鈕給 Google 登入或未加好友者。
4. 沒經過網站直接加好友的人：webhook 收到 follow 事件回歡迎語「想用 LINE 收訂單通知，把訂單編號（YD 開頭）傳給我」；收到符合訂單編號格式的訊息，查到訂單就綁定（手機、email 取自訂單）並回「綁定成功」；查不到回「找不到這張訂單」。只認訂單編號，不認手機。

狀態：webhook 收到 unfollow 標 blocked 並記時間，之後直接走簡訊與 Email；收到 follow 自動恢復 bound。推播回 4xx（封鎖／無效 userId）也標 blocked 並當場補寄簡訊（僅限本來就有簡訊的兩個事件）。

## 四、推播

- 純文字加一條連結，格式與簡訊一致：收件人名字開頭、內文、網址。結尾不加署名（官方帳號名稱已顯示）。
- 模板存 settings（line_tpl_*），後台可編輯、即時預覽，初稿由 Claude 照簡訊與 Email 口吻寫。
- 每次推播寫 `line_log`（line_user_id、order_no、kind、status、error、created_at）。
- 額度：settings `line_quota_monthly` 預設 200，站長升級後自己改。本月推播數以 line_log 計；達 75% 寄一封信到站長通知信箱（每月一次）；達 100% 自動退回簡訊與 Email，後台顯示「LINE 額度已滿」。
- 測試模式：settings `line_test_user_ids`（一格一個）。有值時只推給名單內的人，其他人照常走 Email 與簡訊；後台每頁頂端顯示「LINE 測試模式中」。清空即正式上線。

## 五、後台

- 「簡訊」頁旁邊加獨立分頁「LINE」（同一組 AdminTabs）：狀態列（token 是否設定、webhook 最近一次收到時間、本月推播數／額度、測試模式）、十種模板編輯、最近 50 筆 line_log。
- 網站設定：LINE 每月額度、測試白名單。
- 訂單頁：顯示這張訂單對到的 LINE 綁定狀態；一顆「手動推 LINE」（選模板）。
- 會員列表：LINE 綁定狀態欄。
- 總覽：卡片「本月 LINE 已推 N／額度」。

## 六、登入頁

只有一顆大按鈕「用 LINE 登入」；下方灰字「其他登入方式」，點開才出現 Google。Google 會員不受影響。
舊 LINE Login channel 換新之後 userId 全變：登入回來先以 email 對舊會員合併（有 email 才對得回），對不回的視為新會員。

## 七、隱私

隱私權政策「受託處理者」加 LINE（推播通知）；綁定按鈕旁一行「綁定即同意用 LINE 接收訂單通知，封鎖官方帳號即取消」。

## 八、上線順序

1. 站長做第二節的 LINE 後台六步（與第 2 步並行）。
2. Claude 做程式：綁定表與遷移、/line/bind、webhook（驗 X-Line-Signature）、推播與退回簡訊、額度與測試模式、後台 LINE 分頁、訂單頁與會員頁、登入頁改版、舊會員接回、Email 與簡訊的綁定入口、隱私權政策。審核站先跑通不推 LINE 的部分。估三到四個工作天。
3. 正式站測試模式，只推給站長的 userId，站長自己下單走完整流程（信用卡、ATM、出貨、封鎖再加回）。
4. 清空白名單正式上線。
5. 兩週後刪舊 Provider。

## 九、第二期候選

客人傳訊息查訂單（免費回覆）、Flex 卡片、贊助事件、企業訂購回覆信、電子報導流到 LINE。
