"use client";
import { useEffect, useState } from "react";
import Link from "next/link";

/*
 * 文章頁的常駐支持貼條。
 *
 * 原本是一顆「小額支持創作者」連到 /support，有兩個問題：
 *   一是離開了文章，站內表單記到的來源頁會變成 /support，後台分不出這筆是哪篇文章帶來的；
 *   二是跳頁本身就會流失人。
 * 改成與文末 CTA 同樣的雙鈕：單次支持原地展開表單（表單還在文章頁上，來源頁自然是這篇文章），
 * 長期支持才離開（外部定額頁，或站內支持頁）。
 *
 * form 由伺服器元件渲染好之後當 children 傳進來：SupportForm 需要的付款方式、金額級距
 * 都要讀資料庫設定，那些不能在客戶端拿。收合時不渲染 children，展開才掛上去。
 */
export default function StickySupport({
  text,
  monthlyHref,
  monthlyExternal = false,
  children,
}: {
  text: string;
  monthlyHref: string;
  monthlyExternal?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);

  /* 展開時鎖住背景捲動，面板自己可捲；關掉時還原 */
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onEsc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", onEsc);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  return (
    <>
      <div className="sticky-cta">
        <div className="inner">
          <span>{text}</span>
          <div className="sticky-btns">
            {monthlyExternal ? (
              <a href={monthlyHref} target="_blank" rel="noopener" data-ga="sponsor-external">長期支持</a>
            ) : (
              <Link href={monthlyHref}>長期支持</Link>
            )}
            <button type="button" className="once" onClick={() => setOpen(true)}>單次支持</button>
          </div>
        </div>
      </div>

      {open && (
        <div className="sticky-sheet-wrap" role="dialog" aria-modal="true" aria-label="單次支持">
          {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events */}
          <div className="sticky-sheet-bg" onClick={() => setOpen(false)} />
          <div className="sticky-sheet">
            <div className="sticky-sheet-head">
              <b>單次支持</b>
              <button type="button" onClick={() => setOpen(false)} aria-label="關閉">✕</button>
            </div>
            <div className="sticky-sheet-body">{children}</div>
          </div>
        </div>
      )}
    </>
  );
}
