import type { Metadata } from "next";
import { buildMetadata } from "@/lib/seo";
import Link from "next/link";
import Nav from "@/components/Nav";
import Footer from "@/components/Footer";
import { t } from "@/lib/copy";
import { FbEvent } from "@/components/MetaPixel";
import { linepayEnabled } from "@/lib/linepay";
import { isPayMethodOff } from "@/lib/shop";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import db from "@/lib/db";
import { SPONSOR_COOKIE, parseSponsorCookie } from "@/lib/line-bind";
import { lineNotifyOn, findLineBinding, addFriendUrl, sponsorBindUrlFor } from "@/lib/line";

/* 讀 searchParams+db,必須即時（快取政策下放後每頁明寫） */
export const dynamic = "force-dynamic";

export const metadata: Metadata = buildMetadata({ title: "謝謝你", path: "/support/thanks", noindex: true });

export default async function SupportThanks({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string; pay?: string; amt?: string; no?: string; sid?: string; t?: string; line?: string }>;
}) {
  const { mode, pay, amt, no, sid, t: tok, line } = await searchParams;
  const monthly = mode !== "once";
  const amount = Number(amt) > 0 ? Number(amt) : undefined;
  const failed = pay === "failed";
  const pending = pay === "pending";
  const choose = pay === "choose";

  /* 失敗救援：sid+權杖有效且仍是待付款的單筆，就給「換個方式重試」按鈕（免重填，同提醒信的權杖機制） */
  let rescue: { id: number; token: string; payMethod: string; provider: string } | null = null;
  if ((failed || choose) && sid && tok) {
    try {
      const db = (await import("@/lib/db")).default;
      const row = db
        .prepare("SELECT id,mode,status,pay_token,pay_method,provider FROM sponsorships WHERE id=?")
        .get(Number(sid)) as { id: number; mode: string; status: string; pay_token: string; pay_method: string; provider: string } | undefined;
      if (row && row.mode === "once" && row.status === "pending" && row.pay_token === tok) {
        rescue = { id: row.id, token: row.pay_token, payMethod: row.pay_method, provider: row.provider };
      }
    } catch { rescue = null; }
  }

  /* 待付款畫面要顯示帳號：網址帶 sid＋權杖（幕後取號回來的路）才顯示，避免用編號枚舉別人的繳費資訊 */
  let atm: { bank: string; vaccount: string; expire: string; amount: number } | null = null;
  if (pending && sid && tok) {
    try {
      const db = (await import("@/lib/db")).default;
      const row = db.prepare("SELECT pay_token,amount,COALESCE(atm_bank,'') atm_bank,COALESCE(atm_vaccount,'') atm_vaccount,COALESCE(atm_expire,'') atm_expire FROM sponsorships WHERE id=?")
        .get(Number(sid)) as { pay_token: string; amount: number; atm_bank: string; atm_vaccount: string; atm_expire: string } | undefined;
      if (row && row.pay_token === tok && row.atm_vaccount) atm = { bank: row.atm_bank, vaccount: row.atm_vaccount, expire: row.atm_expire, amount: row.amount };
    } catch { atm = null; }
  }

  /*
   * 完成的是哪一筆：網址有 sid＋權杖就用它（LINE 綁定回來的路），否則看建單時留的 cookie。
   * 站長 2026-09-03：勾了電子報那格的人，付款完成先不顯示感謝，直接導去加 LINE 綁定；
   * 導過一次就記下來（line_asked_at），之後回來看才停在感謝頁。ATM 待付款那條不導，先把繳費說明看完。
   */
  type Sp = { id: number; mode: string; pay_token: string; phone: string; email: string; newsletter: number; line_asked_at: string };
  let sp: Sp | undefined;
  try {
    const q = "SELECT id,mode,pay_token,COALESCE(phone,'') phone,email,COALESCE(newsletter,1) newsletter,COALESCE(line_asked_at,'') line_asked_at FROM sponsorships WHERE id=?";
    if (sid && tok) {
      const r = db.prepare(q).get(Number(sid)) as Sp | undefined;
      if (r && r.pay_token === tok) sp = r;
    }
    if (!sp) {
      const c = parseSponsorCookie((await cookies()).get(SPONSOR_COOKIE)?.value);
      if (c) {
        const r = db.prepare(q).get(c.id) as Sp | undefined;
        if (r && r.pay_token === c.token) sp = r;
      }
    }
  } catch { sp = undefined; }
  if (sp && !failed && !pending && lineNotifyOn() && sp.newsletter && !sp.line_asked_at && !line) {
    db.prepare("UPDATE sponsorships SET line_asked_at=? WHERE id=? AND COALESCE(line_asked_at,'')=''").run(new Date().toISOString(), sp.id);
    redirect(`/line/bind?sp=${sp.id}&t=${encodeURIComponent(sp.pay_token)}&src=sponsor`);
  }
  const lineBlock = (() => {
    if (!sp || !lineNotifyOn()) return null;
    const b = findLineBinding({ phone: sp.phone, email: sp.email });
    const bound = line === "bound" || b?.status === "bound";
    const nofriend = !bound && (line === "nofriend" || b?.status === "nofriend");
    const bindUrl = `${sponsorBindUrlFor(sp.id, sp.pay_token)}&src=sponsor`;
    if (bound) return <p className="msg-ok" style={{ marginTop: 18 }}>已用 LINE 綁定，{pending ? "入帳與繳費提醒" : "之後的通知"}會直接在 LINE 送給你。</p>;
    if (nofriend)
      return (
        <div style={{ marginTop: 18, padding: "14px 16px", border: "2px solid #06C755", textAlign: "center" }}>
          <p style={{ fontSize: 14.5, lineHeight: 1.9, margin: "0 0 10px" }}>還差一步：要加官方帳號好友，通知才送得到。</p>
          {addFriendUrl() && <a className="btn" href={addFriendUrl()} target="_blank" rel="noopener" style={{ background: "#06C755", color: "#fff", borderColor: "#06C755" }}>加入 LINE 好友</a>}
          <p className="fine" style={{ marginTop: 10 }}>加好友之後<a href={bindUrl} style={{ textDecoration: "underline" }}>再按一次綁定</a>就完成。</p>
        </div>
      );
    if (line === "fail") return <p className="msg-err" style={{ marginTop: 18 }}>LINE 綁定沒有完成，<a href={bindUrl} style={{ textDecoration: "underline" }}>再試一次</a>。</p>;
    return (
      <p style={{ marginTop: 18 }}>
        <a className="btn" href={bindUrl} style={{ background: "#06C755", color: "#fff", borderColor: "#06C755" }}>{pending ? "用 LINE 收繳費資訊與入帳通知" : "用 LINE 收通知"}</a>
        {pending && <span className="fine" style={{ display: "block", marginTop: 8 }}>按一下就好，不用打字。綁定後這組繳費資訊會直接傳到你的 LINE。</span>}
      </p>
    );
  })();

  if (failed || pending || choose) {
    return (
      <>
        <Nav />
        <div className="frame" style={{ maxWidth: 680, padding: "72px 20px 120px" }}>
          <div className="box thanks-box center">
            <div className="band" />
            <div className="inner" style={{ paddingTop: 48, paddingBottom: 48 }}>
              <h2>{failed ? "付款沒有完成" : choose ? "換一種付款方式" : "還差一步，等你付款"}</h2>
              <p>
                {choose
                  ? "這筆支持還沒完成付款。選一種方式接著付，資料不用重填："
                  : failed
                  ? rescue
                    ? "這筆支持的付款沒有完成，也沒有扣款。別重填了，直接換一種方式再試一次："
                    : "這筆支持的付款被取消或失敗了，沒有扣款。想再試一次的話，回支持頁重新來過就好。"
                  : atm
                    ? "ATM 繳費資訊如下（也寄到你的信箱了），完成轉帳後我們會寄出確認信與收據。"
                    : "轉帳帳號已寄到你的信箱，完成付款後我們會寄出確認信與收據。"}
              </p>
              {atm && (
                <p style={{ fontSize: 15.5, border: "2px solid var(--indigo, #2C4A6B)", color: "var(--indigo, #2C4A6B)", padding: "14px 18px", marginTop: 16, lineHeight: 1.9 }}>
                  銀行代碼 <b className="sans">{atm.bank}</b>　帳號 <b className="sans">{atm.vaccount}</b>
                  <br />應付金額 <b className="sans">NT$ {atm.amount.toLocaleString()}</b>
                  {atm.expire && <><br />請於 {atm.expire} 前完成</>}
                </p>
              )}
              {/* ATM 待付款的人也要有加 LINE 的入口（站長 2026-09-04）：綁定後繳費資訊直接推過去，入帳也用 LINE 通知 */}
              {pending && lineBlock}
              {rescue && (
                <div style={{ display: "flex", flexDirection: "column", gap: 10, maxWidth: 320, margin: "22px auto 0" }}>
                  {/* ATM 完全不需跳轉驗證，成功率最高，放第一 */}
                  {/* 停用名單也要管到救援：後台關掉的方式不能再推給人 */}
                  {!isPayMethodOff("ATM 轉帳", "support") && rescue.payMethod !== "ATM 轉帳" && (
                    <Link className="btn fill" href={`/support/pay/${rescue.id}?t=${encodeURIComponent(rescue.token)}&m=atm`}>改用 ATM 轉帳（最穩）</Link>
                  )}
                  {/* 藍新沒有 LINE Pay 這條路，換過去只會卡住 */}
                  {rescue.provider !== "newebpay" && linepayEnabled() && !isPayMethodOff("LINE Pay", "support") && rescue.payMethod !== "LINE Pay" && (
                    <Link className="btn" href={`/support/pay/${rescue.id}?t=${encodeURIComponent(rescue.token)}&m=linepay`}>改用 LINE Pay</Link>
                  )}
                  {!isPayMethodOff("信用卡", "support") && rescue.payMethod !== "信用卡" && (
                    <Link className="btn" href={`/support/pay/${rescue.id}?t=${encodeURIComponent(rescue.token)}&m=credit`}>改用信用卡</Link>
                  )}
                  {!isPayMethodOff(rescue.payMethod, "support") && (
                    <Link className="btn" href={`/support/pay/${rescue.id}?t=${encodeURIComponent(rescue.token)}`}>用原方式再試一次</Link>
                  )}
                </div>
              )}
              <p style={{ marginTop: 22 }}>
                <Link className="btn" href="/support">回支持頁</Link>
              </p>
            </div>
            <div className="band" />
          </div>
        </div>
        <Footer />
      </>
    );
  }

  return (
    <>
      {/* sponsor_complete 改由伺服器端在「確認入帳」當下回報 GA（lib/ga.ts），
          涵蓋 ATM 入帳、瀏覽器沒回跳、擋追蹤器等情況，這裡不再重複發送 */}
      {/* Meta 廣告優化要靠瀏覽器像素的 Purchase 事件（ATM 晚入帳的少數情況收不到，可接受） */}
      {/* dedupeKey＝交易編號：重新整理感謝頁不會重複計 Purchase（金流回跳都帶 no） */}
      <FbEvent name="Purchase" value={amount} dedupeKey={no} />
      <Nav />
      <div className="frame" style={{ maxWidth: 680, padding: "72px 20px 120px" }}>
        <div className="box thanks-box center">
          <div className="band" />
          <div className="inner" style={{ paddingTop: 48, paddingBottom: 48 }}>
            <div className="seal-badge">
              <span className="gold">誠 心 感 謝</span>
              <b>問爽的</b>
              <span>敬 上</span>
            </div>
            <h2>{t("sthx_title")}</h2>
            <p>{t("sthx_p1")}</p>
            {monthly && <p>{t("sthx_monthly")}</p>}
            {lineBlock}
            <p style={{ marginTop: 14 }}>
              <Link className="btn" href="/">{t("sthx_btn")}</Link>
            </p>
          </div>
          <div className="band" />
        </div>
      </div>
      <Footer />
    </>
  );
}
