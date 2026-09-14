import Link from "next/link";

/*
 * 後台頁首分頁列。
 *
 * 站長回報側欄按鈕太多（一度長到 17 顆）。做法：相關頁面在側欄合成一顆，
 * 進頁後用這條分頁列互切。網址完全不變——只是導覽的入口變了，
 * 站長存過的書籤、我們文件裡寫過的路徑全部照舊。
 *
 * 純 server component：目前頁自己知道自己是誰（active），不需要 usePathname。
 */
export default function AdminTabs({
  tabs,
  active,
}: {
  tabs: { key: string; label: string; href: string; blank?: boolean }[];
  active: string;
}) {
  return (
    <nav className="adm-tabs sans">
      {tabs.map((t) =>
        t.blank ? (
          <a key={t.key} href={t.href} target="_blank" rel="noopener" className="t">
            {t.label} ↗
          </a>
        ) : (
          <Link key={t.key} href={t.href} className={`t${t.key === active ? " on" : ""}`}>
            {t.label}
          </Link>
        )
      )}
    </nav>
  );
}
