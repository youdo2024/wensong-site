import { NextRequest, NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import { settlement } from "@/lib/settlement";
import { csvCell } from "@/lib/csv";

/* 結算報表 CSV：與畫面同一份計算（lib/settlement.ts），給記帳與對帳用 */
export async function GET(req: NextRequest) {
  if (!(await isAdmin())) return NextResponse.json({ error: "沒有權限" }, { status: 401 });
  const from = String(req.nextUrl.searchParams.get("from") || "").slice(0, 10);
  const to = String(req.nextUrl.searchParams.get("to") || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to))
    return NextResponse.json({ error: "日期格式不對" }, { status: 400 });
  const utcFrom = new Date(`${from}T00:00:00+08:00`).toISOString();
  const utcTo = new Date(new Date(`${to}T00:00:00+08:00`).getTime() + 24 * 3600 * 1000).toISOString();
  const rows = settlement(utcFrom, utcTo);
  /* 公式注入防護見 lib/csv.ts */
  const esc = csvCell;
  const out: string[] = [];
  out.push(`${esc(`結算報表 ${from} ~ ${to}`)}`);
  out.push(["出貨夥伴", "銷售額", "份數", "訂單數", "額外贊助", "常溫宅配(件)", "常溫店到店(件)", "冷凍宅配(件)", "冷凍店到店(件)", "運費收入", "運費成本", "運費損益", "退款單"].map(esc).join(","));
  for (const r of rows)
    out.push([esc(r.partnerName), r.sales, r.units, r.orderCount, r.addonRef, r.parcelHome, r.parcelCvs, r.parcelCold, r.parcelColdCvs, r.freight, r.freightCost, r.freight - r.freightCost, r.refundOrders].join(","));
  return new NextResponse("\ufeff" + out.join("\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(`結算報表-${from}-${to}.csv`)}`,
    },
  });
}
