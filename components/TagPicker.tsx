"use client";
import { useState } from "react";

/* 後台分類點選器：點一下選取/取消，取代手打文字 */
export default function TagPicker({
  name,
  options,
  value = [],
  single = false,
}: {
  name: string;
  options: string[];
  value?: string[];
  single?: boolean;
}) {
  /* 既有資料若含清單外的舊分類，一併列出以免遺失 */
  const allOptions = Array.from(new Set([...options, ...value]));
  const [selected, setSelected] = useState<string[]>(value);

  function toggle(tag: string) {
    if (single) {
      setSelected([tag]);
      return;
    }
    setSelected((s) => (s.includes(tag) ? s.filter((t) => t !== tag) : [...s, tag]));
  }

  return (
    <>
      <input type="hidden" name={name} value={selected.join(",")} />
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {allOptions.map((tag) => {
          const on = selected.includes(tag);
          return (
            <span
              key={tag}
              onClick={() => toggle(tag)}
              style={{
                border: `2px solid ${on ? "var(--seal)" : "var(--ink)"}`,
                background: on ? "var(--seal)" : "var(--rice)",
                color: on ? "var(--rice)" : "var(--ink)",
                padding: "7px 18px",
                fontSize: 14,
                letterSpacing: ".1em",
                cursor: "pointer",
                userSelect: "none",
                boxShadow: on ? "2px 2px 0 var(--ink)" : "none",
              }}
            >
              {on ? "✓ " : ""}{tag}
            </span>
          );
        })}
      </div>
    </>
  );
}
