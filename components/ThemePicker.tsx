"use client";
import { usePathname } from "next/navigation";
import { THEMES } from "@/lib/themes";

/* 選稿列：固定在畫面底部，點一個就換整站風格（種 cookie 後回到同一頁）。只在 THEME_PICKER=1 時由 layout 掛上 */
export default function ThemePicker({ current }: { current: string }) {
  const path = usePathname();
  return (
    <div className="theme-picker">
      <span className="tp-l">風格</span>
      {THEMES.map((t) => (
        <a key={t.key} href={`/theme/${t.key}?back=${encodeURIComponent(path || "/")}`} className={current === t.key ? "on" : ""} title={t.blurb}>
          {t.name}
        </a>
      ))}
    </div>
  );
}
