import Link from "next/link";
import JsonLd from "./JsonLd";
import { absUrl } from "@/lib/seo";

/*
 * 麵包屑（P2-4）：頁面上可點的路徑列＋BreadcrumbList schema 一次輸出。
 * 樣式低調（小字、灰色），不搶版面。
 */
export default function Crumbs({ items }: { items: { name: string; path?: string }[] }) {
  const schema = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((it, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: it.name,
      ...(it.path ? { item: absUrl(it.path) } : {}),
    })),
  };
  return (
    <>
      <JsonLd data={schema} />
      <nav aria-label="路徑" style={{ fontSize: 12.5, color: "var(--grey)", letterSpacing: ".06em", marginBottom: 14 }}>
        {items.map((it, i) => (
          <span key={i}>
            {i > 0 && <span style={{ margin: "0 6px" }}>›</span>}
            {it.path && i < items.length - 1 ? (
              <Link href={it.path} style={{ color: "inherit", textDecoration: "none" }}>{it.name}</Link>
            ) : (
              <span>{it.name}</span>
            )}
          </span>
        ))}
      </nav>
    </>
  );
}
