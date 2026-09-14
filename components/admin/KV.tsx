/*
 * 鍵值表：收件資訊、發票這種「欄名對值」的資料一律用它。
 * 左欄固定 5.5em，值太長會換行不會把版面撐開；空值統一顯示破折號，不要留空白讓人以為壞了。
 */
export default function KV({ rows }: { rows: { k: React.ReactNode; v: React.ReactNode }[] }) {
  return (
    <div className="ad-kv">
      {rows.map((r, i) => (
        <div className="row" key={i}>
          <div className="k">{r.k}</div>
          <div className="v">{r.v ?? "—"}</div>
        </div>
      ))}
    </div>
  );
}
