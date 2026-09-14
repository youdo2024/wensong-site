import type { Metadata } from "next";
import Link from "next/link";
import Nav from "@/components/Nav";
import Footer from "@/components/Footer";
import { buildMetadata } from "@/lib/seo";
import { unsubTokenValid } from "@/lib/newsletter";
import { confirmUnsub, requestUnsubLink } from "./actions";

export const metadata: Metadata = buildMetadata({ title: "取消訂閱", path: "/unsubscribe", noindex: true });
export const dynamic = "force-dynamic";

/*
 * 一鍵退訂。
 *
 * 刻意不需要登入、不需要填任何東西：退訂被做得很麻煩的網站，
 * 使用者的下一步是按「檢舉為垃圾郵件」，而那個對整個網域的信譽傷害
 * 遠大於少一個訂閱者。所以這裡只有一顆按鈕，按下去就結束。
 *
 * 為什麼還是要按那一下：原本 GET 進來就直接退訂，而信裡的連結會被
 * 企業郵件的防毒掃描、收件軟體的連結預覽自動點過一遍，
 * 人還沒看到信就被退訂了。那一下是用來分辨「人」與「掃描器」的，
 * 真正的退訂動作放在 POST（app/unsubscribe/actions.ts 的 confirmUnsub）。
 *
 * 權杖是 32 位十六進位亂數，不是 email：email 可枚舉，
 * 任何人都能退掉別人的訂閱。
 */
export default async function Unsubscribe({
  searchParams,
}: {
  searchParams: Promise<{ t?: string; sent?: string; done?: string; bad?: string }>;
}) {
  const { t, sent, done: doneFlag, bad } = await searchParams;
  const done = doneFlag === "1";
  /* 只查權杖認不認得，這一刻不動名單 */
  const askable = !done && !bad && Boolean(t) && unsubTokenValid(String(t));

  return (
    <>
      <Nav />
      <div className="frame" style={{ maxWidth: 560, padding: "72px 20px 120px" }}>
        <div className="box center">
          <div className="band" />
          <div className="inner" style={{ paddingTop: 44, paddingBottom: 44 }}>
            {done ? (
              <>
                <h1 style={{ fontSize: 24, fontWeight: 900, letterSpacing: ".14em" }}>已經取消訂閱了</h1>
                <p style={{ color: "var(--grey)", fontSize: 14.5, marginTop: 14, lineHeight: 2 }}>
                  之後不會再收到我們的電子報。
                  <br />
                  訂單確認、出貨通知這類交易信不受影響，那是完成交易必要的通知。
                </p>
              </>
            ) : sent ? (
              <>
                <h1 style={{ fontSize: 24, fontWeight: 900, letterSpacing: ".14em" }}>退訂連結已寄出</h1>
                <p style={{ color: "var(--grey)", fontSize: 14.5, marginTop: 14, lineHeight: 2 }}>
                  如果這個信箱有訂閱電子報，幾分鐘內會收到一封信，按裡面的按鈕就完成。
                  <br />
                  沒收到的話看一下垃圾信匣。
                </p>
              </>
            ) : askable ? (
              <>
                <h1 style={{ fontSize: 24, fontWeight: 900, letterSpacing: ".14em" }}>要取消訂閱電子報嗎</h1>
                <p style={{ color: "var(--grey)", fontSize: 14.5, marginTop: 14, lineHeight: 2 }}>
                  按下去就完成，不用登入也不用填東西。
                  <br />
                  訂單確認、出貨通知這類交易信不受影響，那是完成交易必要的通知。
                </p>
                <form action={confirmUnsub} style={{ marginTop: 18 }}>
                  <input type="hidden" name="t" value={String(t)} />
                  <button className="btn fill" type="submit">確認取消訂閱</button>
                </form>
              </>
            ) : !t && !bad ? (
              <>
                <h1 style={{ fontSize: 24, fontWeight: 900, letterSpacing: ".14em" }}>取消訂閱電子報</h1>
                <p style={{ color: "var(--grey)", fontSize: 14.5, marginTop: 14, lineHeight: 2 }}>
                  留下訂閱時用的信箱，我們把專屬的退訂連結寄給你，按一下就完成。
                </p>
                <form action={requestUnsubLink} style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap", marginTop: 18 }}>
                  <input className="sans" type="email" name="email" required placeholder="你的 Email" style={{ flex: "1 1 220px", maxWidth: 300, border: "2px solid var(--ink)", padding: "10px 12px", fontSize: 16 }} />
                  <button className="btn" type="submit">寄退訂連結給我</button>
                </form>
              </>
            ) : (
              <>
                <h1 style={{ fontSize: 24, fontWeight: 900, letterSpacing: ".14em" }}>這條退訂連結無效</h1>
                <p style={{ color: "var(--grey)", fontSize: 14.5, marginTop: 14, lineHeight: 2 }}>
                  可能是連結不完整，或已經退訂過了。
                  <br />
                  來信給我們也可以，我們會手動處理。
                </p>
              </>
            )}
            <p style={{ marginTop: 22 }}>
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
