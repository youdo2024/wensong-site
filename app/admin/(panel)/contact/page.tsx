import type { Metadata } from "next";
import Link from "next/link";
import db from "@/lib/db";
import { money } from "@/lib/format";
import { contactQueue, reasonLabel, suspectPaidOrders, type ContactReason } from "@/lib/contact-queue";
import { markContacted, unmarkContacted, blockMailAddress } from "@/app/admin/actions";
import SmsDraft from "@/components/SmsDraft";

import { requireAdmin } from "@/lib/admin-guard";
import AdminTabs from "@/components/AdminTabs";
import PageHead from "@/components/admin/PageHead";
import FilterBar from "@/components/admin/FilterBar";
import Empty from "@/components/admin/Empty";
import { contactTone } from "@/components/admin/list-fmt";
export const metadata: Metadata = { title: "待聯絡" };
export const dynamic = "force-dynamic";

/*
 * 待聯絡（2026-09-06 改版第五批）。
 *
 * 原本是一疊左邊有粗色條的卡片，動作藏在卡片最底下兩條小字連結，
 * 站長是站著拿手機在處理這一頁的，那兩條連結按不到。
 * 現在改成跟提醒中心同一套：一筆一列，動作在列底下、每顆整行 44px。
 * 靛藍那條色條也跟著拿掉（admin-ui-spec 第二節，後台不再有靛藍）。
 * 表單、欄位名、server action 一個都沒有換。
 */

const REASONS: ContactReason[] = ["bad_email", "card_failed", "atm_due", "pending_long"];

