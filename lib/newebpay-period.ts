import { encryptTradeInfo, decryptTradeInfo, newebpayConfig, newebpayEnabled } from "./newebpay";

/*
 * 藍新金流（NewebPay）信用卡定期定額，介接手冊 Version 1.5。
 *
 * 跟 lib/newebpay.ts 同一個規矩：純函式，不 import db，全部靠參數與環境變數，
 * tests/smoke.ts 才能直接測 PostData 加解密與 MerOrderNo 編碼的來回，
 * 不需要先開資料庫、也不需要真的設定環境變數就能測純邏輯那一半。
 *
 * 這支只做「建立委託」「解析回傳」「修改狀態（解約）」三件事。沒有藍新測試金鑰，
 * 下面的欄位與流程照站長提供的規格文字實作；規格沒明講的地方在 docs/newebpay-spec.md
 * 的「定期定額」一節列成假設，不在這裡憑空加規格沒說的東西（例如 MPG 那套 TradeSha，
 * 規格只講 MerchantID_／PostData_ 兩個欄位，就不多加一層簽章）。
 */

function periodGatewayUrl(test: boolean): string {
  return test ? "https://ccore.newebpay.com/MPG/period" : "https://core.newebpay.com/MPG/period";
}
function periodAlterUrl(test: boolean): string {
  return test ? "https://ccore.newebpay.com/MPG/period/AlterStatus" : "https://core.newebpay.com/MPG/period/AlterStatus";
}

/*
 * 每月扣款日：用「建立委託當天」的台北日期，29～31 一律改成 28（規格明講的收斂規則，
 * 2 月最短只有 28 天，這樣任何月份都扣得到）。
 */
export function periodPointToday(): string {
  const d = new Date(Date.now() + 8 * 3600_000);
  const day = d.getUTCDate();
  return String(day > 28 ? 28 : day).padStart(2, "0");
}

/*
 * MerOrderNo：WP ＋ 贊助 id ＋ X ＋ 時間戳尾 6 碼。比照 lib/newebpay.ts 的 newebpaySponsorMtn，
 * 自己用 WP 這個前綴，跟單筆 MPG 的 WS、商店的 WO 分開放，回呼進來一眼就知道該分流去哪一支，
 * 不用先猜這筆是委託建立還是單筆付款。
 *
 * 規格要求 20 碼內（比 MPG 的 30 碼更緊），中間一樣夾一個固定的 X 分隔字元：
 * 時間戳是 36 進位，可能剛好以數字開頭，沒有這個字元的話「id 後面幾碼」會被
 * 貪婪的 \d+ 一起吃進去，還原出錯的贊助 id（跟 newebpaySponsorMtn 同一個理由）。
 */
export function newebpayPeriodMtn(id: number): string {
  const ts = Date.now().toString(36).toUpperCase().slice(-6);
  return `WP${id}X${ts}`.slice(0, 20);
}
export function sponsorIdFromNewebpayPeriodMtn(mtn: string): number {
  const m = /^WP(\d+)X/.exec(String(mtn || ""));
  return m ? Number(m[1]) : 0;
}
export function isNewebpayPeriodMtn(mtn: string): boolean {
  return /^WP\d+X/.test(String(mtn || ""));
}

/*
 * 組出送往藍新「建立委託」的表單欄位（MerchantID_／PostData_），由付款頁自動 POST 過去。
 * 回傳同時附上這次用的 MerOrderNo，呼叫端要存進贊助的 trade_no，並記進
 * lib/sponsor-trade-no.ts 的歷史表——之後解約要靠這個歷史表才找得回原始委託編號
 * （首期成功後 trade_no 會被換成藍新的 TradeNo，見 app/api/newebpay/period/notify）。
 */
export function buildPeriodForm(opts: {
  sponsorshipId: number;
  amount: number;
  email: string;
  desc: string;
}): { action: string; fields: Record<string, string>; merOrderNo: string } {
  const cfg = newebpayConfig();
  const site = (process.env.SITE_URL || "https://www.wensong.tw").replace(/\/$/, "");
  const merOrderNo = newebpayPeriodMtn(opts.sponsorshipId);
  const p: Record<string, string | number> = {
    RespondType: "JSON",
    TimeStamp: Math.floor(Date.now() / 1000),
    Version: "1.5",
    LangType: "zh-Tw",
    MerOrderNo: merOrderNo,
    ProdDesc: String(opts.desc || "").slice(0, 100) || "每月支持",
    PeriodAmt: Math.round(opts.amount),
    PeriodType: "M",
    PeriodPoint: periodPointToday(),
    PeriodStartType: 2, /* 立即執行首期授權 */
    PeriodTimes: 99,
    ReturnURL: `${site}/api/newebpay/period/return`,
    NotifyURL: `${site}/api/newebpay/period/notify`,
    PayerEmail: opts.email,
    PaymentInfo: "N",
    OrderInfo: "N",
    EmailModify: 0,
  };
  const postData = encryptTradeInfo(p, cfg.hashKey, cfg.hashIV);
  return {
    action: periodGatewayUrl(cfg.test),
    fields: { MerchantID_: cfg.merchantId, PostData_: postData },
    merOrderNo,
  };
}

