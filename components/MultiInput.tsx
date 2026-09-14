"use client";
import { useState } from "react";

/* 多值輸入：一格一個值，按＋多一格、按✕移除。
   送出時同名欄位會出現多次，後端用 formData.getAll(name) 接 */
export default function MultiInput({
  name,
  defaultValues = [],
  placeholder = "",
  sans = false,
  inputType = "text",
}: {
  name: string;
  defaultValues?: string[];
  placeholder?: string;
  sans?: boolean;
  inputType?: string;
}) {
  const [vals, setVals] = useState<string[]>(defaultValues.length > 0 ? defaultValues : [""]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {vals.map((v, i) => (
        <div key={i} style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input
            className={sans ? "sans" : undefined}
            type={inputType}
            name={name}
            value={v}
            placeholder={i === 0 ? placeholder : ""}
            onChange={(e) => setVals(vals.map((x, j) => (j === i ? e.target.value : x)))}
            style={{ flex: 1 }}
          />
          {vals.length > 1 && (
            <button type="button" className="ibtn danger" title="移除這格" onClick={() => setVals(vals.filter((_, j) => j !== i))}>
              ✕
            </button>
          )}
          {i === vals.length - 1 && (
            <button type="button" className="ibtn add" title="再加一格" onClick={() => setVals([...vals, ""])}>
              ＋
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
