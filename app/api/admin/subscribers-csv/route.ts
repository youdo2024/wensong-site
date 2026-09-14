import { NextResponse } from "next/server";
import { fmtDateTimeDash } from "@/lib/format";
import db from "@/lib/db";
import { isAdmin } from "@/lib/auth";
import { csvCell } from "@/lib/csv";

/* 匯出新品通知訂閱名單（CSV with BOM，Excel 直接開啟） */
export async function GET() {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const rows = db.prepare("SELECT email,name,source,created_at FROM subscribers ORDER BY id DESC").all() as
    { email: string; name: string; source: string; created_at: string }[];
  /* 公式注入防護見 lib/csv.ts */
  const esc = csvCell;
  const lines = [
    ["Email", "名稱", "來源", "訂閱時間"].join(","),
    ...rows.map((r) => [esc(r.email), esc(r.name), esc(r.source), esc(fmtDateTimeDash(r.created_at))].join(",")),
  ];
  return new NextResponse("﻿" + lines.join("\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="subscribers.csv"`,
    },
  });
}
