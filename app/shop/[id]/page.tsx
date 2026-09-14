import Link from "next/link";
import { notFound } from "next/navigation";
import Nav from "@/components/Nav";
import Footer from "@/components/Footer";
import BuyPanel from "@/components/BuyPanel";
import Gallery from "@/components/Gallery";
import ViewPing from "@/components/ViewPing";
import db, { json } from "@/lib/db";
import { parseChoiceStocks } from "@/lib/choice-stock";
import { money } from "@/lib/format";
import { navSupportShop, shopEnabled } from "@/lib/shop";
import { draftViewable, shopViewable } from "@/lib/shop-preview";
import ShopClosed from "@/components/ShopClosed";
import PageViewPing from "@/components/PageViewPing";
import { FbEvent } from "@/components/MetaPixel";
import JsonLd from "@/components/JsonLd";
import { buildMetadata, absUrl, clampDesc } from "@/lib/seo";
import { imgSrc, SIZES } from "@/lib/img-src";
import { activeChoices, parseChoiceExpiry } from "@/lib/choice-split";
import { taipeiYMD } from "@/lib/month";

export const dynamic = "force-dynamic";

type Product = {
  id: number;
  name: string;
  category: string;
  price: number;
  stock: number;
  description: string;
  option_name: string | null;
  option_choices: string;
  story: string;
  spec: string;
  image: string;
  images: string;
  price_original: number;
  price_note: string;
  notice: string;
  choice_stocks: string;
  choice_expiry: string;
  published: number;
  soldout_label: string;
  soldout_collapse: number;
  ship_note: string;
  corp_entry: number;
};

/*
 * 商品頁的 metadata。
 *
 * 原本只給一個 title，沒有 canonical、沒有 description、沒有社群分享圖，
 * 是全站唯一漏掉的一種頁面（文章、廚師、分類、作者都走 buildMetadata）。
 * 沒有 canonical 的頁面被 Google 判定重複時，會歸到
 * 「重複網頁，使用者未選取標準網頁」，因為它找不到我們指定哪一個才是正版。
 *
 * description 直接用商品描述截短。商品描述本來就是寫給人看的第一段介紹，
 * 比任何自動生成的句子都準確。
 */
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const p = db.prepare("SELECT name,description,image,category,published FROM products WHERE id=?").get(Number(id)) as
    | { name: string; description: string; image: string; category: string; published: number }
    | undefined;
  if (!p) return buildMetadata({ title: "商品", path: `/shop/${id}`, noindex: true });
  /* 商店休息中的話頁面顯示的是「休息中」，內容跟商品無關，
     這種狀態下不該被收錄，否則搜尋結果會停在一頁休息公告上 */
  if (!(await shopViewable())) return buildMetadata({ title: p.name, path: `/shop/${Number(id)}`, noindex: true });
  /* 未上架的預覽頁一律 noindex：它只給站長看，被 Google 收錄的話
     商品還沒開賣就出現在搜尋結果，點進去的人看到的是預覽橫幅 */
  if (!p.published) return buildMetadata({ title: p.name, path: `/shop/${Number(id)}`, noindex: true });

  const desc = (p.description || "").replace(/\s+/g, " ").trim();
  return buildMetadata({
    title: p.name,
    description: desc ? (desc.length > 100 ? `${desc.slice(0, 99)}…` : desc) : undefined,
    path: `/shop/${Number(id)}`,
    ogType: "website",
    /* 商品主圖是站內路徑（/shop/xxx.jpg）或圖片庫的 key，兩種都要接得起來 */
    ...(p.image
      ? { ogImage: { url: p.image.startsWith("/") ? absUrl(p.image) : absUrl(`/api/images/${p.image}`), alt: p.name } }
      : {}),
  });
}

