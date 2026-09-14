import { NextRequest, NextResponse } from "next/server";
import db, { json } from "@/lib/db";
import { isAdmin } from "@/lib/auth";
import { ORDER_STATUS, fmtDateTimeDash } from "@/lib/format";
import { cvsPickupText } from "@/lib/multi-ship";
import { zipDisplay } from "@/lib/zip-lookup";
import { csvCell } from "@/lib/csv";
import { isCvsMethod } from "@/lib/cvs";

/* 匯出訂單名單（CSV with BOM，Excel 直接開啟） */
/* 多地址名單轉成一格文字：姓名/電話/地址/盒數（已出貨的標星號） */
function multiText(raw: string): string {
  type R = { name?: string; phone?: string; address?: string; qty?: number; shipped?: number;
             shipMethod?: string; storeName?: string; storeNo?: string; zip?: string };
  let list: R[] = [];
  try { list = JSON.parse(raw || "[]"); } catch { return ""; }
  if (!Array.isArray(list) || list.length === 0) return "";
  const where = (r: R) =>
    isCvsMethod(r.shipMethod)
      ? cvsPickupText(r.storeName, r.storeNo)
      /* 宅配收件人：3 碼前綴進地址（推不出就原樣），跟出貨工作台同一套規則 */
      : zipDisplay(r.address, r.zip).text;
  return list
    .map((r, i) => `${i + 1}.${r.shipped ? "★" : ""}${r.name || ""}/${r.phone || ""}/${where(r)}/${r.qty || 0}盒`)
    .join("；");
}

export async function GET(req: NextRequest) {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const status = req.nextUrl.searchParams.get("status") || "all";
  const code = (req.nextUrl.searchParams.get("code") || "").trim().toUpperCase();
  /* 按商品／規格匯出：?product=<商品id>&choice=<規格文字>（規格可留空＝該商品全部） */
  const productId = Number(req.nextUrl.searchParams.get("product")) || 0;
  const choice = (req.nextUrl.searchParams.get("choice") || "").trim();
  let rows = (
    code
      ? db.prepare("SELECT * FROM orders WHERE discount_code=? ORDER BY id DESC").all(code)
      : status === "all"
        ? db.prepare("SELECT * FROM orders ORDER BY id DESC").all()
        : db.prepare("SELECT * FROM orders WHERE status=? ORDER BY id DESC").all(status)
  ) as {
    order_no: string; name: string; phone: string; email: string; address: string; zip: string; ship_method: string; ship_list: string;
    pay_method: string; invoice_type: string; invoice_data: string; items: string;
    subtotal: number; shipping: number; total: number; status: string; created_at: string;
    addon_amount: number; discount_code: string; discount_amount: number;
    invoice_no: string; pay_note: string; remind_count: number; source: string; env: string;
  }[];

  /* 商品／規格過濾：只留下含有該品項的訂單，並算出符合的數量 */
  const matchQty = new Map<string, number>();
  if (productId > 0) {
    rows = rows.filter((o) => {
      const qty = json<{ id: number; choice: string | null; qty: number }[]>(o.items, [])
        .filter((i) => i.id === productId && (!choice || (i.choice || "") === choice))
        .reduce((s, i) => s + i.qty, 0);
      if (qty > 0) matchQty.set(o.order_no, qty);
      return qty > 0;
    });
  }

  /* 公式注入防護見 lib/csv.ts */
  const esc = csvCell;
  const lines = [
    [...(productId > 0 ? ["符合數量"] : []), "訂單編號", "狀態", "收件人", "電話", "Email", "取貨方式", "地址", "多地址收件名單", "品項明細", "小計", "折扣碼", "折抵金額", "加購贊助", "運費", "總金額", "付款方式", "發票", "發票號碼", "來源頁", "瀏覽器環境", "待付款提醒", "金流備註", "成立時間"].join(","),
    ...rows.map((o) => {
      const items = json<{ name: string; choice: string | null; qty: number }[]>(o.items, [])
        .map((i) => `${i.name}${i.choice ? `(${i.choice})` : ""}x${i.qty}`)
        .join(" / ");
      const inv = json<Record<string, string>>(o.invoice_data, {});
      const invText =
        o.invoice_type === "b2b"
          ? `三聯式 ${inv.company || ""} ${inv.taxId || ""}`
          : `二聯式 ${inv.carrierType || ""} ${inv.carrierNo || ""}`;
      return [
        ...(productId > 0 ? [matchQty.get(o.order_no) || 0] : []),
        esc(o.order_no), esc(ORDER_STATUS[o.status] ?? o.status), esc(o.name), esc(o.phone), esc(o.email), esc(o.ship_method || "宅配"),
        /* 宅配單的地址帶 3 碼前綴（手動值優先，推不出就原樣）；超商單照舊 */
        esc(isCvsMethod(o.ship_method) ? o.address : zipDisplay(o.address, o.zip).text),
        /* 多地址配送：整份名單塞同一格，用分號隔開。Excel 一格內換行會讓很多人的檔案爛掉 */
        esc(multiText(o.ship_list)),
        esc(items), o.subtotal, esc(o.discount_code), o.discount_amount, o.addon_amount, o.shipping, o.total,
        esc(o.pay_method), esc(invText.trim()), esc(o.invoice_no || ""),
        esc(o.source || ""),
        esc(o.env === "fb" ? "FB內建" : o.env === "ig" ? "IG內建" : o.env === "line" ? "LINE內建" : o.env === "wv" ? "其他App內建" : "一般瀏覽器"),
        /* 待付款提醒次數：對帳寄了幾封催款信。看到「已寄 2 次」還是待付款，
           就知道這位顧客是真的沒付，不用再私訊問一次 */
        esc(o.status === "pending" ? (o.remind_count ? `已寄 ${o.remind_count} 次` : "尚未提醒") : ""),
        esc(o.pay_note || ""),
        esc(fmtDateTimeDash(o.created_at)),
      ].join(",");
    }),
  ];
  const csv = "﻿" + lines.join("\r\n");

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="orders-${productId ? `product-${productId}${choice ? "-" + encodeURIComponent(choice) : ""}` : code ? `code-${code}` : status}.csv"`,
    },
  });
}
