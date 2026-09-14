/*
 * 藍新金流（NewebPay）Apple Pay 幕後支付：Apple Pay 按鈕直接長在本站的支持頁與結帳頁，
 * 客人不跳轉藍新頁面，付款 token 由本站後端直接送藍新扣款。
 *
 * 跟 lib/newebpay.ts 一樣刻意不 import db，純函式，tests/smoke.ts 能直接載入測試。
 *
 * ══════════════════════════════════════════════════════════════════════════
 * 查證結論（2026-09-14，直接下載官方 PDF 讀原文，不是憑印象或第三方部落格／SDK）
 * ══════════════════════════════════════════════════════════════════════════
 *
 * 來源：藍新官網「Apple Pay」頁 https://www.newebpay.com/website/Page/content/apple_pay
 * 底部「操作說明手冊下載」只公開三份文件：
 *   1. Apple_Pay_Foreground_Transaction_manual.pdf
 *      （幕前，APPLEPAY=1 跳轉藍新頁那條，已在 lib/newebpay.ts 做了，見
 *      docs/newebpay-spec.md「Apple Pay」一節）
 *   2. Apple_Pay_Background_Transaction_develper_verification_manual.pdf
 *      （幕後：Apple 開發者帳號驗證，2023.8.26 版）
 *   3. Apple_Pay_Background_Transaction_domain_verification_manual.pdf
 *      （幕後：商店網域驗證，2024.8.26 版，問爽的走這一條，public/.well-known/
 *      裡的驗證檔就是照這份手冊放的）
 *
 * 這三份手冊的內容全部只是「怎麼在藍新會員專區點按鈕、上傳憑證、完成驗證」的操作
 * 截圖說明，完全沒有 API 技術規格：沒有網址、沒有 PostData_ 欄位表、沒有加密方式、
 * 沒有回傳格式。第 2、3 份手冊在「驗證列表」那一步的最後一句原文一字不差：
 *
 *   「驗證成功後，請聯絡藍新夥伴或是客服進行後續相關 IP 設定，並取得串接文件」
 *
 * 也就是說：Apple Pay 幕後支付真正的技術文件（onvalidatemerchant 要打藍新哪一支 API
 * 換 merchant session、扣款 API 的網址與 PostData_ 完整欄位、回傳格式與簽章驗法、
 * 退款 API 名稱）根本不是公開文件，是網域驗證通過後由藍新業務／客服「另外核發」，
 * 而且要先讓藍新把商店伺服器的來源 IP 加進白名單，兩者都還沒做。
 *
 * 依照「查不到的部分不要猜」的原則，下面 buildMerchantSessionRequest／chargeApplePay
 * 兩支故意不接真正的網路請求，一律回傳「未取得技術文件」，讓上層 API 路由老實回報，
 * 而不是照抄同一個藍新帳號底下其他 API 家族的命名慣例（例如定期定額用的
 * MerchantID_／PostData_，見 lib/newebpay-period.ts）去賭 Apple Pay 幕後這支的欄位
 * 名稱——賭錯的後果可能是藍新回一個看不懂的錯誤，更糟的是格式剛好被接受但欄位語意
 * 不對，安靜地扣錯金額或者扣了款但本站不知道，那比「老實說功能還沒好」危險得多。
 *
 * 站長要打開這條路時：打電話（02-2786-3655）或寄信（cs@newebpay.com）給藍新，說
 * 「已完成 Apple Pay 幕後支付商店網域驗證（商店代號查會員專區），要索取串接文件並
 * 設定 IP 白名單」，拿到文件後把下面兩支函式換成真正的 fetch／加解密，其餘（設定
 * 開關、路由骨架、限流、冪等、前端 Apple Pay 按鈕、CSP）都已經接好，不用重寫。
 *
 * 另外查到但屬於「搜尋引擎摘要，非直接讀到藍新官方原文」的線索，可信度較低、
 * 這裡不當作查證結論使用，只留給站長聯絡業務時參考：网路上有资料显示藍新的
 * 「信用卡幕後授權」（背景交易，Apple Pay 應該是走同一條清算軌道）要求特約商店
 * 每年提供 PCI DSS 認證合規聲明文件；如果屬實，這對只是想收 Apple Pay 的小站是不
 * 小的合規負擔，值得站長跟業務確認清楚 Apple Pay 幕後是否也適用同一個要求。
 */

