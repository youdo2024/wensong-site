import type { Metadata } from "next";
import ConfirmSubmit from "@/components/ConfirmSubmit";
import { notFound } from "next/navigation";
import db, { json } from "@/lib/db";
import { saveProduct, deleteProduct } from "@/app/admin/actions";
import ImagePicker from "@/components/ImagePicker";
import GalleryEditor from "@/components/GalleryEditor";
import ChoicesEditor from "@/components/ChoicesEditor";
import SpecEditor from "@/components/SpecEditor";
import StoryEditor from "@/components/StoryEditor";
import { productCategories } from "@/lib/shop";
import { parseChoiceStocks } from "@/lib/choice-stock";
import { parseChoiceExpiry } from "@/lib/choice-split";

import { requireAdmin } from "@/lib/admin-guard";
import { allPartners } from "@/lib/partner";
import StickySave from "@/components/admin/StickySave";
import PageHead from "@/components/admin/PageHead";
import DangerZone from "@/components/admin/DangerZone";
export const metadata: Metadata = { title: "編輯商品" };

/*
 * 編輯商品（2026-09-06 改版第六批的收尾）。
 * 欄位一個都沒動：name、value、兩個庫存快照 hidden（超賣防護）、StickySave 全部照舊。
 * 改的是頁首、四段區塊標題，以及把刪除收進紅框放最底。
 */

type ProductRow = {
  id: number; name: string; category: string; price: number; stock: number;
  description: string; option_name: string | null; option_choices: string;
  story: string; spec: string; image: string; images: string; featured: number; published: number;
  price_original: number; price_note: string; notice: string;
  choice_stocks: string; soldout_label: string; soldout_collapse: number; partner_id: number | null; temp_zone: string; choice_expiry: string;
  ship_note: string; corp_entry: number; free_ship: number;
};

