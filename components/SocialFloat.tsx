"use client";
import { usePathname } from "next/navigation";
import { useSiteConfig } from "./SiteConfig";

/* 右側懸浮社群按鈕（後台「網站設定」可改連結） */
export default function SocialFloat() {
  const path = usePathname();
  const { social } = useSiteConfig();
  if (path.startsWith("/admin")) return null;

  const items = [
    {
      key: "fb", url: social.fb, label: "Facebook",
      icon: (
        <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden>
          <path d="M13.5 21v-7h2.4l.4-3h-2.8V9.1c0-.9.3-1.5 1.6-1.5h1.3V4.9c-.3 0-1.1-.1-2-.1-2 0-3.4 1.2-3.4 3.5V11H8.5v3H11v7h2.5z" />
        </svg>
      ),
    },
    {
      key: "ig", url: social.ig, label: "Instagram",
      icon: (
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
          <rect x="4" y="4" width="16" height="16" rx="4.5" />
          <circle cx="12" cy="12" r="3.6" />
          <circle cx="16.7" cy="7.3" r="1.1" fill="currentColor" stroke="none" />
        </svg>
      ),
    },
    {
      key: "yt", url: social.yt, label: "YouTube",
      icon: (
        <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden>
          <path d="M21.6 8.2a2.5 2.5 0 0 0-1.7-1.8C18.3 6 12 6 12 6s-6.3 0-7.9.4A2.5 2.5 0 0 0 2.4 8.2 26 26 0 0 0 2 12a26 26 0 0 0 .4 3.8 2.5 2.5 0 0 0 1.7 1.8c1.6.4 7.9.4 7.9.4s6.3 0 7.9-.4a2.5 2.5 0 0 0 1.7-1.8A26 26 0 0 0 22 12a26 26 0 0 0-.4-3.8zM10 15V9l5.2 3L10 15z" />
        </svg>
      ),
    },
  ].filter((i) => i.url);

  if (items.length === 0) return null;
  return (
    <div className="social-float">
      {items.map((i) => (
        <a key={i.key} href={i.url} target="_blank" rel="noopener" aria-label={i.label} title={i.label}>
          {i.icon}
        </a>
      ))}
    </div>
  );
}
