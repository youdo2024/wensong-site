"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { dollar } from "@/lib/format";

/* 首頁第 7 區：選金額進 /support；自訂金額直接跳贊助頁展開輸入框 */
export default function QuickSupport({ tiers, note = "安全金流自動扣款，隨時可取消" }: { tiers: number[]; note?: string }) {
  const [amount, setAmount] = useState(tiers[0] ?? 888);
  const router = useRouter();

  return (
    <>
      <div className="amounts">
        {tiers.map((t) => (
          <div
            key={t}
            className={`amt${amount === t ? " on" : ""}`}
            onClick={() => setAmount(t)}
          >
            <span className="sans">{dollar(t)}</span>
          </div>
        ))}
      </div>

      <p className="center" style={{ marginTop: 12, marginBottom: 0 }}>
        <a
          onClick={() => router.push("/support?custom=1")}
          style={{ fontSize: 13, color: "var(--grey)", textDecoration: "underline", textUnderlineOffset: 4, cursor: "pointer", letterSpacing: ".08em" }}
        >
          想用其他金額？自訂金額
        </a>
      </p>

      <div className="per-month">
        長期支持
        <small>{note}</small>
      </div>
      <div className="center" style={{ marginTop: 24 }}>
        <button className="btn fill" onClick={() => router.push(`/support?amount=${amount}`)}>
          下一步，填寫資料
        </button>
      </div>
    </>
  );
}