/*
 * Apple Pay JS 的 PaymentRequest 基本欄位。這部分是 Apple 官方公開規格
 * （developer.apple.com Apple Pay on the Web），不是藍新的秘密，可以放心先做：
 *   - countryCode="TW"／currencyCode="TWD"：問爽的自己的商業事實（台灣、新台幣），沒有查證疑慮
 *   - merchantCapabilities=["supports3DS"]：Apple 文件列出的選項只有
 *     supports3DS／supportsCredit／supportsDebit／supportsEMV，supports3DS 是最基本必要值
 *   - supportedNetworks=["visa","masterCard","amex","jcb"]：台灣信用卡收單業界慣例組合
 *     （多家台灣金流商的 Apple Pay 幕前串接常見清單），**不是**藍新幕後 API 文件明載的清單
 *     ——那份清單目前查不到。拿到藍新的真正串接文件後應該對照一次，確認有沒有卡別對不上。
 */
export type ApplePayRequestBase = {
  countryCode: string;
  currencyCode: string;
  supportedNetworks: string[];
  merchantCapabilities: string[];
};

export function applePayPaymentRequestBase(): ApplePayRequestBase {
  return {
    countryCode: "TW",
    currencyCode: "TWD",
    /* 業界慣例參考，未經藍新幕後 API 文件證實，見檔頭查證說明 */
    supportedNetworks: ["visa", "masterCard", "amex", "jcb"],
    merchantCapabilities: ["supports3DS"],
  };
}

export type MerchantSessionResult = { ok: true; session: Record<string, unknown> } | { ok: false; reason: string };

/*
 * 未查證：藍新沒有公開這支 API 的網址、參數與簽章方式（見檔頭說明）。
 * 故意不猜測、不亂打任何網址，一律回「未取得技術文件」，呼叫端要把這個原因老實地
 * 回應給前端，讓 Apple Pay 按鈕優雅失敗（改選其他付款方式），而不是卡住或報錯誤訊息。
 */
export async function buildMerchantSessionRequest(_opts: {
  validationURL: string;
  domainName: string;
  displayName: string;
}): Promise<MerchantSessionResult> {
  return { ok: false, reason: "NEWEBPAY_APPLEPAY_SESSION_API_UNDOCUMENTED" };
}

export type ChargeApplePayResult =
  | { ok: true; tradeNo: string; amt: number; payTime: string }
  | { ok: false; reason: string };

/*
 * 未查證：藍新扣款 API 的網址、Version、PostData_ 完整欄位（尤其是 Apple Pay 的
 * paymentData 該放在哪個欄位、要不要 base64）、回傳格式與簽章驗法，全部沒有公開文件
 * （見檔頭說明）。同樣故意不猜測，一律回「未取得技術文件」。
 */
export async function chargeApplePay(_opts: {
  kind: "order" | "sponsor";
  id: string;
  amount: number;
  email: string;
  itemDesc: string;
  paymentToken: unknown;
}): Promise<ChargeApplePayResult> {
  return { ok: false, reason: "NEWEBPAY_APPLEPAY_CHARGE_API_UNDOCUMENTED" };
}

/*
 * 解析扣款 API 的原始回應。目前 chargeApplePay 根本沒有發出真正的請求，這支先留著
 * 骨架與型別，等拿到藍新真正的串接文件、知道回傳格式（加密 JSON？直接明文？）之後
 * 再實作，chargeApplePay 到時候應該改成「打 API → parseChargeResult(rawResponse)」。
 */
export function parseChargeResult(_raw: unknown): ChargeApplePayResult {
  return { ok: false, reason: "NEWEBPAY_APPLEPAY_CHARGE_API_UNDOCUMENTED" };
}
