# 訂單生命週期（接手者先看這張）

```
                    客人結帳 /api/orders
                          │ 建單（庫存預扣、連結作廢、發訂單編號）
                          ▼
                     ┌─ pending ─┐──────────── 逾期(26h／ATM 4天) ──▶ cancelled(自動)
   綠界/LINE Pay 回呼 │           │                                     │ 庫存回補
   （只有成功才回）    │           │ 對帳排程每15分鐘主動查金流商            │ 顧客點重付連結
                     ▼           ▼                                     ▼ 可復原(重扣庫存)
                    paid ◀──── 對帳補正(漏回呼的救回)              回到 pending
                     │ afterOrderPaid：開發票(光貿)、寄付款完成信、
                     │ 通知站長＋夥伴(各收自己的)、GA purchase
                     ▼
              夥伴逐品項標出貨(/api/partner/ship，逐批寄物流信給顧客)
                     │ 全品項出完
                     ▼
                  shipped ──(站長手動)──▶ done
                     │
              (站長手動標) refunded：錢已收後退還。結算報表列負項(refunded_at 那期)，
                          庫存不自動回補（食品退回多半報廢）
```

## 誰改狀態

| 轉換 | 由誰 | 在哪 |
|---|---|---|
| →pending | 顧客結帳 | app/api/orders/route.ts |
| pending→paid | 金流回呼 或 對帳補正 或 站長人工入帳 | api/ecpay/return、api/linepay/confirm、lib/reconcile.ts、admin actions |
| pending→cancelled | 對帳逾期／被後續訂單取代 | lib/reconcile.ts（isAutoCancelled 標記，晚到的錢可救回） |
| paid→shipped | 夥伴出完全部品項（自動）或站長手動 | api/partner/ship、admin updateOrder |
| →refunded | 站長手動（先去金流商退刷） | admin 訂單明細下拉 |

## 三條鐵律

1. 入帳一律「條件式 UPDATE 搶佔」（WHERE status='pending'）：回呼會重送，只有贏家開發票寄信。
2. 庫存跨越 cancelled 邊界時同步加回／扣回（含規格庫存），在同一個 transaction。
3. 規格名稱是庫存與統計的鍵：開賣後改名＝斷鏈。排序用編輯器的↑↓，別重打文字。

相關：docs/multi-partner-spec.md（夥伴/運費/結算）、AGENTS.md（站規）
