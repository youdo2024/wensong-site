"use client";
import { useEffect, useRef } from "react";

/* 載入後自動 POST 跳轉（導向 PayUni 支付頁） */
export default function AutoSubmitForm({
  action,
  fields,
}: {
  action: string;
  fields: Record<string, string>;
}) {
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    ref.current?.submit();
  }, []);
  return (
    <form ref={ref} method="POST" action={action}>
      {Object.entries(fields).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <p className="center" style={{ color: "var(--grey)", padding: "40px 0" }}>
        正在前往安全付款頁…
      </p>
    </form>
  );
}
