"use client";
import { useState } from "react";

/* 規格選項編輯器：一列＝規格名稱＋該規格庫存。
   庫存留空＝這個規格不限量（只受商品總庫存管）；填數字＝賣到 0 就顯示完售、不能再選。
   規格名稱是庫存與統計的鍵：上架後改名＝該規格的庫存與統計重新起算，盡量別改名。

   「↑ ↓」是為了排序而做的：以前要調順序只能把文字重打一次，而重打就是改名，
   多一個空格就會讓那一列的庫存記錄被丟掉（存檔時只保留名稱對得上的），
   結果是額滿的規格靜悄悄變回可以買。這兩顆按鈕只調換陣列位置，一個字都不會動。 */
export default function ChoicesEditor({
  choicesName,
  stocksName,
  expiryName,
  choices = [],
  stocks = {},
  expiry = {},
}: {
  choicesName: string;
  stocksName: string;
  expiryName: string;
  choices?: string[];
  stocks?: Record<string, number>;
  expiry?: Record<string, string>;
}) {
  const [rows, setRows] = useState<{ n: string; s: string; e: string }[]>(
    choices.length
      ? choices.map((c) => ({ n: c, s: Object.prototype.hasOwnProperty.call(stocks, c) ? String(stocks[c]) : "", e: expiry[c] || "" }))
      : [{ n: "", s: "", e: "" }]
  );

  function set(i: number, key: "n" | "s" | "e", v: string) {
    setRows((r) => r.map((row, idx) => (idx === i ? { ...row, [key]: v } : row)));
  }

  /* 只換位置，名稱與庫存整列跟著走 */
  function move(i: number, dir: -1 | 1) {
    setRows((r) => {
      const j = i + dir;
      if (j < 0 || j >= r.length) return r;
      const out = [...r];
      [out[i], out[j]] = [out[j], out[i]];
      return out;
    });
  }

  const clean = rows.filter((r) => r.n.trim());
  const names = clean.map((r) => r.n.trim());
  const map: Record<string, number> = {};
  const expMap: Record<string, string> = {};
  for (const r of clean) {
    if (r.s.trim() !== "" && Number.isFinite(Number(r.s))) map[r.n.trim()] = Math.max(0, Math.floor(Number(r.s)));
    if (/^\d{4}-\d{2}-\d{2}$/.test(r.e.trim())) expMap[r.n.trim()] = r.e.trim();
  }

  return (
    <div className="field">
      <label>規格選項（庫存留空＝不限量；填數字＝該規格賣完自動顯示完售）</label>
      <input type="hidden" name={choicesName} value={JSON.stringify(names)} />
      <input type="hidden" name={stocksName} value={JSON.stringify(map)} />
      <input type="hidden" name={expiryName} value={JSON.stringify(expMap)} />
      <div style={{ border: "2px solid var(--ink)", background: "var(--rice-lt)", padding: 14 }}>
        {rows.map((row, i) => (
          <div key={i} style={{ display: "flex", gap: 8, marginBottom: 8, alignItems: "center", flexWrap: "wrap" /* 手機後台擠不下時往下折，不爆容器 */ }}>
            <input
              type="text" placeholder="規格（如：S 或 9/14 週）" value={row.n}
              onChange={(e) => set(i, "n", e.target.value)}
              style={{ flex: "1 1 180px", minWidth: 140, border: "2px solid var(--ink)", background: "#FFFDF6", padding: "8px 10px", fontSize: 14 }}
            />
            <input
              className="sans" type="number" min={0} placeholder="庫存（留空＝不限）" value={row.s}
              onChange={(e) => set(i, "s", e.target.value)}
              style={{ width: 120, border: "2px solid var(--ink)", background: "#FFFDF6", padding: "8px 10px", fontSize: 14 }}
            />
            <input
              className="sans" type="date" title="下架日（當天仍可買，隔天自動消失；留空＝不自動下架）" value={row.e}
              onChange={(e) => set(i, "e", e.target.value)}
              style={{ width: 140, border: "2px solid var(--ink)", background: "#FFFDF6", padding: "7px 8px", fontSize: 13 }}
            />
            <div className="row-tools">
              <button type="button" className="ibtn" title="上移一列" disabled={i === 0} onClick={() => move(i, -1)}>↑</button>
              <button type="button" className="ibtn" title="下移一列" disabled={i === rows.length - 1} onClick={() => move(i, 1)}>↓</button>
              <button
                type="button" className="ibtn danger" title="刪除這列"
                onClick={() => setRows((r) => (r.length > 1 ? r.filter((_, idx) => idx !== i) : [{ n: "", s: "", e: "" }]))}
              >
                ✕
              </button>
            </div>
          </div>
        ))}
        <button type="button" className="ibtn add wide" onClick={() => setRows((r) => [...r, { n: "", s: "", e: "" }])}>
          ＋ 新增一列
        </button>
        <p style={{ fontSize: 12.5, color: "var(--grey)", marginTop: 10, lineHeight: 1.8 }}>
          客人永遠看不到庫存數字，額滿的規格只會變灰並標「完售文字」。開賣後盡量不要改規格名稱：改名＝該規格庫存與統計重新起算。要調順序請用「↑ ↓」，不要把文字重打。日期格＝下架日：當天仍可買、隔天起這個選項自動從前台消失；出貨工作台會在全部出完後再保留 14 天。留空＝不自動下架。
        </p>
      </div>
    </div>
  );
}
