"use client";
import { useEffect } from "react";
import Ico from "./Ico";

/*
 * 手機全螢幕抽屜。目前只有側欄選單用它。
 *
 * 為什麼是全螢幕不是側滑一半：後台有 26 個入口，五組分類要一次看得完；
 * 只露一半的話站長還是得捲，那就跟原本被切掉看不到的長選單一樣了。
 * 關閉有三條路：點任何連結、按右上角的關閉、按 Esc。少一條都會有人被關在裡面。
 */
export default function Drawer({
  open, onClose, title, children,
}: { open: boolean; onClose: () => void; title: React.ReactNode; children: React.ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", esc);
    /* 抽屜開著時背後不要跟著捲，不然關掉會發現位置跑掉 */
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", esc);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      className="ad-drawer"
      role="dialog"
      aria-modal="true"
      aria-label="後台選單"
      /* 點到任何連結就關：不用每個 <a> 各掛一次 onClick */
      onClick={(e) => { if ((e.target as HTMLElement).closest("a")) onClose(); }}
    >
      <div className="dh">
        <span className="bd">{title}</span>
        <button type="button" className="mn" onClick={onClose} aria-label="關閉選單">
          <Ico n="close" />關閉
        </button>
      </div>
      {children}
    </div>
  );
}
