# 問爽的 WenSong 官網

正式網址 https://www.wensong.tw ｜ 於悅商行（統編 88528295）

《問爽的》Podcast 的官網：每一集的節目筆記、逐字稿、來賓資料，加上（第 3 段才開的）周邊商店與支持方案。
Next.js 16 App Router + React 19，資料存在 SQLite（`data/site.db`，首次啟動自動建表）。
部署在 Zeabur，`git push` 到 `main` 就會自動建置上線。

2026-09-14 從 youdo2024/youdoyou-site 分支出來，骨架相同、內容模組全換。
工作手冊是 [`AGENTS.md`](AGENTS.md)，環境變數的唯一真相是 [`.env.example`](.env.example)。

## 啟動

```bash
npm install
npm run dev
```

第一次啟動後集數表是空的，伺服器 15 秒後會自動從 SoundOn RSS 抓進來；
或登入後台到「集數」按「立即同步 RSS」。

正式模式用 `npm run build && npm start`。

## 前台

| 路徑 | 內容 |
|---|---|
| `/` | 首頁：最新一集、平台連結、最近幾集、主持人、來賓 |
| `/ep`、`/ep/[key]` | 集數列表與單集（筆記、來賓、逐字稿、相關集數） |
| `/guests`、`/guests/[slug]` | 來賓列表與單人頁 |
| `/articles`、`/articles/[slug]` | 文章（有內容才在導覽列出現） |
| `/about` | 關於節目與主持人 |
| `/search` | 站內搜尋 |
| `/shop`、`/support` | 商店與支持方案（站長模式，第 3 段開） |
| `/privacy`、`/terms`、`/returns`、`/corrections` | 條款與更正回報 |
| `/rss.xml`、`/llms.txt`、`/sitemap.xml` | 索引檔 |

## 後台 `/admin`

密碼由環境變數 `ADMIN_PASSWORD` 決定（第 2 段改成三個帳號）。
主要區塊：集數、來賓、文章、訂單、贊助、商品、名單、設定。

## 集數怎麼進來

`lib/episodes.ts` 從 SoundOn RSS 同步。RSS 的欄位每次覆蓋，後台改過的筆記與逐字稿不會被洗掉。
細節見 `AGENTS.md`「集數與來賓」。

## 背景排程

全部掛在 `instrumentation.ts`：集數同步（每小時檢查）、每日備份、對帳、電子報續寄、定額續扣。
所以 Zeabur 必須跑長駐容器（`zbpack.json` 的 `serverless: false`）。
