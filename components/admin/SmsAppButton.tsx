"use client";
import { useState, useTransition } from "react";
import { markSmsAppSent } from "@/app/admin/remind-actions";

/*
 * 「用訊息 App」：先記一筆（算一次手動提醒），再開手機的訊息 App，號碼與內容都填好，要改在 App 裡改。
 * iOS 與 macOS 認 &，Android 認 ?，兩個都放各平台都開得起來（跟待聯絡那頁的 SmsDraft 同一招）。
 */
export default function SmsAppButton({ kind, id, phone, text, disabled, why }: { kind: "order" | "sponsor"; id: number; phone: string; text: string; disabled?: boolean; why?: string }) {
  const [pending, start] = useTransition();
  const [done, setDone] = useState(false);
  const href = `sms:${phone}?&body=${encodeURIComponent(text)}`;
  if (disabled) return <button type="button" className="btn sm" disabled title={why}>訊息 App</button>;
  return (
    <button
      type="button" className="btn sm" disabled={pending}
      title="開手機的訊息 App，內容已填好，在 App 裡改完再送"
      onClick={() => {
        start(async () => {
          try { await markSmsAppSent(kind, id); } catch { /* 記錄失敗也還是讓他寄 */ }
          setDone(true);
          window.location.href = href;
        });
      }}
    >
      {done ? "已開啟訊息 App" : pending ? "…" : "訊息 App"}
    </button>
  );
}
