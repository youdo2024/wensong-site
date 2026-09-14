"use client";
import EmailField from "./EmailField";
import { useState } from "react";
import { money } from "@/lib/format";

const STEPS = [
  { key: "pending", label: "待付款" },
  { key: "paid", label: "已付款" },
  { key: "shipped", label: "已出貨" },
  { key: "done", label: "已完成" },
];

type Result = {
  orderNo: string;
  status: string;
  items: { name: string; choice: string | null; price: number; qty: number; shipped?: number }[];
  subtotal: number;
  shipping: number;
  total: number;
};

export default function OrderLookup() {
  const [no, setNo] = useState("");
  const [email, setEmail] = useState("");
  const [err, setErr] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [loading, setLoading] = useState(false);

  async function lookup() {
    if (!no.trim() || !email.trim()) {
      setErr("請填訂單編號與 Email");
      return;
    }
    setLoading(true);
    setErr("");
    setResult(null);
    const res = await fetch("/api/orders/lookup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderNo: no.trim(), email: email.trim() }),
    });
    const data = await res.json();
    setLoading(false);
    if (!res.ok) {
      setErr(data.error || "查詢失敗");
      return;
    }
    setResult(data);
  }

  return (
    <div className="box" style={{ maxWidth: 560, margin: "0 auto" }}>
      <div className="band" />
      <div className="inner">
        <div className="field">
          <label>訂單編號</label>
          <input className="sans" type="text" value={no} onChange={(e) => setNo(e.target.value)} placeholder="YD2607040001" />
        </div>
        <div className="field">
          <EmailField label={<label>Email</label>} required={false} onChange={setEmail} />
        </div>
        {err && <p className="msg-err">{err}</p>}
        <div className="center" style={{ marginTop: 8 }}>
          <button className="btn blue" onClick={lookup} disabled={loading}>
            {loading ? "查詢中…" : "查詢"}
          </button>
        </div>
        {result && (
          <div style={{ marginTop: 10 }}>
            <div className="status-track">
              {STEPS.map((s) => (
                <span key={s.key} className={result.status === s.key ? "on" : ""}>{s.label}</span>
              ))}
            </div>
            <div className="cart-table" style={{ marginBottom: 16 }}>
              {result.items.map((i, idx) => {
                /* 逐包裹狀態：一單可能由不同出貨地分批寄出，整單一個狀態會騙人——
                   蛋捲出了、梅子酥還沒，寫「已出貨」是謊報，寫「待出貨」是嚇人。
                   已付款之後每個品項各自標示；付款完成前不標（還輪不到出貨）。 */
                const itemShipped = result.status === "shipped" || result.status === "done" || Boolean(i.shipped);
                const showTag = result.status === "paid" || result.status === "shipped" || result.status === "done";
                return (
                  <div className="cart-row" key={idx}>
                    <div className="n">
                      <b>{i.name}</b>
                      <small>
                        {i.choice ? `${i.choice}　` : ""}× {i.qty}
                        {showTag && (
                          <span className="sans" style={{ marginLeft: 8, color: itemShipped ? "var(--indigo)" : "var(--grey)", fontWeight: 700 }}>
                            {itemShipped ? "已寄出" : "準備中"}
                          </span>
                        )}
                      </small>
                    </div>
                    <div className="sub-p sans">{money(i.price * i.qty)}</div>
                  </div>
                );
              })}
              <div className="cart-row">
                <div className="n"><b>總金額（含運費 {money(result.shipping)}）</b></div>
                <div className="sub-p sans">{money(result.total)}</div>
              </div>
            </div>
            <p className="fine">
              {result.status === "shipped" || result.status === "done"
                ? "已出貨，出貨當天會寄 Email 通知你"
                : "分批出貨的訂單，每一批寄出當天都會寄 Email 通知你"}
            </p>
          </div>
        )}
      </div>
      <div className="band" />
    </div>
  );
}
