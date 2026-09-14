import { NextRequest, NextResponse } from "next/server";
import { PAYUNI, decryptInfo, hashEquals, hashInfo, payuniEnabled } from "@/lib/payuni";
import { applyPayuniResult } from "@/lib/payment-sync";

/* PayUni 幕後通知（NotifyURL）：付款結果以此為準 */
export async function POST(req: NextRequest) {
  if (!payuniEnabled()) return new NextResponse("payuni disabled", { status: 400 });
  let merTradeNo = "";
  try {
    const form = await req.formData();
    const merId = String(form.get("MerID") || "");
    const enc = String(form.get("EncryptInfo") || "");
    const hash = String(form.get("HashInfo") || "");
    if (merId !== PAYUNI.merId) return new NextResponse("merid mismatch", { status: 400 });
    if (!enc || !hashEquals(hashInfo(enc), hash)) return new NextResponse("hash mismatch", { status: 400 });

    const info = decryptInfo(enc);
    merTradeNo = info.MerTradeNo || "";
    applyPayuniResult(info);
    return new NextResponse("OK");
  } catch (e) {
    /*
     * 這裡回 500 是刻意的：讓 PayUni 重送。漏掉一筆付款遠比重複收到通知嚴重，
     * 而 applyPayuniResult 已改成條件式 UPDATE 搶佔，重送不會重複入帳、重複寄信或重複回補庫存。
     * 單號一定要寫進 log，否則事後完全無從追起（原本只印例外物件，連是哪一筆都不知道）。
     */
    console.error(`[payuni notify] 處理失敗 MerTradeNo=${merTradeNo || "(未解出)"}`, e);
    return new NextResponse("error", { status: 500 });
  }
}
