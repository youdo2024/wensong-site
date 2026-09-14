import { BRAND } from "./brand";

/*
 * SEO 結構資料層：文章分類、標籤、作者的 slug 對照與頁面文案。
 * 集數與來賓不在這裡（它們在資料庫），這份只管 articles 表用到的分類體系。
 */

export type CategoryDef = { slug: string; name: string; blurb: string };

/* 文章分類。blurb＝列表上方的定義段落（40 到 60 字，可獨立成立） */
export const CATEGORIES: CategoryDef[] = [
  { slug: "behind", name: "節目幕後", blurb: "節目幕後是問爽的怎麼做出來的：選題、邀來賓、錄音那天發生的事，還有沒剪進去的片段。" },
  { slug: "food", name: "餐飲", blurb: "餐飲是來賓與主持人聊過的餐廳、食材與開店經驗的延伸整理，聽完一集想再多知道一點的都在這裡。" },
  { slug: "startup", name: "創業", blurb: "創業是那些把想法做成一家店、一個品牌的人的故事，從第一筆錢到第一個員工。" },
  { slug: "life", name: "生活", blurb: "生活是節目裡問過的日常小事：習慣、觀察、跟那些想問很久卻沒人回答的問題。" },
  { slug: "guest", name: "來賓延伸", blurb: "來賓延伸是某一位來賓的專題整理：他做的事、他推薦的東西、上過哪幾集。" },
];

export const categoryBySlug = (slug: string) => CATEGORIES.find((c) => c.slug === slug);
export const categoryByName = (name: string) => CATEGORIES.find((c) => c.name === name);

/* 標籤頁：只做文章數達 3 篇的標籤，其餘不建頁（避免索引膨脹）。目前還沒有 */
export const TAGS: { slug: string; name: string }[] = [];
export const tagBySlug = (slug: string) => TAGS.find((t) => t.slug === slug);
export const tagByName = (name: string) => TAGS.find((t) => t.name === name);

export type AuthorDef = {
  slug: string; name: string; jobTitle: string; bio: string;
  realName?: string; photo?: string; links?: { label: string; url: string }[];
};
export const AUTHORS: AuthorDef[] = [
  { slug: "wensong", name: BRAND.name, jobTitle: "節目團隊", bio: `${BRAND.fullName}節目團隊共同整理。` },
  { slug: BRAND.hosts[0].key, name: BRAND.hosts[0].name, jobTitle: "主持人", bio: BRAND.hosts[0].intro, links: [{ label: "連結", url: BRAND.hosts[0].link }] },
  { slug: BRAND.hosts[1].key, name: BRAND.hosts[1].name, jobTitle: "主持人", bio: BRAND.hosts[1].intro, links: [{ label: "連結", url: BRAND.hosts[1].link }] },
];
export function authorOf(authorField: string): AuthorDef {
  const name = (authorField || BRAND.name).split("／")[0].trim();
  return AUTHORS.find((a) => a.name === name) || AUTHORS[0];
}
export const authorBySlug = (slug: string) => AUTHORS.find((a) => a.slug === slug);
