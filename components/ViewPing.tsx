"use client";
import { useEffect } from "react";

/* 通用觀看計數：載入時記一次；同一分頁同一項目 30 分鐘內只記一次，避免重整灌水 */
export default function ViewPing({ endpoint, id }: { endpoint: string; id: number }) {
  useEffect(() => {
    if (!id) return;
    const key = `viewed:${endpoint}:${id}`;
    try {
      const last = Number(sessionStorage.getItem(key) || 0);
      if (Date.now() - last < 30 * 60 * 1000) return;
      sessionStorage.setItem(key, String(Date.now()));
    } catch { /* 隱私模式沒有 sessionStorage 就照記 */ }
    fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
      keepalive: true,
    }).catch(() => {});
  }, [endpoint, id]);
  return null;
}
