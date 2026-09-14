import type { Metadata } from "next";
import { buildMetadata } from "@/lib/seo";
import Link from "next/link";
import Nav from "@/components/Nav";
import Footer from "@/components/Footer";
import { planPreviewOk, planViewable } from "@/lib/plan-preview";
import { isAdmin } from "@/lib/auth";
import { nb } from "@/lib/nb";

/* 權益細則頁：不對外公開、也不進索引，只給站長與持專屬連結的人看 */
export const metadata: Metadata = buildMetadata({ title: "支持方案權益說明", path: "/support/plan", noindex: true });
export const dynamic = "force-dynamic";

type Row = { label: string; v: [string, string, string, string] };

/* 四個級距的權益對照。門檻一律是「以上」 */
const TIERS = ["888 以上", "3,000 以上", "6,000 以上", "12,000 以上"];
const ROWS: Row[] = [
  { label: "選題投票權", v: ["1 次", "2 次", "3 次", "4 次"] },
  { label: "商店折扣券", v: ["95 折 1 張", "9 折 2 張", "85 折 3 張", "8 折 4 張"] },
  { label: "免運券", v: ["1 張", "2 張", "3 張", "4 張"] },
  { label: "線上繪本瀏覽與下載權", v: ["有", "有", "有", "有"] },
  { label: "繪本紙本", v: ["—", "—", "有", "有"] },
  { label: "台灣生態故事桌布圖", v: ["1 張", "2 張", "3 張", "4 張"] },
];

const RULES = [
  "以上為單筆支持之單次提供。每月支持者：繪本線上瀏覽與下載權、商店折扣券、免運券每月提供。",
  "選題投票權：依方案每年行使。",
  "台灣生態故事桌布圖：依方案支持期間內繪製之版本，每版本寄送一次。",
  "繪本紙本：支持期間內出版之新書，每本寄送一次。",
  "券的效期為一年。",
  "折扣券與免運券，單筆訂單各限用一張，可同時使用。",
];

