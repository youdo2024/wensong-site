import { NextRequest, NextResponse } from "next/server";
import db from "@/lib/db";
import { verifyEcpayCallback, ecpayConfig, ecpayPayLabel, orderNoFromMtn } from "@/lib/ecpay";
import { applyEcpayOrderResult } from "@/lib/payment-sync";
import { settleSponsorOncePaid } from "@/lib/sponsor-settle";
import { sponsorByTradeNo, staleSponsorPaymentAction } from "@/lib/sponsor-trade-no";
import { notifySponsorStaleTradeNo } from "@/lib/notify";

/*
 * 綠界付款結果通知（單筆與定期定額首期都會打這裡）。
 * 驗簽 → 標記付款完成 → 開光貿發票 → 寄感謝信 → 回 1|OK。
 */
export async function POST(req: NextRequest) {
  const body = Object.fromEntries(new URLSearchParams(await req.text())) as Record<string, string>;
  /* 未設正式金鑰時一律拒絕：避免退回公開測試金鑰而被偽造通知 */
  if (!ecpayConfig().live) return new NextResponse("0|not live", { status: 400 });
  if (!verifyEcpayCallback(body)) {
    console.error("[ecpay return] 驗簽失敗", body.MerchantTradeNo);
    return new NextResponse("0|CheckMacValue Error", { status: 400 });
  }

  const mtn = body.MerchantTradeNo || "";

  /* 商店訂單（YD 前綴）與贊助（SP）共用同一支通知網址，靠編號前綴分流。
     入帳、開發票、寄信、回補庫存的完整流程在 payment-sync，與 TapPay 那條共用。 */
  if (mtn.startsWith("YD")) {
    const paid = body.RtnCode === "1";
    const amount = Number(body.TradeAmt) || undefined;
    /* 綠界的 PaymentType 例：Credit_CreditCard、ATM_TAISHIN、TWQR_OPAY */
    const label = ecpayPayLabel(body.PaymentType || "");
    /* 重試單號（YD…R…）要先還原成訂單編號才找得到那筆訂單 */
    applyEcpayOrderResult(
      orderNoFromMtn(mtn),
      paid ? "paid" : "failed",
      body.TradeNo || "",
      label,
      paid ? `綠界付款成功（${body.PaymentType || ""}）`.trim() : `付款未完成（${body.RtnCode} ${body.RtnMsg || ""}）`,
      paid ? amount : undefined
    );
    return new NextResponse("1|OK");
  }

  /*
   * 先比對現行 trade_no（跟以前完全一樣），對不到才查單號歷史。
   * 為什麼要查歷史：換付款方式或重試會把 trade_no 覆寫掉，
   * 但綠界那組舊的虛擬帳號並不會跟著失效。有人先取 ATM 帳號、改刷卡、
   * 幾天後還是照舊帳號轉了錢，以前這裡一筆都比對不到，
   * 就這樣回 1|OK：錢收了、贊助紀錄停在待付款、站長永遠不知道。
   */
  const hit = sponsorByTradeNo(mtn);
  if (!hit) return new NextResponse("1|OK"); // 找不到就回 OK，避免綠界重送轟炸
  const sp = { id: hit.id };
  /* 舊單號入帳時那筆贊助當下的狀態，等入帳跑完要寫進給站長的信裡 */
  let staleStatus = "";

  if (body.RtnCode === "1") {
    /* ── 錢打在已經被換掉的那組單號上 ── */
    if (hit.stale) {
      const cur = db.prepare("SELECT status FROM sponsorships WHERE id=?").get(sp.id) as { status: string } | undefined;
      const already = staleSponsorPaymentAction(cur?.status || "") === "duplicate";
      /*
       * 這筆贊助早就收過錢了，現在舊帳號又進一筆＝重複付款（刷卡付完又去轉帳）。
       * 絕對不可以再入帳一次：重複開發票要作廢、重複道謝會讓人以為被扣兩次，
       * 而且贊助的任何欄位都不該被這封通知改寫。
       * 這裡只做一件事，就是把站長叫起來，因為這筆錢得他自己去退。
       */
      if (already) {
        console.error("[ecpay return] 舊單號重複入帳", mtn, "贊助", sp.id, cur?.status);
        void notifySponsorStaleTradeNo({
          spId: sp.id, mtn, amount: Number(body.TradeAmt) || 0, duplicate: true, status: cur?.status || "",
        }).catch((e) => console.error("[ecpay return] 重複付款通知", sp.id, e));
        return new NextResponse("1|OK");
      }
      /* 還是待付款：這是單純的晚到轉帳，錢就是這筆的。
         照一般付款流程走下去（下面那段），不另外發明入帳邏輯；
         通知等入帳跑完再寄，因為「有沒有真的入帳」決定站長要不要動手（見下面 settled）。 */
      staleStatus = cur?.status || "";
    }
    /*
     * 綠界會重送通知，而且與 OrderResultURL 幾乎同時抵達。
     * 守門條件必須下放到 SQL 的 WHERE，不能先讀 sp.status 再無條件 UPDATE：
     * 舊寫法兩份通知都會通過那個記憶體判斷，結果是開兩張發票、寄兩封感謝信、
     * GA 算兩次、sponsor_charges 也插兩筆。重複發票得作廢，稅務上比重複寄信麻煩得多。
     * 改由資料庫的單筆 UPDATE 保證只有一個贏家，後續動作只有贏家做。
     *
     * 這一整段（搶佔、開發票、寄信、GA）以前在這裡、對帳、幕後取號回呼各寫一份，
     * 三份已經漂開，所以搬進 lib/sponsor-settle 只留一份實作，這裡只負責分流。
     * 它同時會把「系統自動判失敗」的贊助翻回待付款：ATM 帳號的效期比 48 小時長，
     * 顧客隔天才去轉帳時錢是真的收到了，不能因為狀態已經是 failed 就默默吃掉。
     */
    const now = new Date().toISOString();
    const settled = settleSponsorOncePaid(sp.id, mtn, "", {
      monthlyNote: `首期授權成功 ${now.slice(0, 10)}`,
      gatewayTradeNo: body.TradeNo || "",
    });
    /*
     * 舊單號進來的錢一定要通知站長，而且分兩種寫法：
     * settled=true  → 錢已經照一般流程入帳、開票、道謝完了，他不用做任何事，只是要知道有這回事。
     * settled=false → 錢收了但系統沒有入帳（狀態已經不是待付款，例如站長手動取消過）。
     *   這種錢會停在金流商那裡沒有對應的贊助紀錄，一定要有人去處理，所以寄那封大聲的。
     * 射後不理並且自帶 .catch：寄信失敗絕對不可以害這支回呼掛掉，綠界那邊會一直重送。
     */
    if (hit.stale) {
      void notifySponsorStaleTradeNo({
        spId: sp.id, mtn, amount: Number(body.TradeAmt) || 0, duplicate: !settled, status: staleStatus,
      }).catch((e) => console.error("[ecpay return] 舊帳號入帳通知", sp.id, e));
    }
  } else if (!hit.stale) {
    /* 失敗也走條件式：已付款或已取消的紀錄不能被重送的失敗封包改寫。
       這是金流明確回報的失敗，不是系統自己判的，所以不寫自動標記、也不該被自動翻回待付款 */
    db.prepare("UPDATE sponsorships SET status='failed', last_charge_note=? WHERE id=? AND status='pending'")
      .run(`付款未完成（${body.RtnCode} ${body.RtnMsg || ""}）`, sp.id);
  }
  /* 舊單號回報失敗就什麼都不做：那是「已經被放棄的那次嘗試」失敗了，
     跟客人現在正在進行的付款無關，拿它去把 pending 打成 failed 只會害人白跑一趟。 */
  return new NextResponse("1|OK");
}
