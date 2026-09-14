"use client";
import { useState } from "react";

/* 登入頁的「其他登入方式」：一行小字，點開才出現 Google。站長希望大家都用 LINE */
export default function OtherLogins() {
  const [open, setOpen] = useState(false);
  if (!open)
    return (
      <button type="button" className="link-btn" style={{ color: "var(--grey)", fontSize: 12.5, marginTop: 6 }} onClick={() => setOpen(true)}>
        其他登入方式
      </button>
    );
  return <a className="btn" href="/api/auth/google" style={{ marginTop: 6 }}>用 Google 帳號登入</a>;
}
