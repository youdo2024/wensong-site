# 後台統一規格（2026-09-05 改版版，取代 09-04 舊版）

這是後台唯一的一份規格。舊版那張「控制項對照表」已經跑完並刪除，不留兩套。
資訊架構的決定在 `docs/admin-redesign/ia.md`（那份是站長拍板的，要改先改那份），
視覺依據是 `docs/admin-redesign/canvas/` 的畫布檔。這份只講「程式要怎麼寫」。

CSS 全部在 `app/admin/(panel)/admin.css`，一律 `.adm` 前綴，前台一條都吃不到。
元件在 `components/admin/`。

## 一、不能動的品牌

米袋色底（`--rice` / `--rice-lt`）、2px 茶墨框、直角（開關的膠囊除外）、
硬陰影 `8px 8px 0 rgba(58,50,38,.14)`、標題寬字距、點點動畫。

**唯一的例外：字體。** 站長 2026-09-05 決定後台全部改黑體（含標題），
規則寫在 admin.css 最上面，`.adm` 前綴，前台仍是宋體。字距不變。

## 二、Token（admin.css 最上面，`.adm` 底下）

| 類 | 變數 | 值 | 用在哪 |
|---|---|---|---|
| 間距 | `--sp-1` / `--sp-2` / `--sp-3` | 8 / 14 / 24 | 元素內／元素與卡片間／區塊間。沒有第四種 |
| 字級 | `--fs-h` / `--fs-b` / `--fs-s` | 16 / 14 / 12 | 標題／內文／副文。手機桌機一樣，不放大 |
| 語意色 | `--c-pending` | `#B9791E` 琥珀 | 待付款、待出貨、待審、待催 |
| | `--c-fail` | `var(--seal)` 朱紅 | 失敗、逾期、刪除、主動作 |
| | `--c-ok` | `#4A6B2C` 綠 | 完成、正常、寄得到 |
| | `--c-muted` | `var(--grey)` 灰 | 其他 |

- 品牌色票留在 `app/globals.css` 的 `:root`，不要動那個檔。
- **靛藍 `--indigo` 已從後台拿掉**：它以前同時當「來源標記」與連結色，
  跟朱紅搶注意力。後台看到 indigo 一律改成 `--c-muted` 或 `--ink`。
- 文字上色用 `.tone-ok` / `.tone-fail` / `.tone-muted` 三個 class，不要寫 inline color。

## 三、版面規則

1. **一頁只做一件事**：頁首那句副標說得出來才算數。說不出來就拆頁。
2. **主動作只有一顆**（`.btn.fill`）。兩顆以上代表這頁在做兩件事。
3. **危險動作在最底**，包在 `<DangerZone>` 裡，送出鈕用 `<ConfirmSubmit>`。
4. **可點的東西至少 44px 高**（列表列與底欄用 56px）。開關對齊說明文字第一行。
5. **手機 402 是基準寬**（360 到 430 都要過），桌機 1280。不可以有橫向捲軸。
6. **空狀態要有一句話**，用 `<Empty>`，不要留白。
7. **不寫 inline style**。要新的樣式就在 admin.css 加一條 `.adm` 前綴的 class。

## 四、元件與什麼時候用

| 元件 | 什麼時候用 |
|---|---|
| `PageHead` | 每一頁的第一個元素。標題、一句副標、選配返回連結與一顆主動作 |
| `StatusBar` | 單筆資料的詳情頁最上面。狀態（語意色）、金額、備註列、「下一步」一句話。算不出來的句子就不要寫，不要編 |
| `ActionRow` | 這一筆能做的幾件事。點了才展開表單，同時只展開一個。手機一列一個，桌機並排。有 `anchor` 的動作可以被 `#錨點` 深層連結打開 |
| `DetailTabs` | 詳情頁的骨架：手機三個分頁籤（動作／資料／紀錄），桌機左右兩欄。同一份 DOM，不複製表單 |
| `Card` | 一塊內容。有 `title` 就自動長出區塊標題；`pad={false}` 給自己有內距的內容；`lift` 給要被看見的那一張（一屏最多一兩張） |
| `KV` | 欄名對值的資料（收件、發票、管道狀態）。左欄固定 5.5em |
| `FilterBar` | 列表頁的狀態膠囊＋搜尋＋卡片／表格切換。訂單、贊助、投稿、名單共用 |
| `StickySave` | 有儲存鈕的表單。黏在底部，有沒存的改動就亮琥珀說「有 N 項還沒儲存」 |
| `Empty` | 沒資料時的一句話 |
| `DangerZone` | 刪除、清空這類做了回不來的動作 |
| `Drawer` | 手機全螢幕選單。點連結、按關閉、按 Esc 都會關 |
| `Switch` | 布林設定（開／關某功能）。自帶 hidden value=0 |
| `Check` | 多選、同意事項；`type="radio"` 給單選 |
| `ViewToggle` | 手機的卡片／表格切換 |
| `RemindButtons` | 手動催款三顆鈕 |
| `ConfirmSubmit` | 任何做了回不來的送出鈕 |

## 五、按鈕與控制項

| 用途 | 寫法 |
|---|---|
| 主要儲存（一個表單一顆） | `className="btn fill"` |
| 次要 | `className="btn"` |
| 列內小動作 | `className="btn sm"` |
| 做了回不來 | `<ConfirmSubmit className="btn danger" message="…">` |
| 可逆的文字動作 | `className="link-btn"`；不可逆的文字動作 `className="danger-link"` |
| 圖示鈕（↑ ↓ ✕ ＋） | `className="ibtn"`，刪除加 `danger`、新增加 `add` |
| 圖示 | `<Ico n="mail" />`，一律線條 SVG，**後台不用 emoji** |

## 六、導覽（ia.md §1 的落地）

- 側欄五組：每天看／賣東西／跟人聯絡／內容／設定。入口都在 `components/AdminNav.tsx` 的 `GROUPS`。
- 設定六個入口目前都指向 `/admin/settings` 的錨點，六頁各自獨立是之後的批次。
- 手機：頂列「選單」開全螢幕抽屜；底欄固定五顆（總覽、訂單、提醒、贊助、商品），
  56px 高，選到的用 2px 朱紅上緣標示。

## 七、不能改的

- 任何 server action、表單欄位 name、value、hidden 欄位語意、redirect、資料查詢。
- `app/admin/actions.ts`、`lib/**`、前台任何檔案、`app/globals.css`。
- 網址不改。舊的深層連結（例如 `/admin/orders/12#notify`）要照樣能用。

## 八、完成條件

- `npx tsc --noEmit -p .` 零錯誤（iCloud 會生「xxx 2.ts」副本，先 `find .next -name "* [0-9].*" -delete`）。
- `npm run smoke` 全過。
- 402 與 1280 各看一次：沒有橫向捲軸、沒有文字交疊、按鈕高度夠。
- 你負責的頁面 grep 不到新的 `style={{`。改完的頁面 inline style 數量要比改之前少。