export default async function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  /*
   * 未上架商品：站長（與持商店預覽金鑰的人）看得到完整頁面，其餘 404。
   * 新商品上架前要能自己走一次真實流程——排版、規格、運費、加入購物車，
   * 光看後台編輯畫面看不出來。頁面上方會標「未上架預覽」，免得誤以為已公開。
   */
  const canPreview = await draftViewable();
  const p = db.prepare(`SELECT * FROM products WHERE id=?${canPreview ? "" : " AND published=1"}`).get(Number(id)) as
    | Product
    | undefined;
  /*
   * 先查商品再看商店開不開。
   *
   * 反過來寫的話，商店一休息，/shop/隨便什麼數字 都會回 200 加同一頁「休息中」，
   * 對搜尋引擎來說那是無限多個內容完全相同的網址，而且每一個都有自己的 canonical。
   * 不存在的商品不管商店開不開都該是 404。
   */
  if (!p) notFound();
  const unpublished = !p.published;
  /* 站長預覽：商店休息中時，登入後台的人照樣看得到（訪客看到休息中頁） */
  if (!(await shopViewable())) return <ShopClosed />;
  const preview = !shopEnabled();

  /* 過了下架日的規格整個消失（不是額滿，就是不存在了）。當天仍可買、隔天起隱藏 */
  const todayIso = taipeiYMD().iso;
  const originalChoices = json<string[]>(p.option_choices, []);
  const choices = activeChoices(originalChoices, parseChoiceExpiry(p.choice_expiry), todayIso);
  /* 全部規格都過了下架日＝這個商品目前買不了。不能讓它默默降級成「無規格商品」：
     那會生出一筆沒有出貨週的訂單，夥伴不知道該哪一週出 */
  const allExpired = originalChoices.length > 0 && choices.length === 0;
  /* 額滿的規格：只送「哪些不能選」給前端，數字永遠不出現在頁面上 */
  const choiceStocks = parseChoiceStocks(p.choice_stocks);
  const soldout = choices.filter((c) => Object.prototype.hasOwnProperty.call(choiceStocks, c) && choiceStocks[c] <= 0);
  const story = json<{ img: string; h: string; p: string }[]>(p.story, []);
  const spec = json<string[][]>(p.spec, []);
  /* 圖組＝主圖排第一，後面接補充圖。去掉空值與重複，免得後台不小心把主圖又加一次 */
  const gallery = [...new Set([p.image, ...json<string[]>(p.images ?? "[]", [])].map((s) => (s || "").trim()).filter(Boolean))];

  /* 您可能也喜歡：依實際銷量排前四（排除本品）；沒有銷售資料時退回精選＋排序 */
  const sales = new Map<number, number>();
  const orderRows = db.prepare("SELECT items FROM orders WHERE status IN ('paid','shipped','done')").all() as { items: string }[];
  for (const row of orderRows) {
    for (const it of json<{ id: number; qty: number }[]>(row.items, [])) {
      sales.set(it.id, (sales.get(it.id) || 0) + it.qty);
    }
  }
  const candidates = db
    .prepare("SELECT id,name,category,price,stock,image FROM products WHERE published=1 AND id!=? ORDER BY featured DESC, sort, id")
    .all(p.id) as { id: number; name: string; category: string; price: number; stock: number; image: string }[];
  const alsoLike = [...candidates]
    .sort((a, b) => (sales.get(b.id) || 0) - (sales.get(a.id) || 0))
    .slice(0, 4);

  return (
    <>
      <Nav showCart hideSupport={!navSupportShop()} />
      <ViewPing endpoint="/api/products/view" id={p.id} />
      <PageViewPing page="shop" />
      {/* Meta 的中繼事件：本來只有最後的 Purchase，中間完全是黑的，
          廣告投放看不出人是在哪一步走掉的。ViewContent 是第一步。 */}
      <FbEvent name="ViewContent" value={p.price} contentName={p.name} />
      {/*
        * Product 結構化資料。商品頁是全站唯一還沒有結構化資料的頁面類型。
        *
        * availability 用實際庫存判斷，不要寫死 InStock：售完卻標示有貨，
        * Google 會在搜尋結果顯示錯的狀態，使用者點進來看到「補貨中」就走了，
        * 而那次點擊已經算在我們的 CTR 裡。
        *
        * priceValidUntil 用早鳥截止日那類資訊會更好，但那是自由文字欄位，
        * 解析不出可靠的日期就不要編一個，寧可不給這個欄位。
        */}
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "Product",
          name: p.name,
          /* 這裡不要吐 DB 全文。原本整段長說明（含換行與千餘字）都塞進去，
             Google 只吃前面一小段，其餘是雜訊。clampDesc 會切在完整句子。 */
          description: clampDesc(p.description, 300),
          category: p.category,
          url: absUrl(`/shop/${p.id}`),
          ...(p.image ? { image: [p.image.startsWith("/") ? absUrl(p.image) : absUrl(`/api/images/${p.image}`)] } : {}),
          brand: { "@type": "Brand", name: "問爽的" },
          offers: {
            "@type": "Offer",
            price: p.price,
            priceCurrency: "TWD",
            availability: p.stock > 0 ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
            url: absUrl(`/shop/${p.id}`),
            seller: { "@type": "Organization", name: "於悅商行" },
          },
        }}
      />
      <div className="frame" style={{ padding: "48px 20px 100px" }}>
        {preview && (
          <p className="msg-ok" style={{ borderColor: "var(--indigo)", color: "var(--indigo)", marginBottom: 24 }}>
            站長預覽模式：商店目前休息中，這頁只有登入後台的你看得到。
          </p>
        )}
        <div className="crumb">
          <Link href="/shop">商店</Link>　／　<span>{p.name}</span>
        </div>
        <div className="detail">
          <div className="gallery">
            <Gallery images={gallery} alt={p.name} />
          </div>
          <div className="d-info">
            <span className="cat-tag">{p.category}</span>
            {/* 商品名是這一頁的 h1。原本是 h2，整頁沒有任何 h1——
                而這是全站唯一的成交頁，搜尋引擎與螢幕閱讀器都靠 h1 判斷「這頁在講什麼」。 */}
            <h1>{p.name}</h1>
            <div className="price">
              {money(p.price)}
              {p.price_original > p.price && <s>{money(p.price_original)}</s>}
              {p.price_note && <em>{p.price_note}</em>}
            </div>
            {unpublished && (
              <p className="msg-err" style={{ marginBottom: 12 }}>
                <b>未上架預覽</b>：這個商品目前沒有公開，只有你（或持預覽連結的人）看得到。
                測完到後台把「上架」打勾才會出現在商店。
              </p>
            )}
            {/* 配送標語。有貨時印的是後台填的 ship_note（留空就整行不出現）——
                原本這裡寫死「常溫宅配・全台出貨」，冷凍商品也照印，
                而這行就在加入購物車正上方，是客人最會當真的位置。 */}
            {(allExpired || p.stock <= 0 || p.ship_note) && (
              <div className="stock">
                {allExpired ? "本檔期已截止，暫不開放購買" : p.stock > 0 ? p.ship_note : "目前補貨中，暫不開放購買"}
              </div>
            )}
            <div className="desc">{p.description}</div>
            <BuyPanel
              id={p.id}
              name={p.name}
              price={p.price}
              stock={allExpired ? 0 : p.stock}
              optionName={p.option_name}
              choices={choices}
              soldout={soldout}
              soldoutLabel={p.soldout_label || "已滿"}
              collapseSoldout={!!p.soldout_collapse}
              image={p.image}
              corpEntry={p.corp_entry === 1}
            />
          </div>
        </div>

        <div className="d-lower">
          <div className="sec-tt"><span>商 品 說 明</span></div>
          {story.map((s, i) => (
            <div className="story-block" key={i}>
              {/* 收「/」開頭的站內路徑與 http 網址。圖片欄位常拿來放「這裡要拍什麼」的
                  備忘（例：照片 5｜農夫工作照・不擺拍），那種字不以斜線開頭，照樣擋得掉，
                  只是不會再把備忘印在頁面上給顧客看。 */}
              {s.img && (s.img.startsWith("/") || s.img.startsWith("http")) ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                /* 16:9：原本寫死 height:340，欄寬越寬圖就越扁（寬螢幕會到 2.9:1）。
                   改用比例之後，不管容器多寬都維持 16:9。 */
                <img {...imgSrc(s.img, SIZES.article)} alt={s.h} className="img-fill" loading="lazy" style={{ aspectRatio: "16 / 9", height: "auto", border: "2px solid var(--ink)", marginBottom: 14 }} />
              ) : null}
              {/* 圖片欄位常拿來放「這裡要拍什麼」的備忘（例：照片 5｜農夫工作照・不擺拍），
                  以前會把那段字直接印在佔位框裡給顧客看。現在沒有真正的圖就整個不渲染，
                  備忘只留在後台編輯畫面。 */}
              <h2>{s.h}</h2>
              <p>{s.p}</p>
            </div>
          ))}
          <div className="sec-tt"><span>規 格 說 明</span></div>
          <div className="spec-table">
            {spec.map((r, i) => (
              <div className="row" key={i}>
                <div className="k">{r[0]}</div>
                <div className="v">{r[1]}</div>
              </div>
            ))}
          </div>
          <p className="notice">
            {p.notice || "標價為新臺幣（TWD）含稅價。常溫宅配全台，訂單成立後 3 至 5 個工作天出貨。商品照片因拍攝與螢幕顯色略有差異，以實品為準。"}
          </p>
        </div>

        {/* 您可能也喜歡：銷量前四 */}
        {alsoLike.length > 0 && (
          <div className="also-like">
            <div className="sec-head">
              <span className="tag">您 可 能 也 喜 歡</span>
            </div>
            <div className="prod-grid">
              {alsoLike.map((r) => (
                <Link className="prod" key={r.id} href={`/shop/${r.id}`}>
                  <span className="cat-tag">{r.category}</span>
                  {r.stock === 0 && <span className="oos">補貨中</span>}
                  {r.image ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img src={r.image} alt={r.name} className="img img-fill" />
                  ) : (
                    <div className="img ph">商品照</div>
                  )}
                  <div className="body">
                    <b>{r.name}</b>
                    <div className="price">{money(r.price)}</div>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>
      <Footer hideBusinessModel={!navSupportShop()} />
    </>
  );
}
