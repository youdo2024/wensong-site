"use client";
import { useEffect } from "react";

/* 文章內圖片顯影：進入視窗時淡入＋顯色（沒有 JS 或減少動態時，圖片維持正常顯示） */
export default function ArticleImgFx() {
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const imgs = document.querySelectorAll<HTMLImageElement>("article.post img");
    if (imgs.length === 0) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            e.target.classList.add("img-in");
            io.unobserve(e.target);
          }
        }
      },
      { threshold: 0.15, rootMargin: "0px 0px -30px 0px" }
    );
    imgs.forEach((img) => {
      img.classList.add("img-fx");
      io.observe(img);
    });
    return () => io.disconnect();
  }, []);
  return null;
}
