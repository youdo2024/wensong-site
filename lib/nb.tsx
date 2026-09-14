import React from "react";

/*
 * 中文斷句：把整句依標點切成小句，短句包 <span class="nb">（inline-block）不讓它被拆開，
 * 換行就會優先落在標點處，而不是把詞從中間切斷。
 *
 * 這是 lib/markdown.ts 的 wrapClauses 的 React 版本——標準文章走 markdown 那條，
 * 一頁式（bespoke）文章的文字寫在元件裡繞過了它，所以需要這個共用。
 * 超過 max 字的長句不包：包了會整句擠不下而撐破容器（markdown 那邊同樣的取捨）。
 */
const SEG_RE = /[^，。、；：！？…]*[，。、；：！？…]|[^，。、；：！？…]+/g;

/* 內文預設 17 字；標題、圖說、卡片等窄容器自行傳入較小值 */
export function nb(text: string, max = 17): React.ReactNode[] {
  const segs = text.match(SEG_RE) || [text];
  return segs.map((seg, i) => {
    const len = seg.trim().length;
    return len > 0 && len <= max
      ? <span className="nb" key={i}>{seg}</span>
      : <React.Fragment key={i}>{seg}</React.Fragment>;
  });
}
