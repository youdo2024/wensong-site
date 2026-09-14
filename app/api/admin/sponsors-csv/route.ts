import { NextRequest, NextResponse } from "next/server";
import db, { json } from "@/lib/db";
import { isAdmin } from "@/lib/auth";
import { SPONSOR_STATUS, fmtDateTimeDash } from "@/lib/format";
import { csvCell } from "@/lib/csv";

/*
 * 匯出贊助名單（CSV with BOM，Excel 直接開啟）
 * 預設：每月定額進行中的名單；?scope=all 匯出全部贊助紀錄
 */
export async function GET(req: NextRequest) {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const scope = req.nextUrl.searchParams.get("scope") || "monthly-active";
  /* 公式注入防護見 lib/csv.ts */
  const esc = csvCell;

  let lines: string[];
  let filename: string;

  if (scope === "all") {
    const rows = db.prepare("SELECT * FROM sponsorships ORDER BY id DESC").all() as {
      mode: string; amount: number; display_name: string; message: string; email: string;
      pay_method: string; invoice_type: string; invoice_data: string; status: string;
      next_charge_at: string; last_charge_note: string; created_at: string;
      source: string; env: string; remind_count: number; phone: string;
    }[];
    lines = [
      /* 來源頁與瀏覽器環境是分析轉換率的關鍵：同一種付款方式在 FB／IG 內建瀏覽器裡
         的成功率可能完全不同，沒有這兩欄就只能猜 */
      ["型態", "狀態", "支持者名稱", "Email", "電話", "金額", "付款方式", "來源頁", "瀏覽器環境", "發票", "留言", "下次扣款", "待付款提醒", "備註", "建立時間"].join(","),
      ...rows.map((s) => {
        const inv = json<Record<string, string>>(s.invoice_data, {});
        const invText =
          s.invoice_type === "b2b"
            ? `三聯式 ${inv.company || ""} ${inv.taxId || ""}`
            : `二聯式 ${inv.carrierType || ""} ${inv.carrierNo || ""}`;
        return [
          esc(s.mode === "monthly" ? "每月定額" : "單筆"),
          esc(SPONSOR_STATUS[s.status] ?? s.status),
          esc(s.display_name || "匿名"), esc(s.email), esc(s.phone || ""), s.amount, esc(s.pay_method),
          esc(s.source || ""),
          esc(s.env === "fb" ? "FB內建" : s.env === "ig" ? "IG內建" : s.env === "line" ? "LINE內建" : s.env === "wv" ? "其他App內建" : "一般瀏覽器"),
          esc(invText.trim()), esc(s.message), esc(s.next_charge_at.slice(0, 10)),
          esc(s.status === "pending" ? (s.remind_count ? `已寄 ${s.remind_count} 次` : "尚未提醒") : ""),
          esc(s.last_charge_note),
          esc(fmtDateTimeDash(s.created_at)),
        ].join(",");
      }),
    ];
    filename = "sponsors-all.csv";
  } else {
    const rows = db
      .prepare("SELECT display_name,email,amount,pay_method,next_charge_at,created_at FROM sponsorships WHERE mode='monthly' AND status='active' ORDER BY id")
      .all() as { display_name: string; email: string; amount: number; pay_method: string; next_charge_at: string; created_at: string }[];
    lines = [
      ["支持者名稱", "Email", "每月金額", "付款方式", "下次扣款", "開始日期"].join(","),
      ...rows.map((r) =>
        [esc(r.display_name || "匿名"), esc(r.email), r.amount, esc(r.pay_method), esc(r.next_charge_at.slice(0, 10)), r.created_at.slice(0, 10)].join(",")
      ),
    ];
    filename = "monthly-sponsors.csv";
  }

  /* BOM 讓 Excel 正確辨識 UTF-8 中文 */
  const csv = "﻿" + lines.join("\r\n");
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
