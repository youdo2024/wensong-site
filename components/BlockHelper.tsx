"use client";
import { useState } from "react";

/* 動態區塊語法小抄：站長在寫文章時可展開參考，一鍵複製範例貼進內文。
   語法對應 lib/blocks.ts 的解析規則。 */

const BLOCKS: { name: string; hint: string; code: string }[] = [
  {
    name: "數字重點",
    hint: "大數字會從 0 往上跳。一行一個，用｜分隔「數字」和「說明」",
    code: `:::數字
600｜全台剩不到 600 隻石虎
5｜豆棗一生共五胎
2｜體內留著兩顆子彈`,
  },
  {
    name: "長條圖",
    hint: "捲到時長條會長出來。第一行是標題，之後一行一條：文字加空格加數字（數字都在 100 以內就當百分比）",
    code: `:::長條圖 豆棗待在農地的時間比例
一般石虎 20
豆棗 85`,
  },
  {
    name: "時間軸",
    hint: "會一格一格依序浮現。一行一個階段，用｜分隔「時間」和「發生什麼」",
    code: `:::時間軸 豆棗的一生
出生第七天｜失去所有家人
一個月｜睜開眼睛
野放｜像火箭一樣衝進森林`,
  },
  {
    name: "對比",
    hint: "並排兩張卡（左紅右綠）。一行一張，用｜分隔「小標」和「內容」",
    code: `:::對比 兩種田的差別
慣行田｜農藥、水泥溝渠，石虎待不住
友善田｜不毒不噴，石虎住進來抓老鼠`,
  },
  {
    name: "金句",
    hint: "深色大字引言，用在最想被記住的一句話",
    code: `:::金句
她帶著兩顆子彈，卻還哺育了好多個孩子`,
  },
  {
    name: "重點卡",
    hint: "一排圖示卡片。一行一張，用｜分隔「emoji」「標題」「說明」（emoji 可省略）",
    code: `:::重點 豆棗一生的人為威脅
🔥｜燒草的人｜兩隻剛滿月的寶寶被燒死
🧱｜水泥溝渠｜跌落的孩子爬不出來
🔫｜開槍的人｜兩顆子彈留在體內`,
  },
  {
    name: "進度環",
    hint: "圓形進度圈，會轉到指定百分比。格式：數字｜說明",
    code: `:::進度 85｜豆棗待在友善農地的時間佔比`,
  },
];

function Snippet({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div style={{ display: "flex", gap: 10, marginTop: 8, alignItems: "flex-start" }}>
      <pre
        style={{
          background: "var(--rice)", border: "1px solid var(--kraft)", padding: "8px 10px",
          fontSize: 12.5, flex: 1, overflowX: "auto", margin: 0, whiteSpace: "pre", lineHeight: 1.7,
        }}
      >
        {code}
      </pre>
      <button
        type="button"
        className={copied ? "btn sm copied" : "btn sm"}
        onClick={() => {
          navigator.clipboard.writeText(code);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
      >
        {copied ? "已複製 ✓" : "複製"}
      </button>
    </div>
  );
}

export default function BlockHelper() {
  return (
    <details style={{ border: "1.5px dashed var(--gold)", padding: "10px 16px", marginBottom: 16 }}>
      <summary style={{ cursor: "pointer", fontWeight: 700, fontSize: 14 }}>
        ✨ 動態圖表區塊（點開看怎麼用）
      </summary>
      <p className="fine" style={{ margin: "10px 0 4px" }}>
        在內文裡打下面這種「:::」開頭的區塊，網站會自動渲染成會動的圖表（捲到時淡入、數字跳動、長條圖長出來）。
        每個區塊上下各留一行空白，複製範例改成你的內容即可。分隔線用全形｜或半形 | 都可以。
      </p>
      {BLOCKS.map((b) => (
        <div key={b.name} style={{ marginTop: 14 }}>
          <b style={{ fontSize: 13.5 }}>{b.name}</b>
          <span className="fine" style={{ marginLeft: 8 }}>{b.hint}</span>
          <Snippet code={b.code} />
        </div>
      ))}
    </details>
  );
}
