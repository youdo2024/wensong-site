"use client";
import { useRef, useState } from "react";

/* 文章內文圖片小幫手：上傳後產生 Markdown 語法，貼進內文即可 */
export default function MdImageHelper({ mode = "md" }: { mode?: "md" | "url" } = {}) {
  const [snippet, setSnippet] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [copied, setCopied] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setErr("");
    setBusy(true);
    const fd = new FormData();
    fd.append("file", f);
    const res = await fetch("/api/admin/upload", { method: "POST", body: fd });
    const data = await res.json();
    setBusy(false);
    e.target.value = "";
    if (!res.ok) {
      setErr(data.error || "上傳失敗");
      return;
    }
    setSnippet(mode === "url" ? data.url : `![圖片說明](${data.url})`);
    setCopied(false);
  }

  return (
    <div style={{ border: "1.5px dashed var(--gold)", padding: "12px 16px", marginBottom: 16 }}>
      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <button type="button" className="btn sm" onClick={() => fileRef.current?.click()} disabled={busy}>
          {busy ? "上傳中…" : "＋ 上傳內文圖片"}
        </button>
        <span className="fine">{mode === "url" ? "上傳後把網址貼到商品說明 JSON 的 img 欄位，前台就會顯示圖片" : "上傳後把產生的語法貼到內文任何位置，「圖片說明」四個字可改成你的說明"}</span>
      </div>
      <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={onPick} style={{ display: "none" }} />
      {snippet && (
        <div style={{ display: "flex", gap: 10, marginTop: 10, alignItems: "center" }}>
          <code style={{ background: "var(--rice)", border: "1px solid var(--kraft)", padding: "6px 10px", fontSize: 13, flex: 1, overflowX: "auto", whiteSpace: "nowrap" }}>{snippet}</code>
          <button
            type="button"
            className={copied ? "btn sm copied" : "btn sm"}
            onClick={() => {
              navigator.clipboard.writeText(snippet);
              setCopied(true);
            }}
          >
            {copied ? "已複製 ✓" : "複製"}
          </button>
        </div>
      )}
      {err && <p className="msg-err" style={{ marginTop: 8 }}>{err}</p>}
    </div>
  );
}
