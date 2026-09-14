/*
 * 品牌常數層：站名、法人、聯絡方式、主持人、節目來源。
 *
 * 佑在幹嘛官網沒有這一層，品牌字散在 67 個檔案裡，換品牌要逐檔 grep。
 * 這裡是唯一來源：layout、SEO、Nav、Footer、信件、條款全部從這裡讀。
 * 不 import 任何東西（lib/db.ts 會 import 這裡，反向就循環了）。
 *
 * 會變的東西（社群連結、收聽平台、主持人照片）放 settings 表讓後台改；
 * 不會變的（法人、統編、地址、信箱）寫死在這裡。
 */
export const BRAND = {
  name: "問爽的",
  nameEn: "WenSong",
  /* 站名完整版：<title> 後綴、OG siteName、頁尾 */
  fullName: "問爽的 WenSong",
  tagline: "問東問西，問爽的拉",
  description: "問爽的是維尼與安妮主持的 Podcast，問東問西，聊餐飲、創業、生活，有什麼想問的，我們幫你問，也讀聽眾投稿來的秘密與故事。這裡有每一集的節目筆記、逐字稿與來賓資料。",
  /* 對外正式網址（SITE_URL 環境變數優先） */
  siteUrl: "https://www.wensong.tw",
  legalName: "於悅商行",
  taxId: "88528295",
  address: { region: "臺中市", locality: "南屯區", street: "文心路一段 378 號 7 樓之 10", full: "臺中市南屯區惠中里文心路一段 378 號 7 樓之 10" },
  email: "hi@wensong.tw",
  logo: "/brand/logo.png",
  /* 社群分享卡（1200×630），檔案在 public/brand/og.png */
  ogImage: "/brand/og.png",
  ogImageWidth: 1200,
  ogImageHeight: 630,
  /* Safari 網址列與 iOS 主畫面圖示底色＝Logo 橘 */
  themeColor: "#EA962E",
  /* 節目來源 */
  rssUrl: "https://feeds.soundon.fm/podcasts/8fb196b6-ece9-4c40-b352-f181a7495594.xml",
  soundonLink: "https://solink.soundon.fm/wensong",
  soundonPlayer: "https://player.soundon.fm/p/8fb196b6-ece9-4c40-b352-f181a7495594",
  /* 標題裡的節目後綴，匯入時剝掉 */
  titleSuffix: "《問爽的 WenSong》",
  hosts: [
    { key: "winnie", name: "維尼", title: "於悅", intro: "問爽的主持人。問題最多的那一個，什麼都想問清楚。", link: "https://linktr.ee/inhappy" },
    { key: "anne", name: "安妮", title: "禾豐田食", intro: "問爽的主持人。開餐廳的人，把餐桌後面的事講給你聽。", link: "http://linkby.tw/home52love" },
  ],
  /* 支持頁引言預設（後台可改） */
  sponsorLead: "沒有回饋品，只有一直錄下去的問爽的",
  /* 金流結帳頁與發票用的交易描述 */
  tradeDesc: "wensong digital content",
  /* 信件寄件人顯示名（MAIL_FROM 環境變數優先） */
  mailFrom: "問爽的 WenSong <no-reply@wensong.tw>",
} as const;

export type Host = (typeof BRAND.hosts)[number];
