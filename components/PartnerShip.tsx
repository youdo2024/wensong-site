"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

/* 夥伴頁的「標記出貨」：只標這一列的品項（多週訂單各週分開出），寄該批的通知信。
   兩段式確認：先按一次變成「確認出貨」，再按一次才真的送出，避免滑手機誤觸。
   不收物流單號——站長不使用單號，少一個欄位夥伴就少一個猶豫。 */
/* recipIdx：多地址配送時，這一列是名單裡的第幾位。一般訂單傳 null，走原本的逐品項出貨 */
export default function PartnerShip({ orderNo, itemIdx, recipIdx = null }: { orderNo: string; itemIdx: number; recipIdx?: number | null }) {
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const router = useRouter();

  async function ship() {
    setBusy(true);
    setErr("");
    try {
      const fd = new FormData();
      fd.append("order_no", orderNo);
      if (recipIdx === null || recipIdx === undefined) {
        fd.append("item_idx", String(itemIdx));
      } else {
        fd.append("recip_idx", String(recipIdx));
      }
      const res = await fetch("/api/partner/ship", { method: "POST", body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(data.error || "失敗了，請再試一次");
        setBusy(false);
        return;
      }
      router.refresh();
    } catch {
      setErr("連線失敗，請再試一次");
      setBusy(false);
    }
  }

  if (!armed) {
    return <button type="button" className="ptn-ship" onClick={() => setArmed(true)}>出貨</button>;
  }
  return (
    <span className="ptn-shipbox">
      <button type="button" className="ptn-ship go" onClick={ship} disabled={busy}>
        {busy ? "處理中…" : "確認出貨"}
      </button>
      <button type="button" className="ptn-ship cancel" onClick={() => { setArmed(false); setErr(""); }} disabled={busy}>
        取消
      </button>
      {err && <em>{err}</em>}
    </span>
  );
}
