"use client";
import { useEffect, useState } from "react";

/*
 * 感謝頁「要用 LINE 收通知嗎？」的卡片：結帳時沒勾的人才看到（規格 Q25）。
 * 按「不用了」只記在這台裝置的 localStorage、只對這張訂單有效；下一張新訂單還是會問。
 * 不做永久拒絕：人會改變主意。
 */
export default function LineAskCard({ orderNo, bindUrl }: { orderNo: string; bindUrl: string }) {
  const key = `line_ask_dismiss_${orderNo}`;
  const [hidden, setHidden] = useState(true);
  useEffect(() => {
    try { setHidden(localStorage.getItem(key) === "1"); } catch { setHidden(false); }
  }, [key]);
  if (hidden) return null;
  return (
    <div style={{ marginTop: 22, padding: "16px 18px", border: "2px dashed var(--kraft)", textAlign: "center" }}>
      <p style={{ fontSize: 14.5, lineHeight: 1.9, margin: "0 0 12px" }}>要用 LINE 收付款與出貨通知嗎？按一下就好，不用打字。</p>
      <a className="btn" href={bindUrl} style={{ background: "#06C755", color: "#fff", borderColor: "#06C755" }}>用 LINE 接收</a>
      <p style={{ marginTop: 10 }}>
        <button
          type="button"
          className="link-btn"
          style={{ color: "var(--grey)", fontSize: 12.5 }}
          onClick={() => { try { localStorage.setItem(key, "1"); } catch { /* 存不了就只是這次不記 */ } setHidden(true); }}
        >
          不用了
        </button>
      </p>
      <p className="fine" style={{ marginTop: 6, fontSize: 11.5 }}>綁定即同意用 LINE 接收訂單通知，封鎖官方帳號即取消。</p>
    </div>
  );
}
