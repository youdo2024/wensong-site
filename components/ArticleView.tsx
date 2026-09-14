"use client";
import { useEffect } from "react";

/* 文章觀看計數：載入時記一次；同一分頁同一篇短時間內只記一次，避免重整灌水 */
export default function ArticleView({ slug }: { slug: string }) {
  useEffect(() => {
    if (!slug) return;
    const key = `viewed:${slug}`;
    try {
      const last = Number(sessionStorage.getItem(key) || 0);
      if (Date.now() - last < 30 * 60 * 1000) return; // 30 分鐘內同分頁不重記
      sessionStorage.setItem(key, String(Date.now()));
    } catch { /* 隱私模式沒有 sessionStorage 就照記 */ }
    fetch("/api/articles/view", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug }),
      keepalive: true,
    }).catch(() => {});
  }, [slug]);
  return null;
}
