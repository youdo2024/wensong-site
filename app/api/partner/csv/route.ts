import { NextRequest, NextResponse } from "next/server";
import { viewerScope } from "@/lib/partner";
import { partnerData, buildPartnerCsv } from "@/lib/partner-data";

/* 夥伴頁的 CSV 匯出：?id=<商品>。與畫面同一份資料，按出貨週分組附小計 */
export async function GET(req: NextRequest) {
  const scope = await viewerScope();
  if (!scope) return NextResponse.json({ error: "沒有權限" }, { status: 401 });
  const id = Number(req.nextUrl.searchParams.get("id"));
  /* 夥伴只能匯出自己的商品：資料在建立時就用自己的範圍撈，別人的 id 自然查無 */
  const p = (scope === "admin" ? partnerData() : partnerData(scope.id)).find((x) => x.id === id);
  if (!p) return NextResponse.json({ error: "查無此商品" }, { status: 404 });
  const csv = buildPartnerCsv(p);
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(`${p.name}-出貨清單.csv`)}`,
    },
  });
}
