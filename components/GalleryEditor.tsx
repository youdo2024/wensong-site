"use client";
import { useRef, useState } from "react";

/* 商品補充圖：詳情頁主圖右滑之後看到的那幾張。主圖本身在上面另外設定，這裡不用再放一次。
   可以一次選多張，順序就是前台滑動的順序，用左右箭頭調。 */
export default function GalleryEditor({ name, value = [] }: { name: string; value?: string[] }) {
  const [list, setList] = useState<string[]>(value.filter(Boolean));
  const [busy, setBusy] = useState(0);
  const [err, setErr] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const files = [...(e.target.files || [])];
    e.target.value = "";
    if (!files.length) return;
    setErr("");
    setBusy(files.length);
    /* 逐張送，不並行：上傳端會寫檔，一次湧入太多在小主機上容易逾時 */
    for (const f of files) {
      const fd = new FormData();
      fd.append("file", f);
      try {
        const res = await fetch("/api/admin/upload", { method: "POST", body: fd });
        const data = await res.json();
        if (res.ok) setList((l) => [...l, data.url]);
        else setErr(data.error || "上傳失敗");
      } catch {
        setErr("上傳失敗，請再試一次");
      }
      setBusy((n) => n - 1);
    }
  }

  function move(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= list.length) return;
    setList((l) => { const n = [...l]; [n[i], n[j]] = [n[j], n[i]]; return n; });
  }

  return (
    <div className="field">
      <label>商品補充圖（詳情頁主圖可以左右滑，這裡放第二張之後的；順序即前台順序）</label>
      <input type="hidden" name={name} value={JSON.stringify(list)} />
      <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" multiple onChange={onPick} style={{ display: "none" }} />

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
        {list.map((src, i) => (
          <div key={src + i} style={{ width: 128, border: "2px solid var(--ink)", background: "var(--rice-lt)" }}>
            <div style={{ height: 90, overflow: "hidden", background: "var(--rice)" }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={src} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            </div>
            {/* 三顆 .ibtn 手機是 40px，卡片寬 128 減邊框剛好塞得下，所以 gap 只留 2 */}
            <div style={{ display: "flex", gap: 2, justifyContent: "center", padding: "4px 0", borderTop: "2px solid var(--ink)" }}>
              <button type="button" className="ibtn" onClick={() => move(i, -1)} disabled={i === 0} title="往前移">←</button>
              <button type="button" className="ibtn" onClick={() => move(i, 1)} disabled={i === list.length - 1} title="往後移">→</button>
              <button type="button" className="ibtn danger" onClick={() => setList((l) => l.filter((_, idx) => idx !== i))} title="移除這張">✕</button>
            </div>
          </div>
        ))}
        {busy > 0 && (
          <div style={{ width: 116, height: 116, border: "2px dashed var(--ink)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12.5, color: "var(--grey)" }}>
            上傳中… {busy}
          </div>
        )}
      </div>

      <button type="button" className="ibtn add wide" onClick={() => fileRef.current?.click()}>
        ＋ 加入圖片（可一次選多張）
      </button>
      {err && <p className="msg-err" style={{ marginTop: 8 }}>{err}</p>}
      <p className="fine" style={{ marginTop: 8, lineHeight: 1.85 }}>
        沒有加任何補充圖時，詳情頁就跟以前一樣只顯示主圖一張，不會出現滑動與縮圖。
      </p>
    </div>
  );
}
