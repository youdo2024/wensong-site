"use client";
import { useRef, useState } from "react";

type Block = { img: string; h: string; p: string };

/* 商品說明編輯器：一段一區塊（圖片＋小標＋內文），取代 JSON 手寫 */
export default function StoryEditor({ name, value = [] }: { name: string; value?: Block[] }) {
  const [blocks, setBlocks] = useState<Block[]>(value.length ? value : []);
  const [busy, setBusy] = useState<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const targetRef = useRef<number>(0);

  function set(i: number, field: keyof Block, v: string) {
    setBlocks((b) => b.map((blk, idx) => (idx === i ? { ...blk, [field]: v } : blk)));
  }

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    const i = targetRef.current;
    if (!f) return;
    setBusy(i);
    const fd = new FormData();
    fd.append("file", f);
    const res = await fetch("/api/admin/upload", { method: "POST", body: fd });
    const data = await res.json();
    setBusy(null);
    e.target.value = "";
    if (res.ok) set(i, "img", data.url);
  }

  const clean = blocks.filter((b) => b.h.trim() || b.p.trim() || b.img.trim());
  const isUrl = (s: string) => s.startsWith("/api/images/") || s.startsWith("http");

  return (
    <div className="field">
      <label>商品說明（一段一區塊：圖片＋小標＋內文，顯示在商品頁下方）</label>
      <input type="hidden" name={name} value={JSON.stringify(clean)} />
      <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={onPick} style={{ display: "none" }} />
      {blocks.map((b, i) => (
        <div key={i} style={{ border: "2px solid var(--ink)", background: "var(--rice-lt)", padding: 14, marginBottom: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <b style={{ fontSize: 13, letterSpacing: ".2em", color: "var(--indigo)" }}>第 {i + 1} 段</b>
            <button type="button" className="danger-link" onClick={() => setBlocks((blk) => blk.filter((_, idx) => idx !== i))}>
              ✕ 刪除這段
            </button>
          </div>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 10 }}>
            <div
              onClick={() => { targetRef.current = i; fileRef.current?.click(); }}
              title="點擊上傳／更換圖片"
              style={{ width: 180, height: 110, border: "2px dashed var(--ink)", background: "var(--rice)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", flex: "none" }}
            >
              {busy === i ? (
                <span style={{ fontSize: 12.5, color: "var(--grey)" }}>上傳中…</span>
              ) : isUrl(b.img) ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img src={b.img} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              ) : (
                <span style={{ fontSize: 12.5, color: "var(--grey)", textAlign: "center", padding: 8 }}>點擊上傳圖片<br />（選填）</span>
              )}
            </div>
            <div style={{ flex: 1, minWidth: 220 }}>
              {/* 整個編輯器已經包在 .field 裡，欄位外觀交給 .field input／.field textarea，這裡只留間距 */}
              <input
                type="text" placeholder="小標（如：田裡穿得住，廚房也穿得住）" value={b.h}
                onChange={(e) => set(i, "h", e.target.value)}
                style={{ marginBottom: 8 }}
              />
              <textarea
                className="ta-s" placeholder="內文" value={b.p}
                onChange={(e) => set(i, "p", e.target.value)}
              />
            </div>
          </div>
          {isUrl(b.img) && (
            <button type="button" className="danger-link" onClick={() => set(i, "img", "")}>移除圖片</button>
          )}
        </div>
      ))}
      <button type="button" className="ibtn add wide" onClick={() => setBlocks((b) => [...b, { img: "", h: "", p: "" }])}>
        ＋ 新增一段說明
      </button>
    </div>
  );
}
