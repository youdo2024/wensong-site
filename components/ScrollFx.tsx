"use client";
import { useEffect } from "react";

/* 捲動浮現：進入視窗的 [data-reveal] 元素加上 rv-in（只觸發一次） */
export default function ScrollFx() {
  useEffect(() => {
    const els = document.querySelectorAll("[data-reveal]");
    if (els.length === 0) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            e.target.classList.add("rv-in");
            io.unobserve(e.target);
          }
        }
      },
      { threshold: 0.12, rootMargin: "0px 0px -40px 0px" }
    );
    els.forEach((el) => io.observe(el));

    /* 視差：[data-parallax] 元素以 0.18 倍速跟著捲動 */
    const par = document.querySelector<HTMLElement>("[data-parallax]");
    let raf = 0;
    const onScroll = () => {
      if (!par || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        par.style.setProperty("--par", `${Math.min(window.scrollY * 0.18, 140)}px`);
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });

    return () => {
      io.disconnect();
      window.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(raf);
    };
  }, []);
  return null;
}
