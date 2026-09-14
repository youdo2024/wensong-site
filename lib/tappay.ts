/*
 * TapPay 金流（Direct Pay，pay-by-prime）。
 * 文件：https://docs.tappaysdk.com ／範例：github.com/TapPay/tappay-web-example
 * 卡號只進 TapPay 的 iframe（TapPay Fields），我們的伺服器只碰 prime（90 秒一次性代碼），
 * PCI 負擔最輕。3D 驗證預設開啟（TapPay 審核要求的預設規格，責任轉移）。
 *
 * 環境變數（Zeabur 設定，缺任一即視為未啟用）：
 *   TAPPAY_PARTNER_KEY  後端金鑰（機密）
 *   TAPPAY_MERCHANT_ID  商家代號
 *   TAPPAY_APP_ID       前端 SDK 用（公開值）
 *   TAPPAY_APP_KEY      前端 SDK 用（公開值）
 *   TAPPAY_SANDBOX      "1"＝測試環境（預設）；設 "0" 才打正式環境
 */

const SANDBOX_API = "https://sandbox.tappaysdk.com";
const PROD_API = "https://prod.tappaysdk.com";

export function tappayConfig() {
  const sandbox = process.env.TAPPAY_SANDBOX !== "0";
  return {
    partnerKey: process.env.TAPPAY_PARTNER_KEY || "",
    merchantId: process.env.TAPPAY_MERCHANT_ID || "",
    appId: process.env.TAPPAY_APP_ID || "",
    appKey: process.env.TAPPAY_APP_KEY || "",
    sandbox,
    api: sandbox ? SANDBOX_API : PROD_API,
  };
}

export function tappayEnabled(): boolean {
  const c = tappayConfig();
  return Boolean(c.partnerKey && c.merchantId && c.appId && c.appKey);
}

/*
 * 沙箱預設值是這支金流最危險的設定陷阱：TAPPAY_SANDBOX 沒設就是沙箱，
 * 於是正式站會一路顯示付款成功、開發票、寄信、扣庫存，但錢一毛都沒進來，
 * 而且沒有任何錯誤。PayUni 那支的預設方向相反（沒設就是正式），
 * 兩者不一致更容易誤判。這裡不擅自翻轉預設值（免得反向誤扣真實款項），
 * 改成啟動時把實際環境大聲印出來，讓它無法被忽略。
 */
let envWarned = false;
export function warnTapPayEnvOnce(): void {
  if (envWarned || !tappayEnabled()) return;
  envWarned = true;
  const explicit = process.env.TAPPAY_SANDBOX === "0" || process.env.TAPPAY_SANDBOX === "1";
  if (tappayConfig().sandbox) {
    console.warn(
      `[tappay] ⚠️ 目前為「沙箱」環境，付款不會真的入帳。${explicit ? "" : "（TAPPAY_SANDBOX 未設定，預設即為沙箱）"}` +
        " 若這是正式站，請到 Zeabur 設定 TAPPAY_SANDBOX=0。"
    );
  } else {
    console.log("[tappay] 正式環境，3D 驗證強制開啟。");
  }
}

/* 判斷結果一律經過這裡，避免各處自行推論 record_status 的語意 */
export function tappayEnvLabel(): string {
  return tappayConfig().sandbox ? "沙箱" : "正式";
}

type TapPayResponse = {
  status: number;               // 0＝成功
  msg: string;
  rec_trade_id?: string;        // TapPay 交易編號（退款、查詢用）
  payment_url?: string;         // 3D 驗證頁（有值就要把顧客導過去）
  [k: string]: unknown;
};

async function callTapPay(path: string, data: Record<string, unknown>): Promise<TapPayResponse> {
  const c = tappayConfig();
  /* 官方文件明寫「請將 timeout 時間設定為 30 秒以避免交易資訊不同步」。
     原本沒有設，尖峰時銀行處理慢會讓請求無限期掛著。 */
  const res = await fetch(c.api + path, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": c.partnerKey },
    body: JSON.stringify(data),
    signal: AbortSignal.timeout(30_000),
  });
  /* 先看 HTTP 狀態再解析：TapPay 回 502 時 body 是 HTML，
     直接 res.json() 會拋 SyntaxError，錯誤訊息與付款完全無關、查不出真正原因。 */
  const text = await res.text();
  let json: TapPayResponse;
  try {
    json = JSON.parse(text) as TapPayResponse;
  } catch {
    throw new Error(`TapPay 回應無法解析（HTTP ${res.status}）：${text.slice(0, 200)}`);
  }
  if (!res.ok && typeof json.status !== "number") {
    throw new Error(`TapPay HTTP ${res.status}：${json.msg || text.slice(0, 200)}`);
  }
  return json;
}

/* 單次付款：orderNo 是我們的訂單編號，成功或需 3D 都以 rec_trade_id 為 TapPay 側的對應 */
export async function payByPrime(inp: {
  prime: string;
  amount: number;
  details: string;              // 交易品名（≤100 字）
  orderNo: string;
  cardholder: { name: string; email: string; phone: string };
  frontendRedirectUrl: string;  // 3D 驗證完把顧客導回哪
  backendNotifyUrl: string;     // 3D 驗證完 TapPay 背景通知哪裡
}): Promise<TapPayResponse> {
  const c = tappayConfig();
  return callTapPay("/tpc/payment/pay-by-prime", {
    partner_key: c.partnerKey,
    merchant_id: c.merchantId,
    prime: inp.prime,
    amount: inp.amount,
    currency: "TWD",
    details: inp.details.slice(0, 100),
    order_number: inp.orderNo,
    cardholder: {
      name: inp.cardholder.name,
      email: inp.cardholder.email,
      phone_number: inp.cardholder.phone,
    },
    /* 3D 驗證：正式環境一律開啟，不接受環境變數關閉。
       TAPPAY_3DS=0 只在 sandbox 有效，用來測同步成功路徑；
       原本寫成 process.env.TAPPAY_3DS !== "0"，正式站只要誤設 0 就會關掉 3D 驗證、
       失去責任轉移，而且不會有任何警告。 */
    three_domain_secure: c.sandbox ? process.env.TAPPAY_3DS !== "0" : true,
    remember: false,
    result_url: {
      frontend_redirect_url: inp.frontendRedirectUrl,
      backend_notify_url: inp.backendNotifyUrl,
    },
  });
}