export type NewebpayPeriodResult = {
  ok: boolean; /* Status === "SUCCESS" */
  status: string;
  message: string;
  merOrderNo: string;
  periodNo: string; /* 委託單號，解約要靠它 */
  tradeNo: string; /* 這一期扣款的交易序號 */
  amt: number;
  alreadyTimes: number; /* 已扣款期數：<=1 是首期，之後每一次通知都會遞增 */
  authTime: string;
};

/*
 * 解析 ReturnURL／NotifyURL 收到的 POST 表單（欄位只有 Period，是 AES 加密的 JSON）。
 * 規格沒有另外附一個像 MPG TradeSha 那樣的簽章欄位，能用同一把 HashKey／HashIV 解出
 * 合法 JSON 本身就是驗證：金鑰不對或內容被竄改，AES-256-CBC 的 PKCS7 padding 會直接炸開，
 * 解不出東西一律回 null，呼叫端當這筆不可信處理。
 */
export function parsePeriodNotify(body: Record<string, string>): NewebpayPeriodResult | null {
  if (!newebpayEnabled()) return null;
  const cfg = newebpayConfig();
  const enc = body.Period || "";
  if (!enc) return null;
  let json: { Status?: string; Message?: string; Result?: Record<string, unknown> };
  try {
    json = JSON.parse(decryptTradeInfo(enc, cfg.hashKey, cfg.hashIV));
  } catch {
    return null;
  }
  const status = String(json.Status || "");
  const result = (json.Result || {}) as Record<string, unknown>;
  return {
    ok: status === "SUCCESS",
    status,
    message: String(json.Message || ""),
    merOrderNo: String(result.MerOrderNo || ""),
    periodNo: String(result.PeriodNo || ""),
    tradeNo: String(result.TradeNo || ""),
    amt: Number(result.PeriodAmt ?? result.Amt ?? 0),
    alreadyTimes: Number(result.AlreadyTimes || 0),
    authTime: String(result.AuthTime || ""),
  };
}

/*
 * 修改委託狀態（目前只用得到解約 terminate）。伺服器對伺服器打過去，
 * 回應格式規格只寫「回傳 period 加密 JSON」，沒講清楚是「整包再包一層 Period 欄位」
 * 還是「直接就是解密後的 JSON」。這裡兩種都接：先看有沒有 Period 欄位，有就解密再判斷，
 * 沒有就直接看外層的 Status（這是本次施工自己的假設，見 docs/newebpay-spec.md）。
 */
export async function alterPeriodStatus(
  merOrderNo: string,
  periodNo: string,
  alterType: "terminate"
): Promise<{ ok: boolean; message: string }> {
  if (!newebpayEnabled()) return { ok: false, message: "newebpay 未啟用" };
  const cfg = newebpayConfig();
  const p: Record<string, string | number> = {
    RespondType: "JSON",
    Version: "1.0",
    TimeStamp: Math.floor(Date.now() / 1000),
    MerOrderNo: merOrderNo,
    PeriodNo: periodNo,
    AlterType: alterType,
  };
  const postData = encryptTradeInfo(p, cfg.hashKey, cfg.hashIV);
  try {
    const res = await fetch(periodAlterUrl(cfg.test), {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ MerchantID_: cfg.merchantId, PostData_: postData }).toString(),
      signal: AbortSignal.timeout(20_000),
    });
    const raw = await res.text();
    let outer: { Status?: string; Message?: string; Period?: string } | null = null;
    try {
      outer = JSON.parse(raw);
    } catch {
      outer = null;
    }
    if (!outer) return { ok: false, message: `HTTP ${res.status}` };
    if (outer.Period) {
      try {
        const inner = JSON.parse(decryptTradeInfo(outer.Period, cfg.hashKey, cfg.hashIV)) as { Status?: string; Message?: string };
        return { ok: inner.Status === "SUCCESS", message: inner.Message || inner.Status || "" };
      } catch {
        return { ok: false, message: "解密失敗" };
      }
    }
    return { ok: outer.Status === "SUCCESS", message: outer.Message || outer.Status || "" };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}
