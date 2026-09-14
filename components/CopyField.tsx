"use client";
import { useState } from "react";

/* 後台的唯讀連結欄＋複製按鈕。點欄位本身也會全選，複製失敗時至少好手動複製 */
export default function CopyField({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    let ok = false;
    try {
      await navigator.clipboard.writeText(value);
      ok = true;
    } catch {
      try {
        const ta = document.createElement("textarea");
        ta.value = value;
        ta.setAttribute("readonly", "");
        ta.style.cssText = "position:fixed;top:0;left:0;opacity:0";
        document.body.appendChild(ta);
        ta.select();
        ok = document.execCommand("copy");
        document.body.removeChild(ta);
      } catch { ok = false; }
    }
    setCopied(ok);
    if (ok) window.setTimeout(() => setCopied(false), 2500);
  }

  return (
    <div style={{ display: "flex", gap: 8 }}>
      <input
        className="sans"
        readOnly
        value={value}
        onFocus={(e) => e.currentTarget.select()}
        style={{ flex: 1, minWidth: 0 }}
      />
      <button
        type="button"
        className={copied ? "btn sm copied" : "btn sm"}
        onClick={copy}
        style={{ flex: "none" }}
      >
        {copied ? "已複製 ✓" : "複製"}
      </button>
    </div>
  );
}
