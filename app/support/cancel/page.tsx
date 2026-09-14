import type { Metadata } from "next";
import { buildMetadata } from "@/lib/seo";
import Link from "next/link";
import Nav from "@/components/Nav";
import Footer from "@/components/Footer";
import db from "@/lib/db";
import { cancelToken } from "@/lib/mail";
import { money } from "@/lib/format";
import { cancelSponsorshipByToken } from "./actions";
import { safeEqual } from "@/lib/safe-equal";

export const metadata: Metadata = buildMetadata({ title: "停止長期支持", path: "/support/cancel", noindex: true });
export const dynamic = "force-dynamic";

export default async function CancelPage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string; t?: string; done?: string; fail?: string; none?: string }>;
}) {
  const { id, t, done, fail, none } = await searchParams;
  const spId = Number(id) || 0;
  /* 定時比較：取消連結的權杖是 HMAC 前 32 碼，逐字元比會洩漏猜對了幾碼 */
  const valid = spId > 0 && safeEqual(t, cancelToken(spId));
  const sp = valid
    ? (db.prepare("SELECT id,mode,amount,display_name,status FROM sponsorships WHERE id=?").get(spId) as
        | { id: number; mode: string; amount: number; display_name: string; status: string }
        | undefined)
    : undefined;

  let body: React.ReactNode;
  /* 沒有進行中的每月支持可以取消。原本這種情況也會顯示「已停止」，
     讓人以為停掉了，其實系統什麼都沒做。 */
  if (none) {
    body = (
      <>
        <h2 style={{ fontSize: 24, fontWeight: 900, letterSpacing: ".14em" }}>目前沒有進行中的每月支持</h2>
        <p style={{ color: "var(--grey)", fontSize: 14.5, marginTop: 12, lineHeight: 2 }}>
          這筆支持可能已經停止過了，或原本就是單次支持（單次支持不會有後續扣款）。
          如果你確定還有扣款正在進行，請直接回信給我們，我們會幫你查清楚並處理。
        </p>
      </>
    );
  } else if (fail) {
    body = (
      <>
        <h2 style={{ fontSize: 24, fontWeight: 900, letterSpacing: ".14em" }}>取消暫時沒有成功</h2>
        <p style={{ color: "var(--grey)", fontSize: 14.5, marginTop: 12, lineHeight: 2 }}>
          金流服務剛剛沒有回應，請稍後再點一次信中的取消連結，或直接回信給我們，我們手動處理。
        </p>
      </>
    );
  } else if (done) {
    body = (
      <>
        <h2 style={{ fontSize: 24, fontWeight: 900, letterSpacing: ".14em" }}>已為你停止續扣，謝謝這段時間的支持</h2>
        <p style={{ color: "var(--grey)", fontSize: 14.5, marginTop: 12, lineHeight: 2 }}>
          之後不會再有新的扣款（已支付的當期不受影響）。任何時候想回來，支持頁永遠開著。
        </p>
      </>
    );
  } else if (!valid || !sp || sp.mode !== "monthly") {
    body = (
      <>
        <h2 style={{ fontSize: 24, fontWeight: 900, letterSpacing: ".14em" }}>連結無效或已過期</h2>
        <p style={{ color: "var(--grey)", fontSize: 14.5, marginTop: 12 }}>
          請使用確認信中的取消連結，或直接回信給我們協助處理。
        </p>
      </>
    );
  } else if (sp.status !== "active") {
    body = (
      <>
        <h2 style={{ fontSize: 24, fontWeight: 900, letterSpacing: ".14em" }}>這筆長期支持已經停止了</h2>
        <p style={{ color: "var(--grey)", fontSize: 14.5, marginTop: 12 }}>不會再有新的扣款，放心。</p>
      </>
    );
  } else {
    body = (
      <>
        <h2 style={{ fontSize: 24, fontWeight: 900, letterSpacing: ".14em" }}>確定要停止長期支持嗎？</h2>
        <p style={{ color: "var(--grey)", fontSize: 14.5, margin: "12px 0 24px", lineHeight: 2 }}>
          {sp.display_name || "支持者"}，你目前長期支持 <b style={{ color: "var(--seal)" }}>{money(sp.amount)}</b>。
          <br />
          按下確認後立即生效，之後不會再扣款。
        </p>
        <form action={cancelSponsorshipByToken}>
          <input type="hidden" name="id" value={sp.id} />
          <input type="hidden" name="t" value={t} />
          <button className="btn fill" type="submit">確認取消</button>
        </form>
      </>
    );
  }

  return (
    <>
      <Nav />
      <div className="frame" style={{ maxWidth: 560, padding: "72px 20px 120px" }}>
        <div className="box center">
          <div className="band" />
          <div className="inner" style={{ paddingTop: 44, paddingBottom: 44 }}>
            {body}
            <p style={{ marginTop: 26 }}>
              <Link className="btn" href="/">回首頁</Link>
            </p>
          </div>
          <div className="band" />
        </div>
      </div>
      <Footer />
    </>
  );
}
