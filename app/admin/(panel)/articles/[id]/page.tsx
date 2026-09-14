import type { Metadata } from "next";
import Switch from "@/components/admin/Switch";
import ConfirmSubmit from "@/components/ConfirmSubmit";
import { notFound } from "next/navigation";
import db, { json } from "@/lib/db";
import { saveArticle, deleteArticle } from "@/app/admin/actions";
import MultiInput from "@/components/MultiInput";
import ImagePicker from "@/components/ImagePicker";
import MdImageHelper from "@/components/MdImageHelper";
import BlockHelper from "@/components/BlockHelper";

import { requireAdmin } from "@/lib/admin-guard";
import StickySave from "@/components/admin/StickySave";
import PageHead from "@/components/admin/PageHead";
import DangerZone from "@/components/admin/DangerZone";
export const metadata: Metadata = { title: "編輯文章" };

/*
 * 編輯文章（2026-09-06 改版第六批的收尾）。
 *
 * 表單本身一個欄位都沒動（name、value、hidden 全部照舊，StickySave 也留著）。
 * 改的是版面：頁首換成 PageHead（多一條返回文章列表的路），
 * 中間用 .ad-sect 分成「基本資料 / 內容 / 顯示」三段，
 * 刪除收進紅框的 DangerZone 放最底（admin-ui-spec 第三節第 3 條）。
 */

const CATS = ["節目幕後", "餐飲", "創業", "生活", "來賓延伸"];

type ArticleRow = {
  id: number; slug: string; title: string; seo_title: string; category: string; tags: string;
  date: string; read_min: number; location: string; summary: string; body: string; published: number;
  author: string; cta_text: string; cover: string;
};

