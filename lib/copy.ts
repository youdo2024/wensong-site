import { getSetting } from "./db";
import { BRAND } from "./brand";

/*
 * 全站文案總表：前台文字與信件文字都在這裡定義預設值，
 * 後台「設定・內容」可逐條修改（存於 settings，key 前綴 copy_）。
 * 【】包起來的字前台會以品牌橘強調。
 */

export type CopyDef = { key: string; label: string; kind: "text" | "textarea"; def: string; hint?: string };
export type CopyGroup = { title: string; items: CopyDef[] };

export const COPY_GROUPS: CopyGroup[] = [
  {
    title: "首頁：開場區",
    items: [
      { key: "hero_tag", label: "小標籤", kind: "text", def: "PODCAST・不 定 期 更 新" },
      { key: "hero_title", label: "主標語", kind: "text", def: "問東問西，【問爽的】拉", hint: "【】內的字會變成橘色強調" },
      { key: "hero_dek", label: "介紹段落", kind: "textarea", def: "維尼跟安妮的聊天節目。有什麼想問餐廳老闆、想問創業的人的，我們幫你問，也讀你投稿來的秘密，一集一集問到爽為止。" },
      { key: "hero_btn1", label: "橘色按鈕文字（連去最新一集）", kind: "text", def: "聽最新一集" },
      { key: "hero_btn2", label: "白色按鈕文字（連去全部集數）", kind: "text", def: "看全部集數" },
      { key: "hero_latest", label: "最新一集上方的小字", kind: "text", def: "最 新 一 集" },
    ],
  },
  {
    title: "首頁：收聽平台、集數、主持人、來賓",
    items: [
      { key: "platforms_title", label: "收聽平台一行字", kind: "text", def: "在你習慣的地方聽" },
      { key: "eps_tag", label: "集數區標籤", kind: "text", def: "最 近 幾 集" },
      { key: "eps_title", label: "集數區標題", kind: "text", def: "從哪一集開始都可以" },
      { key: "eps_sub", label: "集數區副標", kind: "text", def: "每一集都有節目筆記跟逐字稿，聽不完先看也行" },
      { key: "eps_btn", label: "集數區按鈕", kind: "text", def: "看全部集數" },
      { key: "hosts_tag", label: "主持人區標籤", kind: "text", def: "主 持 人" },
      { key: "hosts_title", label: "主持人區標題", kind: "text", def: "問的人是這兩個" },
      { key: "hosts_sub", label: "主持人區副標", kind: "text", def: "一個問題很多，一個開餐廳，加起來就是問爽的" },
      { key: "guests_tag", label: "來賓區標籤", kind: "text", def: "來 賓" },
      { key: "guests_title", label: "來賓區標題", kind: "text", def: "被我們問過的人" },
      { key: "guests_sub", label: "來賓區副標", kind: "text", def: "每一位都有自己的頁面，上過哪幾集、店在哪裡都查得到" },
      { key: "guests_btn", label: "來賓區按鈕", kind: "text", def: "看全部來賓" },
    ],
  },
  {
    title: "首頁：商店、支持、電子報",
    items: [
      { key: "shopsec_tag", label: "商品區標籤", kind: "text", def: "周 邊" },
      { key: "shopsec_title", label: "商品區標題", kind: "text", def: "把問爽的帶回家" },
      { key: "shopsec_sub", label: "商品區副標", kind: "text", def: "數量不多，賣完就等下一批" },
      { key: "shopsec_btn", label: "商品區按鈕", kind: "text", def: "前往周邊商店" },
      { key: "support_title", label: "支持區標題", kind: "text", def: "幫我們加雞腿" },
      { key: "quick_note", label: "快速支持小字", kind: "text", def: "安全金流自動扣款，隨時可取消" },
      { key: "nl_tag", label: "電子報區標籤", kind: "text", def: "電 子 報" },
      { key: "nl_title", label: "電子報區標題", kind: "text", def: "新的一集上線時通知你" },
      { key: "nl_sub", label: "電子報區副標", kind: "text", def: "只寄新集數跟偶爾的活動，不寄廣告" },
    ],
  },
  {
    title: "集數頁",
    items: [
      { key: "ep_notes_h", label: "節目筆記標題", kind: "text", def: "這 集 聊 什 麼" },
      { key: "ep_guests_h", label: "來賓區標題", kind: "text", def: "本 集 來 賓" },
      { key: "ep_transcript_h", label: "逐字稿標題", kind: "text", def: "逐 字 稿" },
      { key: "ep_transcript_note", label: "逐字稿免責一句話", kind: "text", def: "逐字稿由 AI 語音辨識產生、人工粗校，可能有錯字，內容以音檔為準。" },
      { key: "ep_related_h", label: "相關集數標題", kind: "text", def: "你 可 能 也 想 聽" },
      { key: "ep_cta_line", label: "集數頁文末支持那句話", kind: "text", def: "這一集是像你一樣的聽眾讓它存在的。" },
    ],
  },
  {
    title: "文章頁",
    items: [
      { key: "article_cta_default", label: "文末 CTA 預設句（每篇可在文章編輯個別覆蓋）", kind: "textarea", def: "這篇文章是像你一樣的聽眾讓它存在的。" },
      { key: "sticky_text", label: "底部固定條文字", kind: "text", def: "這一集是支持者讓我們錄下去的" },
      { key: "sticky_btn", label: "底部固定條按鈕", kind: "text", def: "小額贊助" },
      { key: "article_shop_title", label: "支持商品 CTA 標題（檔期開關在「網站設定」）", kind: "text", def: "支持商品" },
      { key: "article_shop_text", label: "支持商品 CTA 內文", kind: "textarea", def: "周邊不多，每一件都是我們自己也會用的東西。\n買一份，就是讓節目可以繼續錄。" },
      { key: "article_shop_btn", label: "支持商品 CTA 按鈕文字", kind: "text", def: "看看有什麼" },
    ],
  },
  {
    title: "結帳與商店",
    items: [
      { key: "addon_pitch", label: "結帳加購支持的那段話", kind: "textarea", def: "結帳前，要不要【額外支持「問爽的」】？多一份支持，節目就能多錄幾集。", hint: "【】內的字會加粗變橘" },
      { key: "closed_title", label: "商店休息中：標題", kind: "text", def: "商店暫時休息中" },
      { key: "closed_text", label: "商店休息中：說明", kind: "textarea", def: "整理貨架中，很快回來。先去聽一集，或看看來賓都是誰。" },
    ],
  },
  {
    title: "支持感謝頁",
    items: [
      { key: "sthx_title", label: "標題", kind: "text", def: "謝謝你，我們會繼續錄下去" },
      { key: "sthx_p1", label: "第一句", kind: "text", def: "確認信與電子收據已寄到你的信箱。" },
      { key: "sthx_monthly", label: "每月支持者附註", kind: "textarea", def: "你是每月支持者，信中有停止的連結，任何時候都可以停止，不用不好意思。" },
      { key: "sthx_btn", label: "按鈕文字", kind: "text", def: "回首頁，繼續聽" },
    ],
  },
  {
    title: "頁尾",
    items: [
      { key: "footer_line", label: "品牌一句話", kind: "text", def: BRAND.tagline },
    ],
  },
  {
    title: "信件：共用區塊（每一封都有）",
    items: [
      { key: "mail_thanks_1", label: "感謝框第一行", kind: "textarea", def: "謝謝你。這個節目能一直錄下去，靠的就是像你這樣的人。" },
      { key: "mail_thanks_2", label: "感謝框第二行（署名句）", kind: "text", def: "問東問西，問爽的拉。維尼與安妮" },
      { key: "mail_footer_line", label: "聯絡資訊末行", kind: "text", def: `${BRAND.fullName}・${BRAND.tagline}` },
      { key: "mail_stop_prefix", label: "停止支持引言", kind: "text", def: "想停止的話隨時可以：" },
      { key: "mail_stop_link", label: "停止連結文字", kind: "text", def: "停止每月支持" },
    ],
  },
  {
    title: "信件：訂單成立",
    items: [
      { key: "m_order_title", label: "信件標題", kind: "text", def: "訂單成立，謝謝你" },
      { key: "m_order_body", label: "開頭句（前面自動接「某某你好，」）", kind: "textarea", def: "收到你的訂單了，會在 3 至 5 個工作天內出貨，出貨後另寄物流通知。" },
    ],
  },
  {
    title: "信件：ATM 待付款",
    items: [
      { key: "m_atm_title", label: "信件標題", kind: "text", def: "訂單成立，等你完成轉帳" },
      { key: "m_atm_body", label: "開頭句（前面自動接「某某你好，」）", kind: "textarea", def: "你的訂單已成立，請在期限內完成 ATM 轉帳，付款完成後會再寄確認信。" },
    ],
  },
  {
    title: "信件：出貨通知",
    items: [
      { key: "m_ship_title", label: "信件標題", kind: "text", def: "出貨了，包裹在路上" },
      { key: "m_ship_body", label: "開頭句（前面自動接「某某你好，」）", kind: "textarea", def: "你的訂單已出貨。" },
    ],
  },
  {
    title: "信件：支持感謝（單次與每月共用）",
    items: [
      { key: "m_sp_title", label: "信件標題", kind: "text", def: "謝謝你，我們會繼續錄下去" },
      { key: "m_sp_body", label: "感謝句（前面自動接「某某好，收到你的◯◯支持 NT.◯◯◯。」）", kind: "textarea", def: "你支持的是持續公開的節目內容：每一集、每一份節目筆記與逐字稿，都因為這份支持而繼續。謝謝你成為其中一份力量。" },
      { key: "m_sp_monthly_note", label: "定額附註", kind: "text", def: "每月由安全金流自動扣款。" },
      { key: "m_sp_invoice", label: "發票附註", kind: "text", def: "電子發票由金流系統另行開立寄送。" },
    ],
  },
  {
    title: "信件：每月扣款完成",
    items: [
      { key: "m_charge_title", label: "信件標題", kind: "text", def: "本月支持扣款完成" },
      { key: "m_charge_body", label: "內文（前面自動接「某某好，本月的支持 NT.◯◯◯ 已扣款完成。」）", kind: "textarea", def: "謝謝你持續的支持。" },
    ],
  },
  {
    title: "信件：投稿收件確認",
    items: [
      { key: "m_sub_title", label: "信件標題", kind: "text", def: "收到你的投稿了" },
      { key: "m_sub_body", label: "說明段（前面自動接「某某你好，你的投稿〈標題〉我收到了。」）", kind: "textarea", def: "每一篇都會親自看過。如果適合在節目裡聊，會再用這個信箱與你聯絡。" },
    ],
  },
];

const DEFAULTS: Record<string, string> = {};
for (const g of COPY_GROUPS) for (const i of g.items) DEFAULTS[i.key] = i.def;

/* 取得文案：後台改過用改過的，否則用預設 */
export function t(key: string): string {
  const custom = getSetting(`copy_${key}`, "");
  return custom || DEFAULTS[key] || "";
}

export const COPY_KEYS = Object.keys(DEFAULTS);
