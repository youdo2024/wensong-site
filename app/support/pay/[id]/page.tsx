import { notFound, redirect } from "next/navigation";
import Nav from "@/components/Nav";
import AutoSubmitForm from "@/components/AutoSubmitForm";
import db from "@/lib/db";
import { PAYUNI, buildUppFields, payMethodParams, payuniEnabled, siteUrl } from "@/lib/payuni";
import { buildCheckoutFields, ecpayEnabled, type EcpayMethod } from "@/lib/ecpay";
import { ecpayBackstageAtmOn, takeAtmNumberForSponsorship } from "@/lib/ecpay-genpay";
import { buildMpgForm, newebpayEnabled, type NewebpayMethod } from "@/lib/newebpay";
import { buildPeriodForm } from "@/lib/newebpay-period";
import { resetRound } from "@/lib/remind";
import { isPayMethodOff, newebpayAtmBank } from "@/lib/shop";
import { payItemName } from "@/lib/item-name";
import { buildMetadata } from "@/lib/seo";
import { safeEqual } from "@/lib/safe-equal";
import { rememberSponsorTradeNo } from "@/lib/sponsor-trade-no";

export const dynamic = "force-dynamic";

/* 每筆贊助專屬的付款跳轉頁，不進索引 */
export const metadata = buildMetadata({ path: "/support", noindex: true });

type SponsorRow = {
  id: number; mode: string; amount: number; email: string;
  pay_method: string; status: string; credit_token: string; provider: string; pay_token: string;
};

/* 付款方式 → 綠界 ChoosePayment 對應 */
function ecpayMethodOf(sp: SponsorRow): EcpayMethod {
  if (sp.mode === "monthly") return "credit_period";
  if (sp.pay_method === "Apple Pay") return "applepay";
  if (sp.pay_method === "ATM 轉帳" || sp.pay_method === "銀行轉帳") return "atm";
  if (sp.pay_method === "多元支付") return "twqr";
  return "credit";
}

