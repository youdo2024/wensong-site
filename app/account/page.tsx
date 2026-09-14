import type { Metadata } from "next";
import { buildMetadata } from "@/lib/seo";
import Link from "next/link";
import Nav from "@/components/Nav";
import Footer from "@/components/Footer";
import db, { json } from "@/lib/db";
import { getMember, googleEnabled, lineEnabled, memberEnabled } from "@/lib/member";
import { lineNotifyOn as lineNotifyEnabled, findLineBinding, addFriendUrl } from "@/lib/line";
import OtherLogins from "@/components/OtherLogins";
import { money, ORDER_STATUS } from "@/lib/format";
import { memberLogout, toggleNewsletter } from "./actions";

export const metadata: Metadata = buildMetadata({ title: "會員中心", path: "/account", noindex: true });
export const dynamic = "force-dynamic";

type OrderRow = {
  order_no: string; status: string; total: number; created_at: string;
  items: string; address: string; ship_method: string;
};

export default async function AccountPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; line?: string }>;
}) {
  const { error, line } = await searchParams;
  const member = await getMember();

  /* 未啟用（環境變數沒設）就整頁導回首頁，前台也不會有入口 */
  if (!memberEnabled()) {
    return (
      <>
        <Nav />
        <div className="frame" style={{ maxWidth: 560, padding: "72px 20px 120px" }}>
          <div className="box center">
            <div className="band" />
            <div className="inner" style={{ paddingTop: 44, paddingBottom: 44 }}>
              <h2 style={{ fontSize: 24, fontWeight: 900, letterSpacing: ".14em" }}>會員功能即將開放</h2>
              <p style={{ color: "var(--grey)", fontSize: 14.5, marginTop: 12 }}>
                目前可用「訂單編號＋Email」<Link href="/orders" style={{ textDecoration: "underline" }}>查詢訂單</Link>。
              </p>
            </div>
            <div className="band" />
          </div>
        </div>
        <Footer />
      </>
    );
  }

  if (!member) {
    return (
      <>
        <Nav />
        <div className="frame" style={{ maxWidth: 560, padding: "72px 20px 120px" }}>
          <div className="box center">
            <div className="band" />
            <div className="inner" style={{ paddingTop: 44, paddingBottom: 44 }}>
              <h2 style={{ fontSize: 24, fontWeight: 900, letterSpacing: ".14em" }}>會 員 登 入</h2>
              <p style={{ color: "var(--grey)", fontSize: 14.5, margin: "12px 0 26px", lineHeight: 2 }}>
                登入後可以查看訂單進度與購買紀錄，結帳自動帶入資料。
              </p>
              {/* LINE 的 email 權限審核要看到「網站有說明拿 Email 做什麼」，這一段就是給審核截圖用的，也是個資法的告知 */}
              <p className="fine" style={{ margin: "-14px 0 22px", lineHeight: 1.9 }}>
                登入時會取得你的名稱與 Email，只用來對應你的訂單、寄送訂單與出貨通知，不會用於其他用途，也不會提供給第三人。
                詳見<Link href="/privacy" style={{ textDecoration: "underline" }}>隱私權政策</Link>。
              </p>
              {error === "login" && <p className="msg-err">登入沒有成功，請再試一次。</p>}
              {/* 站長指示 2026-09-03：只留 LINE 一顆大按鈕，Google 藏在「其他登入方式」後面。
                  LINE 沒設定時退回原本的 Google 按鈕。 */}
              <div style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 300, margin: "0 auto" }}>
                {lineEnabled() ? (
                  <>
                    <a className="btn" href="/api/auth/line" style={{ background: "#06C755", color: "#fff", borderColor: "#06C755", fontSize: 16, padding: "14px 30px" }}>
                      用 LINE 登入
                    </a>
                    {lineNotifyEnabled() && <p className="fine" style={{ margin: 0 }}>登入時順便加官方帳號好友，訂單進度直接在 LINE 通知你。</p>}
                    {googleEnabled() && <OtherLogins />}
                  </>
                ) : (
                  googleEnabled() && <a className="btn fill" href="/api/auth/google">用 Google 帳號登入</a>
                )}
              </div>
              <p className="fine" style={{ marginTop: 24 }}>
                贊助不需要會員；會員只用於商店購物。
              </p>
            </div>
            <div className="band" />
          </div>
        </div>
        <Footer />
      </>
    );
  }

  const orders = member.email
    ? (db.prepare("SELECT order_no,status,total,created_at,items,address,ship_method FROM orders WHERE email=? ORDER BY id DESC LIMIT 50")
        .all(member.email) as OrderRow[])
    : [];

  return (
    <>
      <Nav showCart />
      <div className="frame" style={{ maxWidth: 760, padding: "56px 20px 100px" }}>
        <div className="page-head">
          <span className="tag">會 員 中 心</span>
          <h1>{member.name || "你好"}</h1>
          <p>{member.email || "尚未設定 Email"}　·　{member.provider === "google" ? "Google 登入" : "LINE 登入"}</p>
        </div>

        {/* 2026-09-05 拿掉自己填 Email 的表單：填了就能看到那個 Email 的訂單與收件地址，等於誰都查得到別人的訂單。
            沒有 Email 的帳號改成指路到訂單確認信裡的綁定連結，那條路有 token，證明得了訂單是本人的。 */}
        {!member.email && (
          <div className="box" style={{ marginBottom: 24 }}>
            <div className="inner" style={{ padding: "22px 26px" }}>
              <p className="fine" style={{ margin: 0 }}>
                這個帳號沒有 Email，看訂單請用訂單確認信裡的 LINE 綁定連結，綁定後這裡就會出現。
              </p>
            </div>
          </div>
        )}

        <h3 className="f">我 的 訂 單</h3>
        {orders.length === 0 ? (
          <p className="fine" style={{ margin: "10px 0 26px" }}>
            還沒有訂單紀錄。去<Link href="/shop" style={{ textDecoration: "underline" }}>商店</Link>逛逛。
          </p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 14, margin: "12px 0 26px" }}>
            {orders.map((o) => {
              const items = json<{ name: string; choice: string | null; qty: number }[]>(o.items, []);
              return (
                <div className="box" key={o.order_no}>
                  <div className="inner" style={{ padding: "18px 22px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                      <b className="sans">{o.order_no}</b>
                      <span>{ORDER_STATUS[o.status] ?? o.status}　<b className="sans">{money(o.total)}</b></span>
                    </div>
                    <p className="fine" style={{ margin: "8px 0 0" }}>
                      {items.map((i) => `${i.name}${i.choice ? `（${i.choice}）` : ""}×${i.qty}`).join("、")}
                    </p>
                    <p className="fine" style={{ margin: "4px 0 0" }}>
                      {o.ship_method || "宅配"}：{o.address}
                      　·　{o.created_at.slice(0, 10)}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {lineNotifyEnabled() && (() => {
          const b = findLineBinding({ email: member.email, userId: member.id });
          const bound = line === "bound" || b?.status === "bound";
          return (
            <>
              <h3 className="f">LINE 通 知</h3>
              {bound ? (
                <p className="fine" style={{ marginTop: 0 }}>LINE 通知：<b style={{ color: "#4A6B2C" }}>已開啟</b>。用這個 Email 或同一支手機下的訂單，付款與出貨進度會直接在 LINE 通知你。想關掉就封鎖官方帳號。</p>
              ) : (
                <>
                  <p className="fine" style={{ marginTop: 0 }}>
                    {line === "nofriend" || b?.status === "nofriend"
                      ? "還差一步：要加官方帳號好友，通知才送得到。加好友後再按一次下面的按鈕。"
                      : b?.status === "blocked"
                        ? "你封鎖了官方帳號，通知目前改走 Email。解除封鎖後再按一次下面的按鈕就恢復。"
                        : "把訂單的付款與出貨通知直接送到你的 LINE，按一下就好，不用打字。"}
                  </p>
                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap", margin: "8px 0 30px" }}>
                    <a className="btn" href="/api/auth/line?bind=1" style={{ background: "#06C755", color: "#fff", borderColor: "#06C755" }}>開啟 LINE 通知</a>
                    {(line === "nofriend" || b?.status === "nofriend") && addFriendUrl() && <a className="btn" href={addFriendUrl()} target="_blank" rel="noopener">加入官方帳號好友</a>}
                  </div>
                  <p className="fine" style={{ fontSize: 11.5, marginTop: -20, marginBottom: 30 }}>綁定即同意用 LINE 接收訂單通知，封鎖官方帳號即取消。</p>
                </>
              )}
            </>
          );
        })()}

        <h3 className="f">新 品 通 知</h3>
        {/* 沒有 Email 就沒地方寄，開關留著也沒有意義，直接說明原因 */}
        {member.email ? (
          <>
            <p className="fine" style={{ marginTop: 0 }}>
              {member.newsletter
                ? "你目前會收到新品與產地故事的 Email 通知。不想收的話，點下面按鈕取消即可。"
                : "目前未訂閱。想在有新品或新故事時收到通知，點下面按鈕即可。"}
            </p>
            <form action={toggleNewsletter} style={{ margin: "8px 0 30px" }}>
              <button className="btn" type="submit">
                {member.newsletter ? "取消訂閱通知" : "訂閱新品與產地故事通知"}
              </button>
            </form>
          </>
        ) : (
          <p className="fine" style={{ margin: "0 0 30px" }}>
            這個帳號沒有 Email，通知信沒地方寄，所以先關著。
          </p>
        )}

        <form action={memberLogout}>
          <button className="btn" type="submit" style={{ color: "var(--grey)" }}>登出</button>
        </form>
      </div>
      <Footer />
    </>
  );
}
