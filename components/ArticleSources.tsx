/*
 * 文章資料來源收合區（2026-08-27，站長要求前 10 篇比照豆腐頁）。
 * 吃 articles.sources 欄，一行一條：
 *   「#群組名」開頭的行是群組標題（例：#期刊文獻）
 *   「名稱|網址」有連結，「名稱」純文字
 * 原生 details 預設收合，不用 JS。樣式在 globals.css 的 .srcfold。
 */
export default function ArticleSources({ sources }: { sources?: string | null }) {
  const lines = (sources || "").split("\n").map((x) => x.trim()).filter(Boolean);
  if (!lines.length) return null;
  const count = lines.filter((ln) => !ln.startsWith("#")).length;

  /* 分組：group=null 的項目（舊格式、沒有群組標題）直接平鋪 */
  const groups: { g: string | null; items: [string, string?][] }[] = [];
  for (const ln of lines) {
    if (ln.startsWith("#")) { groups.push({ g: ln.slice(1).trim(), items: [] }); continue; }
    const [name, url] = ln.split("|").map((x) => x.trim());
    if (!groups.length) groups.push({ g: null, items: [] });
    groups[groups.length - 1].items.push([name, url || undefined]);
  }

  return (
    <details className="srcfold">
      <summary>本文資料來源（{count} 項，點開查看）</summary>
      {groups.map((grp, gi) => (
        <div key={grp.g ?? `flat-${gi}`}>
          {grp.g && <div className="sg">{grp.g}</div>}
          <ol>
            {grp.items.map(([name, url]) => (
              <li key={name}>
                {url ? <a href={url} target="_blank" rel="noopener">{name}</a> : name}
              </li>
            ))}
          </ol>
        </div>
      ))}
    </details>
  );
}