/* 贊助付款跳轉頁：綠界模式組 AIO 參數、其他沿用 PayUni（僅存量） */
export default async function SponsorPay({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ t?: string; m?: string }>;
}) {
  const { id } = await params;
  const { t, m } = await searchParams;

  const sp = db
    .prepare("SELECT id,mode,amount,email,pay_method,status,credit_token,provider,pay_token FROM sponsorships WHERE id=?")
    .get(Number(id)) as SponsorRow | undefined;
  /*
   * 權杖先驗，其他判斷全部排在後面。
   *
   * 原本的順序是「查不到就 404、已付款就導感謝頁、之後才比權杖」，
   * 於是只要把網址的編號從 1 掃到 9999，就能從回應分辨出哪些編號存在、
   * 哪一筆已經付款、是單次還是每月——贊助紀錄的存在與狀態本身就是隱私。
   * 現在不論查無此單或權杖不符，回的都是同一個 404，掃編號問不出任何東西。
   */
  if (!sp || !safeEqual(t, sp.pay_token)) notFound();
  if (sp.status !== "pending") redirect(`/support/thanks?mode=${sp.mode}&pay=paid`);

  /* ── 失敗救援：換一種方式重試（免重填）。
     僅限單筆、pending、且帶正確權杖；白名單以外的 m 一律忽略，原流程完全不受影響 ──
     藍新贊助只在信用卡／ATM 之間切換，不提供 LINE Pay（藍新沒有那條路），
     也不會把藍新的贊助切去綠界（那要重新走一次 ecpay 的建單邏輯，這裡不做）。 */
  if (m && sp.mode === "once") {
    const gw = sp.provider === "newebpay" ? "newebpay" : "ecpay";
    const SWITCH: Record<string, [string, string]> =
      gw === "newebpay"
        ? { atm: ["newebpay", "ATM 轉帳"], credit: ["newebpay", "信用卡"] }
        : { atm: ["ecpay", "ATM 轉帳"], credit: ["ecpay", "信用卡"], linepay: ["linepay", "LINE Pay"] };
    /* 換過去的目標也要過停用名單：關掉的方式不能經由換方式復活 */
    const target = SWITCH[m] && !isPayMethodOff(SWITCH[m][1], "support") ? SWITCH[m] : undefined;
    if (target) {
      db.prepare("UPDATE sponsorships SET provider=?, pay_method=? WHERE id=? AND status='pending'").run(target[0], target[1], sp.id);
      if (target[1] !== sp.pay_method) resetRound("sponsor", sp.id);
      if (target[0] === "linepay") redirect(`/api/linepay/request?sp=${sp.id}&t=${encodeURIComponent(sp.pay_token)}`);
      sp.provider = target[0];
      sp.pay_method = target[1];
    }
  }

  /* ── LINE Pay 列（原方式重試）：直接走 LINE Pay 請求，絕不落入下方 PayUni 存量分支 ── */
  if (sp.provider === "linepay") {
    /* 權杖在最上面已經驗過，這裡不必再擋一次 */
    redirect(`/api/linepay/request?sp=${sp.id}&t=${encodeURIComponent(sp.pay_token)}`);
  }

  /* ── 綠界站內收款 ── */
  if (sp.provider === "ecpay") {
    if (!ecpayEnabled()) redirect("/support");
    /* 原方式已被後台停用（例如信用卡關閉）：不能照舊組出付款頁，
       導回感謝頁的失敗畫面，那裡的救援按鈕只列還開著的方式。
       每月方案只能走信用卡，信用卡關閉時它整個暫停（後台說明本來就這樣寫）。 */
    const payLabel = sp.mode === "monthly" ? "信用卡" : sp.pay_method || "信用卡";
    if (isPayMethodOff(payLabel, "support"))
      redirect(`/support/thanks?mode=${sp.mode}&pay=failed${sp.mode === "once" ? `&sid=${sp.id}&t=${encodeURIComponent(sp.pay_token)}` : ""}`);
    const site = (process.env.SITE_URL || "https://www.wensong.tw").replace(/\/$/, "");
    const method = ecpayMethodOf(sp);
    /* ATM 幕後取號（後台開關，與商店同一個）：直接取號、寄信，回感謝頁顯示帳號；失敗退回下面的綠界跳轉 */
    if (method === "atm" && sp.mode === "once" && ecpayBackstageAtmOn()) {
      const took = await takeAtmNumberForSponsorship(sp.id);
      if (took.ok) redirect(`/support/thanks?mode=once&pay=pending&sid=${sp.id}&t=${encodeURIComponent(sp.pay_token)}`);
    }
    /* 每次進頁重生訂單編號（綠界不接受重複），回呼用它找回這筆贊助。
       被換掉的那組不會失效（尤其 ATM 虛擬帳號），所以連同新的一起記進歷史，
       晚到的款項才認得回來。兩件事同一個 transaction：只寫其中一件等於沒改。 */
    const merchantTradeNo = `YO${sp.id}T${Date.now().toString(36).toUpperCase()}`.slice(0, 20);
    db.transaction(() => {
      db.prepare("UPDATE sponsorships SET trade_no=? WHERE id=?").run(merchantTradeNo, sp.id);
      rememberSponsorTradeNo(sp.id, merchantTradeNo);
    })();
    const { action, fields } = buildCheckoutFields({
      merchantTradeNo,
      amount: sp.amount,
      method,
      itemName: payItemName(sp.mode),
      clientBackUrl: `${site}/support/thanks?mode=${sp.mode}&pay=${method === "atm" ? "pending" : "paid"}`,
    });
    return (
      <>
        <Nav />
        <div className="frame" style={{ maxWidth: 560, padding: "72px 20px 120px" }}>
          <div className="box">
            <div className="band" />
            <div className="inner">
              <AutoSubmitForm action={action} fields={fields} />
            </div>
            <div className="band" />
          </div>
        </div>
      </>
    );
  }

  /* ── 藍新站內收款（單筆：信用卡／ATM；每月：定期定額委託，只收信用卡） ── */
  if (sp.provider === "newebpay") {
    if (!newebpayEnabled()) redirect("/support");
    if (sp.mode === "monthly") {
      if (isPayMethodOff("信用卡", "support")) redirect(`/support/thanks?mode=monthly&pay=failed`);
      /* 每次進頁重生 MerOrderNo（藍新不接受重複），首期成功後回呼靠它裡面帶的贊助 id
         找回這筆贊助；解約時要用「建立當初那一組」，所以連同新的一起記進歷史，
         被換掉的那組不會失效（比照綠界定期定額同一個理由，見 lib/sponsor-trade-no.ts） */
      const { action, fields, merOrderNo } = buildPeriodForm({
        sponsorshipId: sp.id,
        amount: sp.amount,
        email: sp.email,
        desc: payItemName(sp.mode),
      });
      db.transaction(() => {
        db.prepare("UPDATE sponsorships SET trade_no=? WHERE id=?").run(merOrderNo, sp.id);
        rememberSponsorTradeNo(sp.id, merOrderNo);
      })();
      return (
        <>
          <Nav />
          <div className="frame" style={{ maxWidth: 560, padding: "72px 20px 120px" }}>
            <div className="box">
              <div className="band" />
              <div className="inner">
                <AutoSubmitForm action={action} fields={fields} />
              </div>
              <div className="band" />
            </div>
          </div>
        </>
      );
    }
    const payLabel = sp.pay_method || "信用卡";
    if (isPayMethodOff(payLabel, "support"))
      redirect(`/support/thanks?mode=${sp.mode}&pay=failed&sid=${sp.id}&t=${encodeURIComponent(sp.pay_token)}`);
    const method: NewebpayMethod = payLabel === "ATM 轉帳" ? "atm" : payLabel === "Apple Pay" ? "applepay" : "credit";
    /* 每次進頁重生 MerchantOrderNo（藍新不接受重複），回呼靠它裡面帶的贊助 id 找回這筆贊助，
       不需要像綠界那樣另外查歷史表。buildMpgForm 回傳的 merchantOrderNo 一定要原封寫回
       trade_no：對帳查詢用的是這個值，自己重算一次時間戳會跟送出去的那組對不上。 */
    const { action, fields, merchantOrderNo } = buildMpgForm({
      orderNo: String(sp.id),
      amount: sp.amount,
      itemDesc: payItemName(sp.mode),
      email: sp.email,
      method,
      kind: "sponsor",
      bankType: method === "atm" ? newebpayAtmBank() : undefined,
    });
    db.prepare("UPDATE sponsorships SET trade_no=? WHERE id=?").run(merchantOrderNo, sp.id);
    return (
      <>
        <Nav />
        <div className="frame" style={{ maxWidth: 560, padding: "72px 20px 120px" }}>
          <div className="box">
            <div className="band" />
            <div className="inner">
              <AutoSubmitForm action={action} fields={fields} />
            </div>
            <div className="band" />
          </div>
        </div>
      </>
    );
  }

  /* ── PayUni（存量） ── */
  if (!payuniEnabled()) redirect("/support");
  const upp = buildUppFields({
    MerID: PAYUNI.merId,
    MerTradeNo: `SP${sp.id}X${Date.now().toString(36).toUpperCase()}`,
    TradeAmt: sp.amount,
    ProdDesc: payItemName(sp.mode),
    UsrMail: sp.email,
    UsrMailFix: "1",
    Timestamp: Math.floor(Date.now() / 1000),
    ReturnURL: `${siteUrl()}/api/payuni/return`,
    NotifyURL: `${siteUrl()}/api/payuni/notify`,
    Lang: "zh-tw",
    ...(process.env.PAYUNI_INVOICE === "1" ? { TradeInvoice: 1 } : {}),
    ...(sp.mode === "monthly"
      ? { Credit: "1", CreditToken: sp.credit_token || `SPTOKEN${sp.id}` }
      : payMethodParams(sp.pay_method)),
  });

  return (
    <>
      <Nav />
      <div className="frame" style={{ maxWidth: 560, padding: "72px 20px 120px" }}>
        <div className="box">
          <div className="band" />
          <div className="inner">
            <AutoSubmitForm action={upp.action} fields={upp.fields} />
          </div>
          <div className="band" />
        </div>
      </div>
    </>
  );
}
