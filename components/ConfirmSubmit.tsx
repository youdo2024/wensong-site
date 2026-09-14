"use client";
import type { CSSProperties, ReactNode } from "react";

/*
 * 會問一次「確定嗎」的送出鈕。刪除、清空這類做了就回不來的動作一律用它（站長 2026-09-04）。
 * 用瀏覽器原生的 confirm：手機上就是系統對話框，不用自己畫，也不會被漏掉。
 */
export default function ConfirmSubmit({
  message, className = "btn", style, children, formAction, formNoValidate,
}: { message: string; className?: string; style?: CSSProperties; children: ReactNode; formAction?: (formData: FormData) => void | Promise<void>; formNoValidate?: boolean }) {
  return (
    <button
      type="submit"
      className={className}
      style={style}
      formAction={formAction}
      formNoValidate={formNoValidate}
      onClick={(e) => { if (!window.confirm(message)) e.preventDefault(); }}
    >
      {children}
    </button>
  );
}
