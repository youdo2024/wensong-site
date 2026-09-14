import db, { getSetting } from "./db";
import { BRAND } from "./brand";

/*
 * 收聽平台清單：後台「設定・內容」填網址，沒填的不出現。順序固定，SoundOn 永遠有。
 */
export const PLATFORM_DEFS: { key: string; label: string; setting: string }[] = [
  { key: "apple", label: "Apple Podcasts", setting: "platform_apple" },
  { key: "spotify", label: "Spotify", setting: "platform_spotify" },
  { key: "kkbox", label: "KKBOX", setting: "platform_kkbox" },
  { key: "youtube", label: "YouTube", setting: "platform_youtube" },
  { key: "soundon", label: "SoundOn", setting: "platform_soundon" },
];

export function platformLinks(): { key: string; label: string; url: string }[] {
  return PLATFORM_DEFS
    .map((p) => ({ key: p.key, label: p.label, url: getSetting(p.setting, p.key === "soundon" ? BRAND.soundonLink : "").trim() }))
    .filter((p) => p.url);
}

/* 文章區有沒有已發布的文章：沒有就不在導覽列露出「文章」 */
export function articlesEnabled(): boolean {
  const r = db.prepare("SELECT COUNT(*) AS n FROM articles WHERE published=1").get() as { n: number };
  return r.n > 0;
}

export type HostInfo = { key: string; name: string; title: string; intro: string; photo: string; link: string };

export function hosts(): HostInfo[] {
  return BRAND.hosts.map((h, i) => {
    const n = i + 1;
    return {
      key: h.key,
      name: getSetting(`host_${n}_name`, h.name) || h.name,
      title: getSetting(`host_${n}_title`, h.title),
      intro: getSetting(`host_${n}_intro`, h.intro),
      photo: getSetting(`host_${n}_photo`, ""),
      link: getSetting(`host_${n}_link`, h.link),
    };
  });
}

/* 電子報訂閱區塊（首頁第 8 塊）：站長模式先關 */
export function newsletterBlock(): boolean {
  return getSetting("newsletter_block", "0") === "1";
}