export default async function EditArticle({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  await requireAdmin();
  const { id } = await params;
  const { error } = await searchParams;
  const isNew = id === "new";
  const a = isNew
    ? null
    : ((db.prepare("SELECT * FROM articles WHERE id=?").get(Number(id)) as ArticleRow | undefined) ?? null);
  if (!isNew && !a) notFound();
  const authors = (db.prepare("SELECT DISTINCT author FROM articles WHERE author!='' ORDER BY author").all() as { author: string }[]).map((r) => r.author);

  return (
    <>
      <PageHead
        back={{ href: "/admin/articles", label: "回文章列表" }}
        title={isNew ? "新 增 文 章" : "編 輯 文 章"}
        sub="內文用 Markdown：`## 小標`會自動進目錄、`&gt; 引文`會變成物產小標框。想放會動的圖表，點內文上方的「動態圖表區塊」"
      />
      {error === "missing" && <p className="msg-err">「slug」與「標題」為必填。</p>}

      <form className="adm-form" action={saveArticle}>
        <input type="hidden" name="id" value={a?.id ?? ""} />

        <div className="ad-sect"><h2>基 本 資 料</h2><div className="rule" /></div>
        <div className="adm-2col">
          <div className="field">
            <label>標題 <em>＊</em></label>
            <input type="text" name="title" defaultValue={a?.title ?? ""} required />
          </div>
          <div className="field">
            <label>SEO 標題（搜尋結果專用，含「｜問爽的」共 30 字內；留空自動用主標題截短。不影響頁面上的大標）</label>
            <input type="text" name="seo_title" defaultValue={a?.seo_title ?? ""} maxLength={40} />
          </div>
          <div className="field">
            <label>本文資料來源（一行一筆，格式「名稱|網址」，網址可省略；會顯示在文末，留空則不顯示）</label>
            <textarea className="ta-s" name="sources" defaultValue={(a as { sources?: string } | null)?.sources ?? ""} placeholder={"農業部生物多樣性研究所|https://www.tbri.gov.tw\n實地訪談：受訪者姓名"} />
          </div>
          <div className="field">
            <label>網址 slug <em>＊</em>（英數與連字號）</label>
            <input className="sans" type="text" name="slug" defaultValue={a?.slug ?? ""} pattern="[a-z0-9-]+" required />
          </div>
          <div className="field">
            <label>分類</label>
            <select name="category" defaultValue={a?.category ?? "生活"}>
              {CATS.map((c) => <option key={c}>{c}</option>)}
            </select>
          </div>
          <div className="field">
            <label>Tags（一格一個，按＋新增）</label>
            <MultiInput name="tags" defaultValues={json<string[]>(a?.tags ?? "[]", [])} placeholder="例如：友善標章" />
          </div>
          <div className="field">
            <label>日期（僅供內部排序參考，前台不顯示）</label>
            <input className="sans" type="date" name="date" defaultValue={a?.date ?? new Date().toISOString().slice(0, 10)} />
          </div>
          <div className="field">
            <label>作者（前台會顯示）</label>
            <input type="text" name="author" list="author-list" defaultValue={a?.author ?? "問爽的"} />
            <datalist id="author-list">
              {authors.map((name) => <option key={name} value={name} />)}
            </datalist>
          </div>
          <div className="field">
            <label>地點（顯示於文章 meta，可留空）</label>
            <input type="text" name="location" defaultValue={a?.location ?? ""} placeholder="彰化芳苑" />
          </div>
        </div>
        <div className="ad-sect"><h2>內 容</h2><div className="rule" /></div>
        <div className="field">
          <label>文末 CTA 句（讀完文章後的那句話，留空用預設）</label>
          <input type="text" name="cta_text" defaultValue={a?.cta_text ?? ""} placeholder="這篇文章沒有業配，是像你一樣的讀者讓它存在的。" />
        </div>
        <ImagePicker name="cover" label="封面圖（文章列表卡片顯示）" value={a?.cover ?? ""} height={160} />
        <div className="field">
          <label>摘要（列表卡片顯示）</label>
          <textarea className="ta-s" name="summary" defaultValue={a?.summary ?? ""} />
        </div>
        <MdImageHelper />
        <BlockHelper />
        <div className="field">
          <label>內文（Markdown）</label>
          <textarea className="code" name="body" defaultValue={a?.body ?? ""} />
        </div>
        {/* 開關列不用 <Switch>：它會多送一個 value="0" 的 hidden 欄位，而這支 action 是
            formData.get(...) ? 1 : 0，拿到第一個值 "0" 是 truthy，會變成永遠開。
            所以直接寫 .sw-row 的標記：長相一樣、送出的值跟以前的 checkbox 完全相同。 */}
        <div className="ad-sect"><h2>顯 示</h2><div className="rule" /></div>
        <div className="sw-list">
          <label className="sw-row">
            <span>發布（取消勾選＝草稿，前台不顯示）</span>
            <input type="checkbox" name="published" defaultChecked={a ? a.published === 1 : true} />
            <i className="sw" aria-hidden />
          </label>
          {/* 文末 CTA 每篇各自開關（站長 2026-09-04）。saveArticle 用 on() 讀，hidden 0 沒問題，可以用 <Switch> */}
          <Switch name="cta_shop" label="文末放「支持商品」" hint="全站設定關掉時一律不顯示；這裡是這一篇要不要放" defaultChecked={a ? (a as { cta_shop?: number }).cta_shop !== 0 : true} />
          <Switch name="cta_support" label="文末放「小額支持」" hint="同上，這一篇要不要放贊助表單" defaultChecked={a ? (a as { cta_support?: number }).cta_support !== 0 : true} />
        </div>
        {/* 黏底儲存列：改了幾項會亮起來，要離開又沒存會先問（ia.md §2 套到所有有儲存鈕的表單） */}
        <StickySave />
      </form>
      {a && (
        <DangerZone title="刪除這篇文章" warn="刪掉就沒有了，前台那條網址會變 404。若只是暫時不想給人看，關掉上面的「發布」就好。">
          <form action={deleteArticle}>
            <input type="hidden" name="id" value={a.id} />
            <ConfirmSubmit className="btn danger" message="確定要刪除這篇文章？此動作無法復原。">刪除這篇文章</ConfirmSubmit>
          </form>
        </DangerZone>
      )}
    </>
  );
}
