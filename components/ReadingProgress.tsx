"use client";
import { useEffect } from "react";

/* 閱讀進度條 + TOC 目前章節高亮 */
export default function ReadingProgress({ ids }: { ids: string[] }) {
  useEffect(() => {
    const bar = document.getElementById("progress");
    const onScroll = () => {
      const h = document.documentElement;
      const pct = (h.scrollTop / (h.scrollHeight - h.clientHeight)) * 100;
      if (bar) bar.style.width = pct + "%";
      let cur = ids[0];
      for (const id of ids) {
        const el = document.getElementById(id);
        if (el && el.getBoundingClientRect().top < 140) cur = id;
      }
      document.querySelectorAll(".toc a").forEach((a) => {
        a.classList.toggle("on", a.getAttribute("href") === "#" + cur);
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, [ids]);

  return <div id="progress" />;
}
