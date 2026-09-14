"use client";
import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { logout } from "@/app/admin/actions";
import Ico, { type IcoName } from "@/components/admin/Ico";
import Drawer from "@/components/admin/Drawer";
import { BRAND } from "@/lib/brand";

/*
 * 側邊選單：五組，按「什麼時候會用到」分（沿用佑在幹嘛 ia.md §1）。
 * 問爽的的每天看是集數與來賓，不是訂單；訂單那組在第 3 段開收錢前先擺後面。
 */
type NavLink = { href: string; label: string; icon: IcoName; blank?: boolean };
const GROUPS: { title: string; links: NavLink[] }[] = [
  {
    title: "每 天 看",
    links: [
      { href: "/admin", label: "總覽", icon: "home" },
      { href: "/admin/episodes", label: "集數", icon: "file" },
      { href: "/admin/guests", label: "來賓", icon: "user" },
      { href: "/admin/articles", label: "文章", icon: "file" },
    ],
  },
  {
    title: "賣 東 西",
    links: [
      { href: "/admin/orders", label: "訂單", icon: "orders" },
      { href: "/admin/remind", label: "提醒", icon: "bell" },
      { href: "/admin/sponsors", label: "贊助", icon: "heart" },
      { href: "/admin/products", label: "商品", icon: "box" },
      { href: "/admin/pay-links", label: "銷售工具", icon: "card" },
      { href: "/admin/partners", label: "夥伴出貨", icon: "pin" },
      { href: "/admin/discounts", label: "折扣碼", icon: "file" },
      { href: "/admin/settlement", label: "結算報表", icon: "file" },
    ],
  },
  {
    title: "跟 人 聯 絡",
    links: [
      { href: "/admin/leads", label: "名單總覽", icon: "user" },
      { href: "/admin/members", label: "會員名單", icon: "user" },
      { href: "/admin/contact", label: "待聯絡", icon: "phone" },
      { href: "/admin/mail", label: "發送", icon: "mail" },
      { href: "/admin/newsletter", label: "電子報", icon: "mail" },
      { href: "/admin/sms", label: "簡訊", icon: "phone" },
      { href: "/admin/line", label: "LINE", icon: "chat" },
    ],
  },
  {
    title: "設 定",
    links: [
      { href: "/admin/settings/content", label: "內容", icon: "gear" },
      { href: "/admin/settings/shop", label: "商店", icon: "gear" },
      { href: "/admin/settings/sponsor", label: "贊助", icon: "gear" },
      { href: "/admin/settings/pay", label: "金流", icon: "gear" },
      { href: "/admin/settings/notify", label: "通知", icon: "gear" },
      { href: "/admin/settings/system", label: "系統", icon: "gear" },
      { href: "/admin/log", label: "修改記錄", icon: "file" },
    ],
  },
];

/* 手機底欄五顆：拇指構得到的位置只留每天真的會按的 */
const BOTTOM: NavLink[] = [
  { href: "/admin", label: "總覽", icon: "home" },
  { href: "/admin/episodes", label: "集數", icon: "file" },
  { href: "/admin/guests", label: "來賓", icon: "user" },
  { href: "/admin/orders", label: "訂單", icon: "orders" },
  { href: "/admin/sponsors", label: "贊助", icon: "heart" },
];

export default function AdminNav({ badges = {}, adminName }: { badges?: Record<string, number>; adminName?: string }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const isOn = (href: string) => {
    if (href === "/admin" || href === "/admin/settings") return path === href;
    return path === href || path.startsWith(`${href}/`);
  };
  const badge = (href: string) => badges[href] || 0;
  const title = `${BRAND.name.split("").join(" ")} 後 台`;

  return (
    <aside className="adm-side">
      <div className="ad-top">
        <span className="bd">{title}</span>
        <button type="button" className="mn" onClick={() => setOpen(true)} aria-expanded={open}>
          <Ico n="menu" />選單
        </button>
      </div>

      <div className="logo">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={BRAND.logo} alt={BRAND.fullName} style={{ width: 56, height: 56, border: "2px solid var(--ink)" }} />
        <small>管 理 後 台</small>
        {adminName && <small>現在登入：{adminName}</small>}
      </div>
      <nav className="adm-links">
        {GROUPS.map((g) => (
          <div className="adm-group" key={g.title}>
            <div className="adm-group-t">{g.title}</div>
            {g.links.map((l) => (
              <Link key={l.href} href={l.href} className={isOn(l.href) ? "on" : ""}>
                {l.label}
                {badge(l.href) > 0 && <span className="adm-badge sans">{badge(l.href)}</span>}
              </Link>
            ))}
          </div>
        ))}
        <Link href="/" target="_blank">看前台 ↗</Link>
        <div className="out">
          <form action={logout}>
            <button className="danger-link" type="submit">登出</button>
          </form>
        </div>
      </nav>

      <Drawer open={open} onClose={() => setOpen(false)} title={title}>
        {GROUPS.map((g) => (
          <div className="dg" key={g.title}>
            <div className="t">{g.title}</div>
            <div className="links">
              {g.links.map((l) => (
                <Link key={l.href} href={l.href} className={isOn(l.href) ? "on" : ""}>
                  <Ico n={l.icon} size={16} />{l.label}
                  {badge(l.href) > 0 && <span className="adm-badge sans">{badge(l.href)}</span>}
                </Link>
              ))}
            </div>
          </div>
        ))}
        <div className="dg">
          <div className="t">其 他</div>
          <div className="links">
            <Link href="/" target="_blank"><Ico n="right" size={16} />看前台</Link>
          </div>
        </div>
        <div className="dz-out">
          <form action={logout}>
            <button className="btn danger" type="submit">登出</button>
          </form>
        </div>
      </Drawer>

      <nav className="adm-bottom sans">
        {BOTTOM.map((l) => (
          <Link key={l.href} href={l.href} className={isOn(l.href) ? "on" : ""}>
            <Ico n={l.icon} />
            {l.label}
            {badge(l.href) > 0 && <span className="adm-badge sans">{badge(l.href)}</span>}
          </Link>
        ))}
      </nav>
    </aside>
  );
}
