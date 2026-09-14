"use client";
import Link from "next/link";
import { useState } from "react";
import { useCart } from "./CartProvider";
import { useSiteConfig } from "./SiteConfig";
import { BRAND } from "@/lib/brand";

/*
 * 導覽列（決策定案 Q35）：集數、來賓、關於固定；文章有內容才出現；
 * 商店與支持我們在站長模式下對外隱藏（config 由 layout 判斷）。
 * hideSupport：商店動線在後台關閉加購支持時，連導覽列的支持鈕也一起收起來。
 */
export default function Nav({ showCart = false, hideSupport = false }: { showCart?: boolean; hideSupport?: boolean }) {
  const [open, setOpen] = useState(false);
  const { count } = useCart();
  const { shopEnabled, supportEnabled, supportHref, supportExternal, memberEnabled, articlesEnabled } = useSiteConfig();
  const extra = supportExternal ? { target: "_blank", rel: "noopener", "data-ga": "sponsor-external" } : {};
  const showSupport = supportEnabled && !hideSupport;

  const items = (
    <>
      <Link href="/ep">集數</Link>
      <Link href="/guests">來賓</Link>
      {articlesEnabled && <Link href="/articles">文章</Link>}
      {shopEnabled && <Link href="/shop">商店</Link>}
      <Link href="/about">關於</Link>
      <Link href="/search" aria-label="站內搜尋">搜尋</Link>
      {memberEnabled && <Link href="/account">會員</Link>}
    </>
  );

  return (
    <>
      <a className="skip-link" href="#main">跳到主要內容</a>
      <nav className="site-nav">
        <div className="inner">
          <Link className="brand" href="/">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="brand-logo" src={BRAND.logo} alt={BRAND.fullName} />
            <b className="brand-word">{BRAND.name}</b>
            <span className="sr-only">{BRAND.fullName}</span>
          </Link>
          <ul>
            <li><Link href="/ep">集數</Link></li>
            <li><Link href="/guests">來賓</Link></li>
            {articlesEnabled && <li><Link href="/articles">文章</Link></li>}
            {shopEnabled && <li><Link href="/shop">商店</Link></li>}
            <li><Link href="/about">關於</Link></li>
            <li><Link href="/search" aria-label="站內搜尋">搜尋</Link></li>
            {memberEnabled && <li><Link href="/account">會員</Link></li>}
            {showCart && shopEnabled && (
              <li>
                <Link className="cart-link" href="/cart">
                  購物車　<b className="sans cart-num" key={count}>{count}</b>
                </Link>
              </li>
            )}
            {showSupport && <li><Link className="cta" href={supportHref} {...extra}>支持我們</Link></li>}
          </ul>
          <button className="menu-x" onClick={() => setOpen(!open)}>
            {open ? "關閉" : "選單"}
          </button>
        </div>
        {open && (
          <div className="m-menu" onClick={() => setOpen(false)}>
            <Link href="/">首頁</Link>
            {items}
            {shopEnabled && <Link href="/cart">購物車（{count}）</Link>}
            {showSupport && <Link className="cta" href={supportHref} {...extra}>支持我們</Link>}
          </div>
        )}
      </nav>
      <span id="main" tabIndex={-1} />
    </>
  );
}