export default async function SupportPlan() {
  if (!(await planViewable())) {
    return (
      <>
        <Nav />
        <div className="frame" style={{ maxWidth: 560, padding: "72px 20px 120px" }}>
          <div className="box center">
            <div className="band" />
            <div className="inner" style={{ paddingTop: 44, paddingBottom: 44 }}>
              <h2 style={{ fontSize: 24, fontWeight: 900, letterSpacing: ".14em" }}>這個頁面目前沒有開放</h2>
              <p style={{ color: "var(--grey)", fontSize: 14.5, marginTop: 12, lineHeight: 2 }}>
                你可以先去看看文章，或到支持頁了解怎麼支持這個網站。
              </p>
              <div style={{ marginTop: 24, display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
                <Link className="btn" href="/articles">讀文章</Link>
                <Link className="btn fill" href="/support">支持頁</Link>
              </div>
            </div>
            <div className="band" />
          </div>
        </div>
        <Footer />
      </>
    );
  }

  /* 分辨是站長本人還是拿到專屬連結的人，兩種身分要看到不同的說明 */
  const admin = await isAdmin();
  const viaLink = !admin && (await planPreviewOk());

  return (
    <>
      <Nav />
      <div className="frame" style={{ maxWidth: 860, padding: "64px 20px 110px" }}>
        {admin && (
          <p className="msg-ok" style={{ borderColor: "var(--indigo)", color: "var(--indigo)", marginBottom: 28 }}>
            站長預覽模式：這一頁不會公開，訪客與搜尋引擎都看不到，贊助頁上也不會出現。要給別人看，請到後台「網站設定 → 贊助方案」複製專屬連結。
          </p>
        )}
        {viaLink && (
          <p className="msg-ok" style={{ borderColor: "var(--indigo)", color: "var(--indigo)", marginBottom: 28 }}>
            這是一條專屬檢視連結：本頁不對外公開，不會出現在網站選單或搜尋結果，只有收到連結的人看得到。連結自開啟起 30 天內有效。
          </p>
        )}
        <div className="box">
          <div className="band" />
          <div className="inner">
            <span
              className="sans"
              style={{ fontSize: 11.5, letterSpacing: ".34em", color: "var(--seal)", fontWeight: 700 }}
            >
              支 持 方 案 權 益 說 明
            </span>
            {/* 標題與內文都走 nb 斷句：不加的話手機會把「金額」這種詞從中間拆開 */}
            <h1 style={{ fontSize: 27, fontWeight: 900, letterSpacing: ".08em", margin: "12px 0 10px", lineHeight: 1.5 }}>
              {nb("四種支持金額，對應的內容", 8)}
            </h1>
            <p style={{ color: "var(--grey)", fontSize: 15, lineHeight: 2, margin: 0, maxWidth: "60ch" }}>
              {nb("問爽的沒有廣告主，也沒有業配。支持讓文章、繪本與手繪圖能繼續產出。以下是每個階段提供的內容。", 15)}
            </p>

            {/* 手機一次看不完四欄，明講可以左右滑，否則使用者會以為只有 888 一種 */}
            <p className="fine" style={{ margin: "26px 0 6px", color: "var(--grey)", fontSize: 12.5, letterSpacing: ".08em" }}>
              表格可左右滑動，查看四個支持階段
            </p>
            {/* 表格在手機會超出螢幕，包一層自己的橫向捲動，不讓整頁左右晃 */}
            <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
              <table
                className="sans"
                style={{ borderCollapse: "collapse", width: "100%", minWidth: 640, fontSize: 14 }}
              >
                <thead>
                  <tr>
                    <th
                      style={{
                        textAlign: "left", padding: "0 12px 10px", borderBottom: "2px solid var(--ink)",
                        fontSize: 11.5, letterSpacing: ".14em", color: "var(--grey)", whiteSpace: "nowrap",
                      }}
                    >
                      支 持 內 容
                    </th>
                    {TIERS.map((t) => (
                      <th
                        key={t}
                        style={{
                          textAlign: "left", padding: "0 12px 10px", borderBottom: "2px solid var(--ink)",
                          fontSize: 14, color: "var(--seal)", fontWeight: 900, whiteSpace: "nowrap",
                          fontVariantNumeric: "tabular-nums",
                        }}
                      >
                        {t}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {ROWS.map((r) => (
                    <tr key={r.label}>
                      <td
                        style={{
                          padding: "12px", borderBottom: "1px solid rgba(58,50,38,.1)",
                          fontWeight: 700, whiteSpace: "nowrap",
                        }}
                      >
                        {r.label}
                      </td>
                      {r.v.map((v, i) => (
                        <td
                          key={i}
                          style={{
                            padding: "12px", borderBottom: "1px solid rgba(58,50,38,.1)",
                            color: v === "—" ? "var(--grey)" : "var(--ink)",
                            fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap",
                          }}
                        >
                          {v}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <h2 style={{ fontSize: 17, fontWeight: 900, letterSpacing: ".1em", marginTop: 34, marginBottom: 12 }}>
              提供方式與使用規則
            </h2>
            <ul style={{ margin: 0, paddingLeft: 20, color: "var(--grey)", fontSize: 14.5, lineHeight: 2.1 }}>
              {RULES.map((r) => (
                <li key={r} style={{ marginBottom: 4 }}>{r}</li>
              ))}
            </ul>

            <div
              style={{
                borderLeft: "3px solid var(--indigo, #2C4A6B)", background: "var(--rice-lt, #FBF8F0)",
                padding: "14px 18px", marginTop: 26, fontSize: 14, lineHeight: 2, color: "var(--grey)",
              }}
            >
              支持與商品購買均為數位內容服務，依法開立統一發票。
              權益內容以支持當下公告之版本為準，如有調整會事先通知既有支持者。
            </div>

            <div style={{ marginTop: 28, display: "flex", gap: 12, flexWrap: "wrap" }}>
              <Link className="btn fill" href="/support">回到支持頁</Link>
              <Link className="btn" href="/articles">看看文章</Link>
            </div>
          </div>
          <div className="band" />
        </div>
      </div>
      <Footer />
    </>
  );
}