export default async function EditProduct({
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
  const p = isNew
    ? null
    : ((db.prepare("SELECT * FROM products WHERE id=?").get(Number(id)) as ProductRow | undefined) ?? null);
  if (!isNew && !p) notFound();
  const cats = Array.from(new Set([...productCategories(), ...(p?.category ? [p.category] : [])]));
  const partners = allPartners();

  return (
    <>
      <PageHead
        back={{ href: "/admin/products", label: "回商品列表" }}
        title={isNew ? "新 增 商 品" : "編 輯 商 品"}
        sub="商品說明與規格表都用表單編輯；分類清單在「設定・商店」維護"
      />
      {error === "missing" && <p className="msg-err">「商品名稱」為必填。</p>}

      <form className="adm-form" action={saveProduct}>
        <input type="hidden" name="id" value={p?.id ?? ""} />
        {/* 開頁時的庫存快照：儲存時只寫「真的被改過」的庫存欄位，
            編輯期間有人下單扣掉的量才不會被舊值蓋回（超賣防護） */}
        <input type="hidden" name="stock_orig" value={p?.stock ?? ""} />
        <input type="hidden" name="choice_stocks_orig" value={p?.choice_stocks ?? "{}"} />

        <div className="ad-sect"><h2>基 本 資 料</h2><div className="rule" /></div>
        <div className="adm-2col">
          <div className="field">
            <label>商品名稱 <em>＊</em></label>
            <input type="text" name="name" defaultValue={p?.name ?? ""} required />
          </div>
          <div className="field">
            <label>分類</label>
            <select name="category" defaultValue={p?.category ?? cats[0]}>
              {cats.map((c) => <option key={c}>{c}</option>)}
            </select>
          </div>
          <div className="field">
            <label>出貨夥伴（誰出這件貨；歸了夥伴才會進他的工作台與通知）</label>
            <select name="partner_id" defaultValue={p?.partner_id ?? ""}>
              <option value="">本店（自己出貨）</option>
              {partners.map((pt) => <option key={pt.id} value={pt.id}>{pt.name}{pt.active ? "" : "（停用中）"}</option>)}
            </select>
          </div>
          <div className="field">
            <label>溫層（決定運費與包裹分組；冷凍冷藏不可超商取貨）</label>
            <select name="temp_zone" defaultValue={p?.temp_zone ?? "ambient"}>
              <option value="ambient">常溫</option>
              <option value="cold">冷凍／冷藏</option>
            </select>
          </div>
          <div className="field">
            <label>售價（NT$）</label>
            <input className="sans" type="number" name="price" defaultValue={p?.price ?? 0} min={0} />
          </div>
          <div className="field">
            <label>庫存</label>
            <input className="sans" type="number" name="stock" defaultValue={p?.stock ?? 0} min={0} />
          </div>
          <div className="field">
            <label>原價（顯示刪除線用，0 或低於售價＝不顯示）</label>
            <input className="sans" type="number" name="price_original" defaultValue={p?.price_original ?? 0} min={0} />
          </div>
          <div className="field">
            <label>價格備註（售價旁的小字，例如「早鳥價至 8/31」）</label>
            <input type="text" name="price_note" defaultValue={p?.price_note ?? ""} />
          </div>
          <div className="field">
            <label>配送標語（售價下方那行，例：常溫宅配・全台出貨。留空＝不顯示）</label>
            <input type="text" name="ship_note" defaultValue={p?.ship_note ?? ""} placeholder="例如：常溫宅配・全台出貨" />
          </div>
          <div className="field">
            <label>免運門檻（NT$，0＝跟著「網站設定」的運費費率走）</label>
            <input className="sans" type="number" name="free_ship" defaultValue={p?.free_ship ?? 0} min={0} />
            <p className="ad-hint">
              想講「買兩盒免運」就填 2×售價。同一個包裹裡有多個商品時，取其中最低的門檻。
            </p>
          </div>
          <div className="field">
            <label>規格名稱（如「尺寸」「出貨週」，無規格留空）</label>
            <input type="text" name="option_name" defaultValue={p?.option_name ?? ""} />
          </div>
          <div className="field">
            <label>完售顯示文字（某規格庫存 0 時顯示在選項上，留空＝「已滿」）</label>
            <input type="text" name="soldout_label" defaultValue={p?.soldout_label ?? ""} placeholder="例如：已滿、售完" />
          </div>
          <div className="field">
            {/* 開關列不用 <Switch>：它會多送一個 value="0" 的 hidden 欄位，而這支 action 是
                formData.get(...) ? 1 : 0，拿到第一個值 "0" 是 truthy，會變成永遠開。
                所以直接寫 .sw-row 的標記：長相一樣、送出的值跟以前的 checkbox 完全相同。 */}
            <label className="sw-row">
              <span>額滿的規格自動收合（適合出貨週這種過期就沒用的選項）<small>額滿兩個以上才會收合，全部額滿時不收合。尺寸、款式這類建議不要開：客人想知道自己要的那個沒了。</small></span>
              <input type="checkbox" name="soldout_collapse" defaultChecked={!!p?.soldout_collapse} />
              <i className="sw" aria-hidden />
            </label>
          </div>
        </div>
        <div className="ad-sect"><h2>規 格 與 庫 存</h2><div className="rule" /></div>
        <ChoicesEditor
          choicesName="option_choices"
          stocksName="choice_stocks"
          expiryName="choice_expiry"
          choices={json<string[]>(p?.option_choices ?? "[]", [])}
          stocks={parseChoiceStocks(p?.choice_stocks)}
          expiry={parseChoiceExpiry(p?.choice_expiry)}
        />
        <div className="ad-sect"><h2>圖 片 與 內 容</h2><div className="rule" /></div>
        <ImagePicker name="image" label="商品主圖（列表、詳情、首頁精選都用這張）" value={p?.image ?? ""} height={180} />
        <GalleryEditor name="images" value={json<string[]>(p?.images ?? "[]", [])} />
        <div className="field">
          <label>短描述（詳情頁售價下方）</label>
          <textarea className="ta-s" name="description" defaultValue={p?.description ?? ""} />
        </div>
        <StoryEditor name="story" value={json(p?.story ?? "[]", [])} />
        <SpecEditor name="spec" value={json(p?.spec ?? "[]", [])} />
        <div className="field">
          <label>注意事項（詳情頁最下方小字；留空＝用預設的宅配說明）</label>
          <textarea className="ta-s" name="notice" defaultValue={p?.notice ?? ""} />
        </div>
        <div className="ad-sect"><h2>顯 示</h2><div className="rule" /></div>
        <div className="sw-list">
          <label className="sw-row">
            <span>首頁精選</span>
            <input type="checkbox" name="featured" defaultChecked={p?.featured === 1} />
            <i className="sw" aria-hidden />
          </label>
          <label className="sw-row">
            <span>上架</span>
            <input type="checkbox" name="published" defaultChecked={p ? p.published === 1 : true} />
            <i className="sw" aria-hidden />
          </label>
          {/* 企業階梯價是站長拿自家商品談的。夥伴代銷的貨沒有那個折扣，
              入口開著只會收到一封談不成的詢問，所以逐商品自己決定。 */}
          <label className="sw-row">
            <span>顯示「企業訂購與大量報價」入口</span>
            <input type="checkbox" name="corp_entry" defaultChecked={p?.corp_entry === 1} />
            <i className="sw" aria-hidden />
          </label>
        </div>
        {/* 黏底儲存列：改了幾項會亮起來，要離開又沒存會先問（ia.md §2 套到所有有儲存鈕的表單） */}
        <StickySave />
      </form>
      {p && (
        <DangerZone title="刪除這個商品" warn="刪掉就沒有了，已成立的訂單裡那一項會變成查不到商品。只是不想再賣的話，關掉上面的「上架」就好。">
          <form action={deleteProduct}>
            <input type="hidden" name="id" value={p.id} />
            <ConfirmSubmit className="btn danger" message="確定要刪除這個商品？此動作無法復原。">刪除這個商品</ConfirmSubmit>
          </form>
        </DangerZone>
      )}
    </>
  );
}
