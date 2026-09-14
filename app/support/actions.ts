"use server";
import crypto from "crypto";
import db, { getSetting, json } from "@/lib/db";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { gaClientIdFromCookie, gaSessionFromCookie, GA_SESSION_COOKIE } from "@/lib/ga";
import { payuniEnabled } from "@/lib/payuni";
import { portalyEnabled, ensureOncePlan, ensureMonthlyPlan, createCheckoutSession } from "@/lib/portaly";
import { ecpayEnabled } from "@/lib/ecpay";
import { newebpayEnabled } from "@/lib/newebpay";
import { linepayEnabled } from "@/lib/linepay";
import { isPayMethodOff, supportMode, monthlyGateway, payMethodsOff, applePayOnsiteEnabled } from "@/lib/shop";
import { sendSponsorThanksMail } from "@/lib/mail";
import { isAdmin } from "@/lib/auth";
import { headers } from "next/headers";
import { rateLimit, clientIp } from "@/lib/ratelimit";
import { checkEmail } from "@/lib/email-typo";
import { npobanFormatOk, npobanName } from "@/lib/npoban";
import { taxIdChecksumOk } from "@/lib/taxid";
import { SPONSOR_COOKIE, makeSponsorCookie } from "@/lib/line-bind";

/*
 * 建立贊助。金流優先序：
 * 1. 綠界（站內收款）：信用卡單筆／定期定額、Apple Pay、ATM、TWQR 多元支付；
 *    LINE Pay 獨立走 LINE Pay API。付款成功由回呼自動開光貿發票。
 * 2. 藍新（沒設綠界金鑰時）：單筆信用卡／ATM 走 MPG；每月定額只在後台
 *    monthly_gateway=newebpay 時走定期定額委託（lib/newebpay-period.ts），
 *    否則每月定額退回下一順位。
 * 3. Portaly Payment（沒設綠界、藍新月費不適用時）：跳轉代管結帳。
 * 4. PayUni（僅供既有測試）；都沒有則為模擬模式。
 */