export default async function AdminContact({
  searchParams,
}: {
  searchParams: Promise<{ done?: string; undone?: string; blocked?: string; r?: string; q?: string }>;
}) {
  await requireAdmin();
  const sp = await searchParams;
  const all = contactQueue();

  /* 已聯絡過的最近幾筆，讓你確認剛才那一筆真的記下來了，標錯也可以還原 */
  const doneRows = db
    .prepare(
      `SELECT 'order' kind,id,order_no,name,COALESCE(phone,'') phone,total,contacted_at FROM orders
        WHERE COALESCE(contacted_at,'')<>''
       UNION ALL
       SELECT 'sponsor',id,'支持 #' || id,COALESCE(display_name,''),COALESCE(phone,''),amount,contacted_at FROM sponsorships
        WHERE COALESCE(contacted_at,'')<>''
       ORDER BY contacted_at DESC LIMIT 12`
    )
    .all() as { kind: string; id: number; order_no: string; name: string; phone: string; total: number; contacted_at: string }[];

  /* 篩選：原因膠囊＋搜尋（姓名、信箱、訂單編號都找得到），切膠囊時搜尋字留著 */
  const r = String(sp.r || "all");
  const kw = String(sp.q || "").trim().toLowerCase();
  const list = all.filter((x) => {
    if (r !== "all" && x.reason !== r) return false;
    if (!kw) return true;
    return [x.name, x.email, x.orderNo, x.phone].some((v) => String(v || "").toLowerCase().includes(kw));
  });

  const sum = all.reduce((n, x) => n + x.total, 0);
  const suspects = suspectPaidOrders();
  const countOf = (k: ContactReason) => all.filter((x) => x.reason === k).length;

  const hrefFor = (k: string) => {
    const p = new URLSearchParams();
    if (k !== "all") p.set("r", k);
    if (sp.q) p.set("q", String(sp.q));
    const s = p.toString();
    return s ? `/admin/contact?${s}` : "/admin/contact";
  };

  return (
    <>
      <AdminTabs active="contact" tabs={[
        { key: "orders", label: "訂單", href: "/admin/orders" },
        { key: "remind", label: "提醒", href: "/admin/remind" },
        { key: "contact", label: "待聯絡", href: "/admin/contact" },
      ]} />
      <PageHead
        title="待 聯 絡"
        sub={<>{all.length} 位要親自聯絡，加起來 {money(sum)} 可能救得回來。系統已經寄過信但沒有結果的人都在這裡</>}
      />

      {sp.done && <p className="msg-ok">已標記為聯絡過，這筆從清單移除了。</p>}
      {sp.undone && <p className="msg-ok">已還原，這筆回到待聯絡清單。</p>}
      {sp.blocked && (
        <p className="msg-ok">
          已標記 {sp.blocked} 寄不到，全站都不會再寄給這個信箱，你也不會再收到它的退信。
          要恢復請到「發送」頁的「紀錄」分頁最下面。
        </p>
      )}

      <FilterBar
        chips={[
          { label: "全部", href: hrefFor("all"), on: r === "all" },
          ...REASONS.filter((k) => countOf(k) > 0).map((k) => ({
            label: `${reasonLabel(k)} ${countOf(k)}`,
            href: hrefFor(k),
            on: r === k,
          })),
        ]}
        search={{
          action: "/admin/contact",
          name: "q",
          defaultValue: sp.q || "",
          placeholder: "搜姓名、信箱、訂單編號",
          hidden: r === "all" ? {} : { r },
        }}
        viewToggle={false}
      />

      <p className="fine">
        信寄了沒回應，改用手機傳一則簡訊過去，對方看到的是你認得的號碼，比再寄一封信有用得多。
        每一則草稿都寫好了，複製貼上就能傳，也可以先改幾個字再傳。
        沒留電話的（滿 2,000 元的支持才會留）傳不了簡訊，改用後台寄一封信。
      </p>

      {list.length === 0 ? (
        <Empty>{kw || r !== "all" ? "沒有符合的人。換一顆膠囊或清掉搜尋字看看。" : "目前沒有需要聯絡的人，系統自動處理得過來。"}</Empty>
      ) : (
        <div className="ad-rlist">
          {list.map((x) => (
            <div className="ad-crow" data-tone={contactTone(x.reason)} key={`${x.kind}-${x.reason}-${x.id}`}>
              <div className="top">
                <span className="ad-l">
                  <span className="ad-nm">
                    {x.name}
                    {x.canSms
                      ? <a className="no sans" href={`tel:${x.phone.replace(/[^\d+]/g, "")}`}>　{x.phone}</a>
                      /* 沒留電話（舊的贊助紀錄都是），只能從後台寄一封信 */
                      : <Link className="no sans" href={`/admin/mail?to=${encodeURIComponent(x.email)}`}>　沒有電話，改用後台寄信</Link>}
                  </span>
                  <span className="ad-tm sans">
                    {x.orderNo}　{x.email}
                  </span>
                </span>
                <span className="ad-r">
                  <span className="ad-amt sans">{money(x.total)}</span>
                  <span className="ad-st2"><i />{x.kind === "sponsor" ? "支持・" : ""}{reasonLabel(x.reason)}</span>
                </span>
              </div>

              <p className="why">{x.headline}</p>
              {x.detail && <p className="why">{x.detail}</p>}

              {/*
                * 同一個人的其他紀錄。姓名、電話、信箱只要有一項對得上就列出來。
                * 傳簡訊之前先看這裡：戴與見那次就是換了信箱重下單、已經付過錢了，
                * 系統認不出來，結果催到一個已經付款的人。
                */}
              {x.related.length > 0 && (
                <div className={`rel${x.related.some((rel) => rel.paid) ? " warn" : ""}`}>
                  {x.related.some((rel) => rel.paid) && (
                    <b>先等一下：這個人另外有已經付款成功的紀錄，傳之前確認是不是同一筆</b>
                  )}
                  <div className="t">同一個人的其他紀錄</div>
                  {x.related.map((rel) => (
                    <div className="r sans" key={rel.orderNo}>
                      <span className={`badge ${rel.paid ? "green" : "grey"}`}>{rel.status}</span>
                      <span>{rel.orderNo}</span>
                      <span>{money(rel.total)}</span>
                      <span>{rel.matchedBy}相同</span>
                      <span>{rel.createdAt.slice(0, 10)}</span>
                    </div>
                  ))}
                </div>
              )}

              <div className="draft"><SmsDraft phone={x.phone} text={x.sms} /></div>

              {/* 動作在列底下：手機每一顆整行 44px，桌機排成一列 */}
              <div className="acts">
                <form action={markContacted}>
                  <input type="hidden" name="id" value={x.id} />
                  <input type="hidden" name="kind" value={x.kind} />
                  <button className="link-btn" type="submit">傳過了，從清單移除</button>
                </form>
                <Link href={x.kind === "sponsor" ? `/admin/sponsors?q=${encodeURIComponent(x.email)}` : `/admin/orders?q=${encodeURIComponent(x.orderNo)}`}>
                  {x.kind === "sponsor" ? "看贊助紀錄" : "看訂單"}
                </Link>
                {x.kind === "order" && (
                  <Link href={`/admin/orders/${x.id}#notify`}>用系統發（信、簡訊、LINE）</Link>
                )}
                {/* 收到這個人的退信時按這個。標了之後全站不再寄給他，
                    你就不會再收到一封又一封的退信 */}
                <form action={blockMailAddress}>
                  <input type="hidden" name="email" value={x.email} />
                  <input type="hidden" name="reason" value="從待聯絡標記：退信" />
                  <input type="hidden" name="back" value="contact" />
                  <button className="danger-link" type="submit">這個信箱寄不到，不要再寄</button>
                </form>
              </div>
            </div>
          ))}
        </div>
      )}

      {suspects.length > 0 && (
        <>
          <div className="ad-sect"><h2>可 能 有 錢 沒 收 到</h2><div className="rule" /></div>
          <p className="fine">
            這些訂單都確實走進過付款流程，或是虛擬帳號還活著，但系統沒有入帳。
            金流通知沒接上的時候完全沒有聲音，訂單就停在那裡，除非顧客自己來問。
            拿右邊那組編號去綠界或 LINE Pay 後台查，確認有入帳的，
            點進訂單用「錢已經收到了，但這筆沒有自動入帳」把它補回來。
            綠界主動回報過失敗的沒有列進來，那種確定沒扣到款。
            急迫度 1 是走進過金流或帳號還活著，2 是逾期取消而金流從頭到尾沒說過話
            （信用卡只有成功才回呼，所以沉默不代表沒付），3 是判定重複而取消的，
            同一個人另一筆確實有付，但也可能兩筆都付了。
          </p>
          <div className="ad-tablebox">
            <div className="adm-table-wrap">
              <table className="adm-table">
                <thead>
                  <tr><th>急</th><th>訂單</th><th>收件人</th><th>金額</th><th>狀態</th><th>付款方式</th><th>拿這個去查</th><th>為什麼要查</th></tr>
                </thead>
                <tbody>
                  {suspects.map((x) => (
                    <tr key={x.id}>
                      <td data-label="急">
                        <span className={`badge ${x.rank === 1 ? "red" : "grey"}`}>{x.rank}</span>
                      </td>
                      <td className="sans" data-label="訂單"><Link href={`/admin/orders/${x.id}`}>{x.orderNo}</Link></td>
                      <td data-label="收件人">{x.name}</td>
                      <td className="sans" data-label="金額"><b>{money(x.total)}</b></td>
                      <td data-label="狀態">
                        <span className={`badge ${x.status === "cancelled" ? "red" : "grey"}`}>
                          {x.status === "cancelled" ? "已取消" : "待付款"}
                        </span>
                      </td>
                      <td data-label="付款方式">{x.payMethod}</td>
                      <td className="sans brk" data-label="拿這個去查">{x.lookup}</td>
                      <td className="fine" data-label="為什麼要查">{x.why}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* 頁尾工具區（ia.md §4）：「剛才標記過誰」是事後查，不是現在要做的事 */}
      <details className="ad-tools">
        <summary>工具（最近標記聯絡過、這頁的規則）</summary>
        <div className="in">
          {doneRows.length === 0 ? (
            <Empty>還沒有標記過任何一筆。</Empty>
          ) : (
            <div className="ad-tablebox">
              <div className="adm-table-wrap">
                <table className="adm-table">
                  <thead>
                    <tr><th>訂單</th><th>姓名</th><th>電話</th><th>金額</th><th>標記時間</th><th></th></tr>
                  </thead>
                  <tbody>
                    {doneRows.map((row) => (
                      <tr key={`${row.kind}-${row.id}`}>
                        <td className="sans" data-label="訂單">{row.order_no}</td>
                        <td data-label="姓名">{row.name}</td>
                        <td className="sans" data-label="電話">{row.phone}</td>
                        <td className="sans" data-label="金額">{money(row.total)}</td>
                        <td className="sans" data-label="標記時間">{new Date(row.contacted_at).toLocaleString("zh-TW", { timeZone: "Asia/Taipei", hour12: false })}</td>
                        <td className="acts">
                          <form action={unmarkContacted}>
                            <input type="hidden" name="id" value={row.id} />
                            <input type="hidden" name="kind" value={row.kind} />
                            <button className="link-btn" type="submit">還原</button>
                          </form>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          <p className="fine">
            商店訂單一定有電話（結帳必填）。支持滿 2,000 元從 8/19 起會留手機，
            在那之前的舊紀錄沒有，那些人只能寄信。
          </p>
        </div>
      </details>
    </>
  );
}
