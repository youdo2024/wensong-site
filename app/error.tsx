"use client";
import Link from "next/link";
import { useEffect } from "react";

/*
 * 頁面層的錯誤邊界。
 *
 * 沒有這個檔的時候，任何一頁在伺服器或瀏覽器丟出例外，顧客看到的是
 * Next.js 的預設錯誤畫面——白底黑字、英文、還會在開發模式印出堆疊。
 * 那個畫面等於在跟客人說「這家店壞掉了」，而他多半就直接離開。
 *
 * 這裡刻意不用 Nav 與 Footer：出錯的原因可能就在版面元件本身，
 * 引進更多元件只會讓錯誤邊界自己也一起炸掉。所以整頁用最少的東西寫。
 *
 * 也刻意不顯示 error.message：那可能包含資料庫欄位名、檔案路徑或
 * 內部網址。顧客不需要那些，攻擊者倒是很需要。digest 是 Next.js 產生的
 * 短雜湊，貼給我們就能在伺服器記錄裡找到對應那一筆，安全又夠用。
 */
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    /* 真正的細節只留在伺服器記錄，不進畫面 */
    console.error("[page-error]", error?.digest || "", error?.message || error);
  }, [error]);

  return (
    <div className="frame" style={{ maxWidth: 560, padding: "72px 20px 120px" }}>
      <div className="box center">
        <div className="band" />
        <div className="inner" style={{ paddingTop: 44, paddingBottom: 44 }}>
          <span className="tag">出了點狀況</span>
          <h2 style={{ fontSize: 23, fontWeight: 900, letterSpacing: ".12em", marginTop: 14 }}>
            這一頁沒有正常打開
          </h2>
          <p style={{ color: "var(--grey)", fontSize: 14.5, marginTop: 12, lineHeight: 2 }}>
            是我們這邊的問題，不是你操作錯了。先按「再試一次」，多半就好了。
          </p>
          <p style={{ color: "var(--grey)", fontSize: 14.5, lineHeight: 2 }}>
            如果你正在結帳或贊助，<b>錢還沒有被扣</b>。已經送出的訂單可以到
            {" "}<Link href="/orders" style={{ color: "var(--indigo)" }}>訂單查詢</Link> 用「訂單編號 + Email」確認。
          </p>
          <p style={{ marginTop: 22, display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
            <button className="btn fill" onClick={() => reset()}>再試一次</button>
            <Link className="btn" href="/">回首頁</Link>
          </p>
          {error?.digest && (
            <p style={{ marginTop: 18, fontSize: 12, color: "var(--grey)", letterSpacing: ".08em" }}>
              要來信詢問的話，附上這組編號我們比較好查：<b className="sans">{error.digest}</b>
            </p>
          )}
        </div>
        <div className="band" />
      </div>
    </div>
  );
}