export async function createSponsorship(formData: FormData) {
  const mode = formData.get("mode") === "once" ? "once" : "monthly";
  const amount = Math.max(100, Number(formData.get("amount")) || 0);
  const email = String(formData.get("email") || "").trim();
  const displayName = String(formData.get("display_name") || "").trim();
  const message = String(formData.get("message") || "").trim();
  const wishTopic = ""; /* 許願議題功能已移除（站長 2026-09-04），欄位留著不寫 */
  /* LINE Pay 獨立按鈕以 submit button 的 name/value 蓋過預設付款方式 */
  const payMethod = String(formData.get("pay_method_override") || formData.get("pay_method") || "信用卡");

  /*
   * 驗證失敗導回時，把「長期／單次」與金額一起帶回去。
   *
   * 前端已經先擋一次（SupportForm 的 onSubmit），走到這裡的多半是繞過瀏覽器的請求；
   * 但真的走到了也不該把客人選好的模式洗掉——原本一律導回 /support，
   * 那會跳回預設的「長期支持」，客人以為自己要被每月扣款。
   */
  const back = (err: string) => `/support?error=${err}&mode=${mode}${amount ? `&amount=${amount}` : ""}`;

  /* 贊助暫停顯示時，後端也不收新贊助（既有訂閱扣款不經過這裡，不受影響）；
     站長預覽模式例外：登入後台的站長可在切換前實測站內金流 */
  const sMode = supportMode();
  if (sMode !== "api" && sMode !== "hybrid" && !(await isAdmin())) redirect("/support");
  /* 綜合模式：定額走 Portaly 外部頁時站內不收定額提交（正常介面不會送出，這裡擋手動打 API 的）；
     monthly_gateway=newebpay 時定額本來就該在站內完成，不受這道擋 */
  if (sMode === "hybrid" && mode === "monthly" && monthlyGateway() !== "newebpay" && !(await isAdmin())) redirect("/support");
  if (!email || !amount) { console.error("[support] 拒絕：缺 email 或金額", { email: Boolean(email), amount }); redirect(back("1")); }
  /*
   * 金額必須是整數，在這裡（進系統的第一道）就擋，不偷偷 Math.round() 取整。
   *
   * 前端 SupportForm 的自訂金額欄位已經把 step 從 "any" 改成 1，但那只擋得住
   * 一般點擊與方向鍵；直接貼上小數、或繞過瀏覽器直接打這支 action，一樣送得出
   * 199.99 這種值。藍新只收整數金額（buildMpgForm 用 Math.round），如果這裡默默
   * 取整存進 sponsorships.amount，客人在畫面上看到、以為自己要付的金額
   * 跟藍新實際扣款的金額就會兜不起來：付了 200，系統卻拿 199.99 去比對，
   * 判定「金額不符」而不入帳，之後對帳也永遠查不回來（詳見審查報告的 [BUG] 證明）。
   * 所以不取整，直接當壞資料拒絕，讓客人回去修正成整數。
   */
  if (!Number.isInteger(amount)) { console.error("[support] 拒絕：自訂金額不是整數", { amount }); redirect(back("1")); }
  /* 信箱：收據與電子發票全靠它，打錯的話對方付了錢什麼都收不到 */
  if (checkEmail(email)) redirect(back("email"));
  /* 防灌單：沒有這道，攻擊者可以連發表單塞爆待付款紀錄，
     而且每筆會對填入的任意 Email 寄提醒信——等於拿本站做郵件轟炸 */
  /* 限流：同 IP 每小時 10 次、同信箱每天 5 次。站長登入後台測金流時不受限（2026-09-14 站長連測幾次就被擋，
     而錯誤訊息又寫成「資料不完整」，查了半天）。被擋要講清楚是被擋，不是資料填錯。 */
  const admin = await isAdmin();
  if (!admin && !rateLimit(`sponsor:${clientIp(await headers())}`, 10, 60 * 60 * 1000)) redirect(back("rate"));
  if (!admin && !rateLimit(`sponsor-mail:${email.toLowerCase()}`, 5, 24 * 60 * 60 * 1000)) redirect(back("rate"));

  /* 手機一律必填（站長指示 2026-08-31，原本只有滿 2,000 才要）。
     表單的 required 擋得住一般人，擋不住直接打這支的請求，所以這裡再驗一次。 */
  const phone = String(formData.get("phone") || "").replace(/[\s-]/g, "");
  if (!/^09\d{8}$/.test(phone)) redirect(back("phone"));

  const useEcpay = ecpayEnabled();
  /*
   * 藍新單筆一律可用（信用卡／ATM）。每月定額：
   *   support_mode=hybrid 時，monthly_gateway 決定要不要走站內藍新（否則就是外連，
   *   前端根本不會送出這個表單，這裡只是防手動打 API）；
   *   其餘模式（api、站長預覽）沒有「外連」這個選項可言，藍新有金鑰就直接是站內主力金流，
   *   跟單筆一致，不受 monthly_gateway 影響（那顆設定只在綜合模式的語境下才有意義）。
   */
  const useNewebpay =
    !useEcpay && newebpayEnabled() && (mode === "once" || (mode === "monthly" && (sMode !== "hybrid" || monthlyGateway() === "newebpay")));
  const usePortaly = !useEcpay && !useNewebpay && portalyEnabled();
  if (!usePortaly && isPayMethodOff(payMethod, "support")) { console.error("[support] 拒絕：付款方式已停用", { mode, payMethod, off: payMethodsOff("support") }); redirect(back("payoff")); }
  if (usePortaly && mode === "monthly") {
    const tiers = json<number[]>(getSetting("sponsor_tiers", "[888,5000,30000,80000]"), [888, 5000, 30000, 80000]);
    if (!tiers.includes(amount)) { console.error("[support] 拒絕：Portaly 定額金額不在級距", { amount }); redirect(back("tier")); }
  }
  /* 綠界模式的基本檢查：定期定額只收信用卡；LINE Pay 要有金鑰 */
  if (useEcpay) {
    if (mode === "monthly" && payMethod !== "信用卡") { console.error("[support] 拒絕：綠界定額非信用卡", { payMethod }); redirect(back("method")); }
    if (payMethod === "LINE Pay" && !linepayEnabled()) redirect(back("method"));
  }
  /* 藍新模式的基本檢查：定期定額委託只收信用卡（規格沒有 ATM 定期扣款這條路），單筆才收 ATM */
  if (useNewebpay) {
    if (mode === "monthly" && payMethod !== "信用卡") { console.error("[support] 拒絕：藍新定額非信用卡", { payMethod }); redirect(back("method")); }
    if (mode === "once" && !["信用卡", "ATM 轉帳", "Apple Pay"].includes(payMethod)) { console.error("[support] 拒絕：藍新單筆付款方式不支援", { payMethod }); redirect(back("method")); }
  }

  /* 發票偏好：雲端寄 Email（預設）／手機條碼載具／愛心碼捐贈／公司統編 */
  const invKind = String(formData.get("inv_kind") || "email");
  const invoiceType = invKind === "b2b" ? "b2b" : "b2c";
  const invoiceData =
    invKind === "b2b"
      ? {
          company: String(formData.get("inv_company") || "").trim(),
          taxId: String(formData.get("inv_tax_id") || "").trim(),
        }
      : invKind === "mobile"
        ? { carrierType: "手機條碼載具", carrierNo: String(formData.get("inv_carrier_no") || "").trim() }
        : invKind === "donate"
          ? { carrierType: "愛心碼捐贈", npoban: String(formData.get("inv_npoban") || "").trim() }
          : { carrierType: "寄Email" };

  /*
   * 發票欄位在伺服器再驗一次。表單擋得住一般人，擋不住直接打這支 action 的請求，
   * 而三個欄位的錯誤後果不一樣：
   *   捐贈碼錯 → 光貿退件 → 降級補開成寄 Email 的發票，客人以為捐了其實沒捐
   *   統編錯　 → 光貿【只驗檢查碼】，照樣開出一張抬頭是空氣的發票，完全無聲
   * 捐贈不可逆、發票開出去要作廢才收得回來，所以擋在建單之前。
   */
  if (invKind === "donate") {
    const npo = String(formData.get("inv_npoban") || "").trim();
    if (!npobanFormatOk(npo) || !npobanName(npo)) redirect(back("npoban"));
  }
  if (invKind === "b2b" && !taxIdChecksumOk(String(formData.get("inv_tax_id") || ""))) redirect(back("taxid"));
  if (invKind === "mobile" && !/^\/[0-9A-Z.+-]{7}$/.test(String(formData.get("inv_carrier_no") || "").trim().toUpperCase()))
    redirect(back("carrier"));

  const live = useEcpay || useNewebpay || usePortaly || payuniEnabled();
  const provider = useEcpay ? (payMethod === "LINE Pay" ? "linepay" : "ecpay") : useNewebpay ? "newebpay" : usePortaly ? "portaly" : "payuni";
  const payToken = crypto.randomBytes(12).toString("hex");
  /* 抓訪客的 GA client_id：付款完成時伺服器端回報 GA 用，能歸因回原本的流量來源 */
  const ck = await cookies();
  const gaCid = gaClientIdFromCookie(ck.get("_ga")?.value);
  /* session_id 一併存下來：付款完成時人已離開瀏覽器，只能靠建立當下抓到的值歸因 */
  const gaSess = gaSessionFromCookie(ck.get(GA_SESSION_COOKIE)?.value);
  /* 來源頁（哪一頁按下贊助）：純記錄，任何異常一律變空字串，絕不影響付款流程 */
  let source = "";
  try {
    source = String(formData.get("source") || "").split("?")[0].slice(0, 200);
    if (!source.startsWith("/")) source = "";
  } catch { source = ""; }
  /* 環境標籤（fb/ig/line 內建瀏覽器）：白名單以外一律空字串，純記錄不影響流程 */
  let env = "";
  try {
    const e = String(formData.get("env") || "");
    if (e === "fb" || e === "ig" || e === "line" || e === "wv") env = e;
  } catch { env = ""; }
  const info = db.prepare(
    `INSERT INTO sponsorships (mode,amount,display_name,message,wish_topic,email,phone,pay_method,invoice_type,invoice_data,status,created_at,provider,pay_token,ga_cid,source,env,ga_sid,ga_snum,newsletter)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).run(
    mode,
    amount,
    displayName,
    message,
    wishTopic,
    email,
    phone,
    payMethod,
    invoiceType,
    JSON.stringify(invoiceData),
    live ? "pending" : mode === "monthly" ? "active" : "paid",
    new Date().toISOString(),
    provider,
    payToken,
    gaCid,
    source,
    env,
    gaSess.sid,
    gaSess.snum,
    /* 沒有勾就是 0。條款雖然涵蓋，但客人自己取消的意思要優先於條款 */
    formData.get("newsletter") ? 1 : 0
  );
  const id = Number(info.lastInsertRowid);
  /* 感謝頁要靠這個認出「剛完成的是哪一筆」，才知道該不該把人導去加 LINE（見 support/thanks） */
  try {
    (await cookies()).set(SPONSOR_COOKIE, makeSponsorCookie(id, payToken), {
      httpOnly: true, sameSite: "lax", path: "/", maxAge: 7200, secure: process.env.NODE_ENV === "production",
    });
  } catch (e) { console.error("[support] sponsor cookie", e); }

  /*
   * ── 藍新 Apple Pay 幕後：按鈕直接長在 SupportForm，不跳轉付款頁 ──
   *
   * SupportForm 是原生表單（action={createSponsorship}），一般情況下這支函式一路跑到
   * redirect() 結束、瀏覽器直接被導去下一頁。但 Apple Pay 幕後要先在頁面上拿到這筆
   * 贊助的 id 與 pay_token 才能發起 ApplePaySession，不能被 redirect() 導離頁面。
   *
   * 最小改動的接法：SupportForm 偵測到「藍新＋單筆＋選了 Apple Pay＋後台開了
   * applepay_onsite」時，不用原生表單送出，改成直接呼叫這支 server action（同一支
   * 函式，不是另外複製一份驗證邏輯）並帶一個 json=1 標記；這裡看到標記就回傳一般物件
   * 而不是 redirect，呼叫端才讀得到回傳值。其餘所有情況（沒有這個標記、或標記為真但
   * 條件不成立）完全不受影響，一路照舊 redirect。
   *
   * 是否真的能扣到款：藍新沒有公開 Apple Pay 幕後支付 API 的技術文件，
   * 見 lib/newebpay-applepay.ts 開頭的查證說明；這裡只負責把 id／pay_token 交出去，
   * 實際扣款與失敗處理都在 /api/newebpay/applepay/pay。
   */
  if (useNewebpay && mode === "once" && payMethod === "Apple Pay" && applePayOnsiteEnabled() && formData.get("json") === "1") {
    return { ok: true as const, id, payToken };
  }

  /* ── 綠界／LINE Pay 站內收款 ── */
  if (useEcpay) {
    if (payMethod === "LINE Pay") redirect(`/api/linepay/request?sp=${id}&t=${payToken}`);
    redirect(`/support/pay/${id}?t=${payToken}`);
  }

  /* ── Portaly 代管結帳 ── */
  if (usePortaly) {
    const site = (process.env.SITE_URL || "https://www.wensong.tw").replace(/\/$/, "");
    let checkoutUrl = "";
    try {
      const planId = mode === "monthly" ? await ensureMonthlyPlan(amount) : await ensureOncePlan();
      const session = await createCheckoutSession({
        planId,
        ...(mode === "once" ? { amount } : {}),
        merchantOrderNumber: `SP${id}`,
        metadata: { sponsorshipId: String(id) },
        successRedirectUrl: `${site}/support/thanks?mode=${mode}`,
        cancelRedirectUrl: `${site}/support?mode=${mode}`,
        callbackUrl: `${site}/api/portaly/callback`,
      });
      db.prepare("UPDATE sponsorships SET credit_token=?, pay_method='Portaly' WHERE id=?").run(`PORTALY:${session.sessionId}`, id);
      checkoutUrl = session.checkoutUrl;
    } catch (e) {
      console.error("[portaly checkout]", e);
      db.prepare("UPDATE sponsorships SET status='failed', last_charge_note=? WHERE id=? AND status='pending'")
        .run(`Portaly 建立結帳失敗：${e instanceof Error ? e.message : "unknown"}`, id);
      redirect(back("1"));
    }
    redirect(checkoutUrl);
  }

  if (live) {
    /* credit_token 這個佔位值是 PayUni 舊制訂閱的做法；藍新那條把這一欄留給
       首期成功後才拿得到的 PeriodNo（見 app/api/newebpay/period/notify），不能先塞假值蓋掉 */
    if (mode === "monthly" && !useNewebpay) {
      db.prepare("UPDATE sponsorships SET credit_token=? WHERE id=?").run(`SPTOKEN${id}`, id);
    }
    /* 一定要帶 pay_token：付款頁對每一種金流都會驗權杖（避免任意編號被開啟），
       這條 PayUni 分支原本沒帶，一旦綠界停用而退回 PayUni，贊助會全部 404。 */
    redirect(`/support/pay/${id}?t=${payToken}`);
  }
  /* 模擬模式只准本機開發用。正式站沒有任何金流可走時不能假裝成功（2026-09-14 站長實測：
     定期定額還沒上線時按下去直接跳感謝頁，資料庫多了一筆沒付錢的 active）。 */
  if (process.env.NODE_ENV === "production") {
    console.error("[support] 拒絕：沒有可用的金流", { mode, sMode, monthlyGateway: monthlyGateway(), newebpay: newebpayEnabled() });
    db.prepare("UPDATE sponsorships SET status='failed', last_charge_note='沒有可用的金流，未建立付款' WHERE id=?").run(id);
    redirect(back("nogw"));
  }
  void sendSponsorThanksMail({ id, mode, amount, display_name: displayName, email });
  redirect(`/support/thanks?mode=${mode}`);
}
