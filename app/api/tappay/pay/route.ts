import { NextRequest, NextResponse } from "next/server";
import db from "@/lib/db";
import { payByPrime, queryByOrderNo, tappayEnabled, warnTapPayEnvOnce } from "@/lib/tappay";
import { applyTappayOrderResult, settleTappayFromQuery } from "@/lib/payment-sync";
import { rateLimit, clientIp } from "@/lib/ratelimit";

/*
 * 商店訂單 TapPay 站內刷卡：前端 TapPay Fields 產出 prime 後打這裡。
 * 訂單已由 /api/orders 建立（pending、庫存已扣），這裡只負責請款：
 *   · 3D 驗證（預設規格）→ 回 payment_url，前端把顧客導去銀行驗證，
 *     結果由 /api/tappay/notify（背景）與 /api/tappay/redirect（導回）收尾
 *   · 極少數免 3D → 同步 status=0 直接入帳
 * 失敗時訂單維持 pending，顧客可直接重試（重新輸卡再產一次 prime）。
 */

/* 請款鎖有效期。3D 驗證期間鎖著不放，避免顧客在銀行頁還沒完成就回來重刷。 */
const LOCK_MS = 10 * 60 * 1000;

export async function POST(req: NextRequest) {
  if (!rateLimit(`tappay:${clientIp(req.headers)}`, 10, 10 * 60 * 1000))
    return NextResponse.json({ error: "操作太頻繁，請稍後再試" }, { status: 429 });
  if (!tappayEnabled()) return NextResponse.json({ error: "TapPay 未設定" }, { status: 400 });
  warnTapPayEnvOnce();

  const body = (await req.json().catch(() => null)) as { orderNo?: string; prime?: string; token?: string } | null;
  const orderNo = String(body?.orderNo || "");
  const prime = String(body?.prime || "");
  const token = String(body?.token || "");
  if (!orderNo.startsWith("YD") || !prime)
    return NextResponse.json({ error: "格式錯誤" }, { status: 400 });

  const o = db
    .prepare("SELECT id,order_no,name,email,phone,items,total,status,token FROM orders WHERE order_no=?")
    .get(orderNo) as
    | { id: number; order_no: string; name: string; email: string; phone: string; items: string; total: number; status: string; token: string }
    | undefined;

  /*
   * 身分驗證與錯誤訊息統一：原本「查無訂單」回 404、「已處理過」回 400，
   * 等於把訂單編號當成可探測的資源。訂單編號是 YD＋日期＋四位流水號、可枚舉，
   * 於是任何人都能問出哪些編號存在、哪幾筆還沒付款。現在一律回同一種錯誤。
   * 權杖為空的舊訂單維持原行為，否則舊訂單會突然無法付款。
   */
  const bad = () => NextResponse.json({ error: "這筆訂單無法付款，請回商店重新下單" }, { status: 400 });
  if (!o) return bad();
  if (o.token && o.token !== token) return bad();
  if (o.status !== "pending") return bad();

  /*
   * 請款鎖：原本只用 if (o.status !== "pending") 擋，那是讀記憶體變數，
   * 兩個請求同時進來會雙雙通過，接著各送一次 payByPrime，顧客被扣兩次款。
   * 改用條件式 UPDATE 搶佔，搶不到的直接拒絕。逾時的鎖可被重新取得，
   * 避免請款途中當機讓訂單永遠鎖死。
   */
  const nowIso = new Date().toISOString();
  const expiredBefore = new Date(Date.now() - LOCK_MS).toISOString();
  const lock = db
    .prepare(
      "UPDATE orders SET charge_lock_at=? WHERE id=? AND status='pending' AND (COALESCE(charge_lock_at,'')='' OR charge_lock_at < ?)"
    )
    .run(nowIso, o.id, expiredBefore);
  if (lock.changes === 0)
    return NextResponse.json({ error: "這筆訂單正在處理中，請稍候幾分鐘再試，不要重複送出" }, { status: 409 });

  const releaseLock = () => {
    try {
      db.prepare("UPDATE orders SET charge_lock_at='' WHERE id=? AND status='pending'").run(o.id);
    } catch (e) {
      console.error("[tappay pay] 釋放請款鎖失敗", o.order_no, e);
    }
  };

  let details = "商店訂單";
  try {
    const items = JSON.parse(o.items) as { name: string; qty: number }[];
    details = items.map((i) => `${i.name}x${i.qty}`).join(";") || details;
  } catch (e) {
    /* 原本是空 catch。品名解析失敗不影響付款，但要留下痕跡，否則對帳時看到
       一堆「商店訂單」會完全不知道發生過什麼。 */
    console.error("[tappay pay] 品名解析失敗，改用預設品名", o.order_no, e);
  }

  const site = (process.env.SITE_URL || "https://www.wensong.tw").replace(/\/$/, "");
  /* 導回網址帶上訂單權杖：redirect 那支才有辦法驗證來人是不是本人，
     否則它會把 token 放進網址發給任何知道訂單編號的人。 */
  const backTok = o.token ? `&k=${encodeURIComponent(o.token)}` : "";

  let r;
  try {
    r = await payByPrime({
      prime,
      amount: o.total,
      details,
      orderNo: o.order_no,
      cardholder: { name: o.name, email: o.email, phone: o.phone || "" },
      frontendRedirectUrl: `${site}/api/tappay/redirect?no=${encodeURIComponent(o.order_no)}${backTok}`,
      backendNotifyUrl: `${site}/api/tappay/notify`,
    });
  } catch (e) {
    /*
     * 這裡最危險：連線逾時或回應解析失敗「不等於」沒扣款，TapPay 那邊可能已經授權成功。
     * 原本沒有 try/catch，例外會直接變成 500，顧客看到失敗後很可能再刷一次而重複付款。
     * 所以先回查一次確認真實狀態，確定成功就照常入帳。
     */
    console.error("[tappay pay] 請款呼叫失敗，改回查確認", o.order_no, e);
    const q = await queryByOrderNo(o.order_no);
    if (q && settleTappayFromQuery(o.order_no, q) === "paid") {
      return NextResponse.json({ paid: true });
    }
    releaseLock();
    return NextResponse.json(
      { error: "付款結果尚未確認，請先不要重複刷卡。稍後到訂單查詢確認狀態，或與我們聯繫。" },
      { status: 502 }
    );
  }

  if (r.status === 0 && r.payment_url) {
    /* 3D 驗證：把顧客導去銀行頁。鎖繼續持有，這是進行中的交易 */
    return NextResponse.json({ paymentUrl: r.payment_url });
  }
  if (r.status === 0) {
    /* 免 3D，同步成功：直接入帳（開發票、寄信、GA 都在裡面）。
       金額一定要傳，否則 applyTappayOrderResult 的金額防禦會因為 undefined 而整段跳過。 */
    applyTappayOrderResult(o.order_no, "paid", String(r.rec_trade_id || ""), "TapPay 授權成功", o.total);
    return NextResponse.json({ paid: true });
  }
  /* 明確的授權失敗（status 非 0 是文件定義的失敗，可信）：放開鎖讓顧客換卡重試 */
  console.error("[tappay pay]", o.order_no, r.status, r.msg);
  releaseLock();
  return NextResponse.json(
    { error: `付款沒有成功（${r.msg || r.status}），可以再試一次或改用其他卡片` },
    { status: 400 }
  );
}
