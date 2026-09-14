import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import db from "@/lib/db";
import { csvCell } from "@/lib/csv";

/* 名單匯出：與後台名單總覽同一套合併邏輯，Excel 可直接開（BOM＋CSV） */
export async function GET() {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const map = new Map<string, { email: string; name: string; sources: Set<string>; last: string; nl: boolean }>();
  const add = (email: string, name: string, source: string, at: string, nl = false) => {
    const key = (email || "").trim().toLowerCase();
    if (!key || !key.includes("@")) return;
    const cur = map.get(key);
    if (cur) {
      cur.sources.add(source);
      if (!cur.name && name) cur.name = name;
      if (at > cur.last) cur.last = at;
      cur.nl = cur.nl || nl;
    } else map.set(key, { email: key, name: name || "", sources: new Set([source]), last: at || "", nl });
  };
  for (const r of db.prepare("SELECT email,display_name,created_at,status FROM sponsorships").all() as { email: string; display_name: string; created_at: string; status: string }[])
    add(r.email, r.display_name, r.status === "pending" || r.status === "failed" ? "支持(未完成)" : "支持", r.created_at);
  for (const r of db.prepare("SELECT email,name,created_at,newsletter FROM users").all() as { email: string; name: string; created_at: string; newsletter: number }[]) add(r.email, r.name, "會員", r.created_at, r.newsletter === 1);
  for (const r of db.prepare("SELECT email,name,created_at FROM orders WHERE status!='cancelled'").all() as { email: string; name: string; created_at: string }[]) add(r.email, r.name, "訂單", r.created_at);
  for (const r of db.prepare("SELECT email,name,created_at,source FROM subscribers").all() as { email: string; name: string; created_at: string; source: string }[]) add(r.email, r.name, `訂閱(${r.source || "網站"})`, r.created_at, true);

  /*
   * 逸出統一用 lib/csv.ts 的 csvCell。原本這裡自己寫了一份，只做雙引號逸出，
   * 少了公式注入防護：顧客把名字填成 =HYPERLINK(...) 這種東西，站長用 Excel
   * 一開就被當公式跑掉。全站其他匯出早就走 csvCell，只有名單這支漏掉，
   * 而名單正好是把顧客自填欄位整批倒出來的那一支。一般值輸出完全一樣。
   */
  const esc = csvCell;
  const rows = [...map.values()].sort((a, b) => (a.last < b.last ? 1 : -1));
  const csv = ["Email,名稱,來源,電子報訂閱,最近互動", ...rows.map((l) => [esc(l.email), esc(l.name), esc([...l.sources].join("・")), l.nl ? "是" : "", (l.last || "").slice(0, 10)].join(","))].join("\r\n");
  return new NextResponse(`﻿${csv}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="leads-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}
