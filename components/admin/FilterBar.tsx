import Link from "next/link";
import Ico from "./Ico";
import ViewToggle from "./ViewToggle";

/*
 * 篩選列：狀態膠囊一列、搜尋框一列，右邊是卡片／表格切換。訂單、贊助、投稿、名單共用同一套。
 *
 * 為什麼膠囊是連結不是下拉：站長最常做的是「看待付款的」，那要一下就到，不是點兩下再選。
 * 膠囊在手機可以橫向滑，永遠不換行，換行會把搜尋框推下去，一屏看得到的訂單就變少。
 */
export default function FilterBar({
  chips, search, viewToggle = true,
}: {
  chips: { label: React.ReactNode; href: string; on?: boolean }[];
  /* 搜尋走 GET 表單：網址帶得走，站長可以把「待付款＋某某」的畫面存成書籤 */
  search?: { action: string; name: string; defaultValue?: string; placeholder?: string; hidden?: Record<string, string> };
  viewToggle?: boolean;
}) {
  return (
    <div className="ad-filter">
      <div className="chips">
        {chips.map((c) => (
          <Link key={c.href} href={c.href} className={`chip${c.on ? " on" : ""}`}>{c.label}</Link>
        ))}
      </div>
      {(search || viewToggle) && (
        <div className="row2">
          {search && (
            <form action={search.action} method="get">
              {Object.entries(search.hidden || {}).map(([k, v]) => (
                <input key={k} type="hidden" name={k} value={v} />
              ))}
              <input
                type="search"
                name={search.name}
                defaultValue={search.defaultValue}
                placeholder={search.placeholder || "搜尋"}
                aria-label={search.placeholder || "搜尋"}
              />
              <button className="btn sm" type="submit" aria-label="搜尋"><Ico n="search" size={16} /></button>
            </form>
          )}
          {viewToggle && <ViewToggle />}
        </div>
      )}
    </div>
  );
}
