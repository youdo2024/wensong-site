import type { Metadata } from "next";
import { buildMetadata } from "@/lib/seo";
import Link from "next/link";
import Nav from "@/components/Nav";
import Footer from "@/components/Footer";
import db from "@/lib/db";
import { imgSrc, SIZES } from "@/lib/img-src";
import { money } from "@/lib/format";
import { navSupportShop, productCategories, shopEnabled, shopGateway } from "@/lib/shop";
import TapPayBadge from "@/components/TapPayBadge";
import { shopViewable } from "@/lib/shop-preview";
import ShopClosed from "@/components/ShopClosed";
import PageViewPing from "@/components/PageViewPing";

export const metadata: Metadata = buildMetadata({ title: "周邊商店", path: "/shop", description: "問爽的周邊商店：節目周邊與我們想推薦的東西。" });
export const dynamic = "force-dynamic";

export default async function ShopPage({
  searchParams,
}: {
  searchParams: Promise<{ cat?: string }>;
}) {
  /* 站長預覽：商店休息中時，登入後台的人照樣看得到（訪客看到休息中頁） */
  /* 公開中、站長、或持商店預覽連結（金流審查人員）都看得到 */
  if (!(await shopViewable())) return <ShopClosed />;
  const preview = !shopEnabled();
  const { cat = "all" } = await searchParams;
  const CATS = ["all", ...productCategories()];
  const products = (
    cat === "all"
      ? db.prepare("SELECT * FROM products WHERE published=1 ORDER BY sort, id").all()
      : db.prepare("SELECT * FROM products WHERE published=1 AND category=? ORDER BY sort, id").all(cat)
  ) as { id: number; name: string; category: string; price: number; stock: number; image: string }[];

  return (
    <>
      <PageViewPing page="shop" />
      <Nav showCart hideSupport={!navSupportShop()} />
      <div className="frame" style={{ padding: "48px 20px 100px" }}>
        {preview && (
          <p className="msg-ok" style={{ borderColor: "var(--indigo)", color: "var(--indigo)", marginBottom: 28 }}>
            站長預覽模式：商店目前休息中，這頁只有登入後台的你看得到；訪客看到的是「商店公告」頁。
          </p>
        )}
        <div className="page-head">
          <span className="tag">佑 的 選 物</span>
          <h1>周邊商店</h1>
          <p>每一件都有產地、有名字、有故事。常溫宅配，訪客即可結帳</p>
        </div>
        <div className="filters">
          {CATS.map((c) => (
            <Link
              key={c}
              className={`f${cat === c ? " on" : ""}`}
              href={c === "all" ? "/shop" : `/shop?cat=${encodeURIComponent(c)}`}
              style={{ textDecoration: "none" }}
            >
              {c === "all" ? "全部" : c}
            </Link>
          ))}
        </div>
        <div className="prod-grid">
          {products.length === 0 && <div className="empty">這個分類還沒有商品</div>}
          {products.map((p) => (
            <Link className="prod" key={p.id} href={`/shop/${p.id}`}>
              <span className="cat-tag">{p.category}</span>
              {p.stock === 0 && <span className="oos">補貨中</span>}
              {p.image ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img {...imgSrc(p.image, SIZES.card)} alt={p.name} className="img img-fill" loading="lazy" />
              ) : (
                <div className="img ph">商品照</div>
              )}
              <div className="body">
                <b>{p.name}</b>
                <div className="price">{money(p.price)}</div>
              </div>
            </Link>
          ))}
        </div>

        {/* TapPay 審核要求：使用其金流時商店頁須出現 TapPay 標示 */}
        {shopGateway() === "tappay" && (
          <p className="center" style={{ marginTop: 40 }}>
            <TapPayBadge />
          </p>
        )}
      </div>
      <Footer hideBusinessModel={!navSupportShop()} />
    </>
  );
}
