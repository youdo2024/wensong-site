"use client";
import { useEffect } from "react";

/*
 * 最後一道錯誤邊界：連 root layout 自己都炸掉的時候才會走到這裡。
 *
 * 因為 root layout 已經失效，這個檔必須自己輸出 <html> 與 <body>，
 * 而且 globals.css 不會被載入——所以樣式一律寫成 inline，
 * 不能用 .box、.btn 那些 class，否則畫面會是完全沒有樣式的裸 HTML。
 *
 * 這一頁能不能顯示，決定了「網站掛掉」看起來是什麼樣子。
 * 目標只有一個：讓人知道這是暫時的，而且錢沒有被扣。
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("[global-error]", error?.digest || "", error?.message || error);
  }, [error]);

  return (
    <html lang="zh-Hant-TW">
      <body style={{ margin: 0, background: "#FFF6EA", color: "#33271F",
        fontFamily: '"Noto Serif TC","Source Han Serif TC",serif' }}>
        <div style={{ maxWidth: 520, margin: "0 auto", padding: "84px 20px" }}>
          <div style={{ border: "2px solid #33271F", background: "#FFFDF6", textAlign: "center" }}>
            <div style={{ height: 8, background: "#33271F" }} />
            <div style={{ padding: "44px 24px" }}>
              <span style={{ fontSize: 12, letterSpacing: ".28em", color: "#8A7A6E" }}>暫時無法顯示</span>
              <h1 style={{ fontSize: 22, fontWeight: 900, letterSpacing: ".12em", margin: "14px 0 0" }}>
                問爽的遇到一點狀況
              </h1>
              <p style={{ color: "#8A7A6E", fontSize: 14.5, lineHeight: 2, marginTop: 12 }}>
                是我們這邊的問題。先按「重新載入」，通常過一下就恢復了。
              </p>
              <p style={{ color: "#8A7A6E", fontSize: 14.5, lineHeight: 2 }}>
                如果你剛剛在結帳或贊助，<b style={{ color: "#33271F" }}>錢還沒有被扣</b>。
              </p>
              <p style={{ marginTop: 24 }}>
                <button
                  onClick={() => reset()}
                  style={{ font: "inherit", fontSize: 14, letterSpacing: ".1em", padding: "11px 26px",
                    border: "2px solid #33271F", background: "#33271F", color: "#FFF6EA", cursor: "pointer" }}
                >
                  重新載入
                </button>
              </p>
              {error?.digest && (
                <p style={{ marginTop: 18, fontSize: 12, color: "#8A7A6E", letterSpacing: ".08em" }}>
                  查詢編號：<b>{error.digest}</b>
                </p>
              )}
            </div>
            <div style={{ height: 8, background: "#33271F" }} />
          </div>
        </div>
      </body>
    </html>
  );
}
