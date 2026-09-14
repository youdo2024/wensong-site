import { NextRequest, NextResponse } from "next/server";
import { PAYUNI, decryptInfo, hashEquals, hashInfo, payuniEnabled, siteUrl } from "@/lib/payuni";
import { applyPayuniResult, type SyncResult } from "@/lib/payment-sync";
import db from "@/lib/db";

/* PayUni 前景返回（ReturnURL）：更新狀態後把消費者導回感謝頁 */
export async function POST(req: NextRequest) {
  const home = siteUrl();
  if (!payuniEnabled()) return NextResponse.redirect(home, 303);

  /* 第一段：驗簽與解密。這段失敗代表封包本身不可信，導回首頁是對的 */
  let info: Record<string, string>;
  try {
    const form = await req.formData();
    const merId = String(form.get("MerID") || "");
    const enc = String(form.get("EncryptInfo") || "");
    const hash = String(form.get("HashInfo") || "");
    if (merId !== PAYUNI.merId || !enc || !hashEquals(hashInfo(enc), hash)) {
      return NextResponse.redirect(home, 303);
    }
    info = decryptInfo(enc);
  } catch (e) {
    console.error("[payuni return] 封包解析失敗", e);
    return NextResponse.redirect(home, 303);
  }

  /*
   * 第二段：入帳。這段失敗「不能」把顧客丟回首頁——他剛付完錢，看到首頁只會以為交易失敗，
   * 然後再付一次或直接來客訴。幕後 NotifyURL 仍會補上入帳，所以這裡照樣把人帶到感謝頁，
   * 只是標成處理中。
   */
  const no = info.MerTradeNo || "";
  let result: SyncResult;
  try {
    result = applyPayuniResult(info);
  } catch (e) {
    console.error(`[payuni return] 入帳失敗 MerTradeNo=${no}，改由幕後通知補正`, e);
    if (no.startsWith("YD")) {
      return NextResponse.redirect(`${home}/shop/thanks?no=${encodeURIComponent(no)}&pay=pending`, 303);
    }
    return NextResponse.redirect(`${home}/support/thanks?pay=pending`, 303);
  }

  if (result.kind === "order") {
    /* 帶訂單權杖，感謝頁才顯示金額與繳費資訊（防編號枚舉） */
    const tok = (db.prepare("SELECT token FROM orders WHERE order_no=?").get(result.orderNo) as { token: string } | undefined)?.token || "";
    return NextResponse.redirect(
      `${home}/shop/thanks?no=${encodeURIComponent(result.orderNo)}&pay=${result.outcome}${tok ? `&k=${tok}` : ""}`,
      303
    );
  }
  if (result.kind === "sponsorship") {
    return NextResponse.redirect(
      `${home}/support/thanks?mode=${result.mode}&pay=${result.outcome}`,
      303
    );
  }
  return NextResponse.redirect(home, 303);
}
