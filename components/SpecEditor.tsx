"use client";
import { useState } from "react";

/* 規格表編輯器：一列一項（名稱＋內容），取代 JSON 手寫 */
export default function SpecEditor({ name, value = [] }: { name: string; value?: string[][] }) {
  const [rows, setRows] = useState<string[][]>(value.length ? value : [["", ""]]);

  function set(i: number, col: number, v: string) {
    setRows((r) => r.map((row, idx) => (idx === i ? row.map((c, ci) => (ci === col ? v : c)) : row)));
  }
  const clean = rows.filter((r) => r[0].trim() || r[1].trim());

  return (
    <div className="field">
      <label>規格表（例：材質｜100% 純棉）</label>
      <input type="hidden" name={name} value={JSON.stringify(clean)} />
      <div style={{ border: "2px solid var(--ink)", background: "var(--rice-lt)", padding: 14 }}>
        {rows.map((row, i) => (
          <div key={i} style={{ display: "flex", gap: 8, marginBottom: 8, alignItems: "center" }}>
            <input
              type="text" placeholder="項目（如：材質）" value={row[0]}
              onChange={(e) => set(i, 0, e.target.value)}
              style={{ width: 140, border: "2px solid var(--ink)", background: "#FFFDF6", padding: "8px 10px", fontSize: 14 }}
            />
            <input
              type="text" placeholder="內容（如：100% 純棉 210g）" value={row[1]}
              onChange={(e) => set(i, 1, e.target.value)}
              style={{ flex: 1, border: "2px solid var(--ink)", background: "#FFFDF6", padding: "8px 10px", fontSize: 14 }}
            />
            <button
              type="button" className="ibtn danger" title="刪除這列"
              onClick={() => setRows((r) => (r.length > 1 ? r.filter((_, idx) => idx !== i) : [["", ""]]))}
            >
              ✕
            </button>
          </div>
        ))}
        <button type="button" className="ibtn add wide" onClick={() => setRows((r) => [...r, ["", ""]])}>
          ＋ 新增一列
        </button>
      </div>
    </div>
  );
}