/*
 * 交易查詢（Record API）：以我們的訂單編號回查。
 * notify 不帶簽章，所以入帳前一律回查 TapPay（走 TLS＋partner key，可信）比對。
 *
 * ── 回傳欄位的命名陷阱 ──
 * 請求端的 filter 叫 record_status（有底線），但回傳的 trade_records 用的是
 * recordstatus（無底線）。官方 Java SDK 的 response/record/TradeRecords.java
 * 以 @SerializedName 明確標示：rectradeid／recordstatus／bankresultmsg 全部無底線，
 * 而 request/record/GetRecordFilters.java 的 filter 才是 record_status。
 * 原本三個欄位都照請求端的命名讀，於是 Number(undefined) 得到 NaN，
 * paid 永遠是 false，回查等於從來沒有判定成功過任何一筆付款。
 * 這裡兩種命名都讀，不論對方哪個版本都能運作。
 *
 * ── 狀態值域（來源：官方 Java SDK GetRecordFilters.RecordStatus）──
 *   ERROR(-1)  AUTH(0)  OK(0)  PARTIALREFUNDED(2)  REFUNDED(3)
 * 值域裡沒有「處理中」，所以 3D 驗證途中的交易是「查無紀錄」而不是某個非 0 狀態。
 * 因此 -1 可以安全地當作明確失敗，2 與 3 代表曾經成功後被退款。
 */
export const TAPPAY_RECORD_STATUS = {
  ERROR: -1,
  OK: 0,
  PARTIAL_REFUNDED: 2,
  REFUNDED: 3,
} as const;

/* 同一筆資料可能用兩種命名其中之一，依序取第一個有值的 */
function pickField(t: Record<string, unknown>, ...names: string[]): unknown {
  for (const n of names) {
    const v = t[n];
    if (v !== undefined && v !== null) return v;
  }
  return undefined;
}

export type TapPayQueryResult = {
  found: boolean;
  paid: boolean;
  /* 明確失敗（ERROR）才是 true。查無或狀態不明一律 false，交由對帳處理 */
  failed: boolean;
  refunded: boolean;
  recTradeId: string;
  amount: number;
  bankMsg: string;
  statusCode: number;
};

/*
 * 把 Record API 回傳的 trade_records 解析成我們要的結果。
 * 獨立出來是為了能直接測「欄位命名」與「狀態判定」，不必真的打 TapPay。
 * 這兩件事正是本檔案出過最嚴重的錯，測不到就等於沒修。
 */
export function parseTradeRecords(records: Array<Record<string, unknown>>): TapPayQueryResult {
  if (!records.length) {
    /* 真的查無紀錄時 statusCode 給 NaN，不要用 -1，那是 ERROR 的值，會被誤讀成明確失敗 */
    return { found: false, paid: false, failed: false, refunded: false, recTradeId: "", amount: 0, bankMsg: "", statusCode: NaN };
  }
  const statusOf = (t: Record<string, unknown>) => Number(pickField(t, "recordstatus", "record_status") ?? NaN);
  /* 同一單號可能多筆嘗試（失敗後重試），有任何一筆成功就算付款成功 */
  const paidRec = records.find((t) => statusOf(t) === TAPPAY_RECORD_STATUS.OK);
  const refundedRec = records.find(
    (t) => statusOf(t) === TAPPAY_RECORD_STATUS.REFUNDED || statusOf(t) === TAPPAY_RECORD_STATUS.PARTIAL_REFUNDED
  );
  const latest = paidRec || refundedRec || records[0];
  const code = statusOf(latest);
  return {
    found: true,
    paid: Boolean(paidRec),
    /* 只有 ERROR 才算明確失敗；狀態讀不出來（NaN）一律不當失敗 */
    failed: !paidRec && code === TAPPAY_RECORD_STATUS.ERROR,
    refunded: Boolean(refundedRec),
    recTradeId: String(pickField(latest, "rectradeid", "rec_trade_id") ?? ""),
    amount: Number(pickField(latest, "amount") ?? 0),
    bankMsg: String(pickField(latest, "bankresultmsg", "bank_result_msg") ?? ""),
    statusCode: code,
  };
}

export async function queryByOrderNo(orderNo: string): Promise<TapPayQueryResult | null> {
  const c = tappayConfig();
  try {
    const r = await callTapPay("/tpc/transaction/query", {
      partner_key: c.partnerKey,
      records_per_page: 10,
      page: 0,
      filters: { order_number: orderNo },
    });
    const records = (r.trade_records as Array<Record<string, unknown>> | undefined) || [];
    /* status 非 0 且沒有紀錄：可能是 API 錯誤而非真的查無，回 null 讓呼叫端保持 pending */
    if (!records.length && r.status !== 0 && r.status !== 2) return null;
    return parseTradeRecords(records);
  } catch (e) {
    console.error("[tappay] 查詢異常", orderNo, e);
    return null;
  }
}
