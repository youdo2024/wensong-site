import Link from "next/link";
import { t } from "@/lib/copy";
import { articleShopHref } from "@/lib/shop";

/*
 * 文章頁的「支持商品」CTA：檔期才開，平常關著。
 *
 * 放在小額支持創作者「之前」，因為檔期的當下商品是主角；
 * 而支持創作者那一塊不會因此消失——兩個都在，讀者自己選要用哪一種方式支持。
 *
 * 開關與連結去向在 lib/shop.ts（articleShopCta／articleShopHref），
 * 文字在後台「文案信件」頁可改。要不要出現由呼叫端決定，這裡只負責畫。
 */
export default function ArticleShopCta() {
  return (
    <div className="article-cta" style={{ borderColor: "var(--gold)" }}>
      <b style={{ display: "block", fontSize: 19, fontWeight: 900, letterSpacing: ".14em", marginBottom: 10, color: "var(--gold)" }}>
        {t("article_shop_title")}
      </b>
      <p style={{ whiteSpace: "pre-line" }}>{t("article_shop_text")}</p>
      <Link className="btn fill" href={articleShopHref()} data-ga="article-shop-cta">
        {t("article_shop_btn")}
      </Link>
    </div>
  );
}
