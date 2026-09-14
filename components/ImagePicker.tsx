"use client";
import { useRef, useState } from "react";

/* 後台通用選圖器：上傳到 /api/admin/upload，網址存進同名 hidden input 隨表單送出 */
export default function ImagePicker({
  name,
  label,
  value = "",
  height = 120,
}: {
  name: string;
  label: string;
  value?: string;
  height?: number;
}) {
  const [url, setUrl] = useState(value);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
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
    setUrl(data.url);
  }

  return (
    <div className="field">
      <label>{label}</label>
      <input type="hidden" name={name} value={url} />
      <div
        onClick={() => !busy && fileRef.current?.click()}
        style={{
          border: "2px dashed var(--ink)",
          background: url ? "var(--rice-lt)" : "var(--rice)",
          cursor: "pointer",
          height,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          overflow: "hidden",
          position: "relative",
        }}
        title="點擊上傳／更換圖片"
      >
        {url ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img src={url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        ) : (
          <span style={{ fontSize: 13, color: "var(--grey)", letterSpacing: ".15em" }}>
            {busy ? "上傳中…" : "點擊上傳圖片（JPG／PNG／WebP）"}
          </span>
        )}
        {url && busy && (
          <span style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(239,227,196,.8)", fontSize: 13 }}>
            上傳中…
          </span>
        )}
      </div>
      <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={onPick} style={{ display: "none" }} />
      {url && (
        <div style={{ marginTop: 6 }}>
          <button type="button" className="danger-link" onClick={() => setUrl("")}>
            移除圖片（存檔後生效）
          </button>
        </div>
      )}
      {err && <p className="msg-err" style={{ marginTop: 8 }}>{err}</p>}
    </div>
  );
}
