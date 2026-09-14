"use client";
import { useEffect } from "react";

/* 區域瀏覽計數：同一分頁同一區域 30 分鐘內只記一次，避免重整灌水。
   站長自己的瀏覽由 /api/pv 在伺服器端排除。 */
export default function PageViewPing({ page }: { page: string }) {
  useEffect(() => {
    const key = `pv:${page}`;
    try {
      const last = Number(sessionStorage.getItem(key) || 0);
      if (Date.now() - last < 30 * 60 * 1000) return;
      sessionStorage.setItem(key, String(Date.now()));
    } catch { /* 隱私模式沒有 sessionStorage 就照記 */ }
    fetch("/api/pv", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ page }),
      keepalive: true,
    }).catch(() => {});
  }, [page]);
  return null;
}
