import type { Metadata } from "next";
import Link from "next/link";
import db, { json } from "@/lib/db";
import { money, fmtDateTimeDash } from "@/lib/format";
import { parseChoiceStocks } from "@/lib/choice-stock";
import { enabledPays, shopGateway } from "@/lib/shop";
import { linepayEnabled } from "@/lib/linepay";
import { payLinkItems, payLinkTotal, type PayLinkRow } from "@/lib/pay-link";
import { cancelPayLinkAction } from "@/app/admin/actions";
import CopyField from "@/components/CopyField";
import PayLinkForm from "@/components/PayLinkForm";
import ConfirmSubmit from "@/components/ConfirmSubmit";

import { requireAdmin } from "@/lib/admin-guard";
import AdminTabs from "@/components/AdminTabs";
import PageHead from "@/components/admin/PageHead";
import Empty from "@/components/admin/Empty";
import KV from "@/components/admin/KV";
import { payLinkStatus } from "@/components/admin/list-fmt";
export const metadata: Metadata = { title: "付款連結" };
export const dynamic = "force-dynamic";

/*
 * 付款連結（2026-09-06 改版第六批）。
 *
 * 手機一行一條（照 ia.md §4），點一下就地展開那一條的明細、網址與作廢，
 * 展開狀態放在網址上（?open=id）：這一頁按作廢會整頁重畫，
 * 開合狀態交給瀏覽器記的話，站長按完返回會發現剛剛看的那條又收起來了。
 * 桌機還是表格，因為「哪幾條還可用、哪幾條已成單」要一次掃一整欄。
 */

export default async function AdminPayLinks({
  searchParams,
}: {
  searchParams: Promise<{ created?: string; err?: string; cancelled?: string; open?: string; new?: string; title?: string; name?: string; phone?: string; email?: string; taxId?: string; company?: string; qty?: string }>;
}) {
  await requireAdmin();
  const sp = await searchParams;
  const site = (process.env.SITE_URL || "https://www.wensong.tw").replace(/\/$/, "");

  const products = (
    db.prepare("SELECT id,name,price,stock,option_name,option_choices,choice_stocks FROM products WHERE published=1 ORDER BY sort, id").all() as {
      id: number; name: string; price: number; stock: number; option_name: string; option_choices: string; choice_stocks: string;
    }[]
  ).map((p) => ({
    id: p.id,
    name: p.name,
    price: p.price,
    stock: p.stock,
    option_name: p.option_name || "",
    choices: json<string[]>(p.option_choices, []),
    stocks: parseChoiceStocks(p.choice_stocks),
  }));

  const gateway = shopGateway();
  const pays =
    gateway === "tappay"
      ? enabledPays(["信用卡"])
      : enabledPays(["ATM 轉帳", "信用卡", "LINE Pay", "Apple Pay", "多元支付"]).filter((p) => p !== "LINE Pay" || linepayEnabled());

  const list = db.prepare("SELECT * FROM pay_links ORDER BY id DESC LIMIT 200").all() as PayLinkRow[];
  const openN = list.filter((l) => l.status === "open").length;

  const hasPreset = Boolean(sp.title || sp.email);
  const openNew = sp.new === "1" || hasPreset || list.length === 0;
  /* 展開中的那一條。再點一次就收起來（回到沒有 open 的同一份網址） */
  const openId = Number(sp.open) || 0;
  const rowHref = (id: number) => `${openId === id ? "/admin/pay-links" : `/admin/pay-links?open=${id}`}#l${id}`;

  const itemText = (l: PayLinkRow) =>
    payLinkItems(l)
      .map((i) => `${i.name}${i.choice ? `（${i.choice}）` : ""} × ${i.qty}${i.id > 0 ? "" : "〔不綁商品〕"}`)
      .join("、");

  return (
    <>
      <AdminTabs active="pay-links" tabs={[
        { key: "pay-links", label: "付款連結", href: "/admin/pay-links" },
        { key: "discounts", label: "折扣碼", href: "/admin/discounts" },
      ]} />

      <PageHead
        title="付 款 連 結"
        sub={<>{list.length} 條，{openN} 條還可以用。一條連結只成立一張訂單，地址由對方自己填</>}
        action={<Link className="btn fill" href="/admin/pay-links?new=1#new">建立付款連結</Link>}
      />

      <p className="fine">
        先把品項、數量、價格談好配置成一條連結，對方打開就是結帳頁，自己填收件與發票資料，走站上原本的金流。
        訂單在對方送出的那一刻才成立。
      </p>

      {sp.err && <p className="msg-err">{sp.err}</p>}
      {sp.cancelled && <p className="msg-ok">連結已作廢，預扣的庫存已經放回去了。</p>}
      {sp.created && (
        <div className="ad-note">
          <b>連結建好了，把這條網址給對方</b>
          <CopyField value={`${site}/pay/${sp.created}`} />
          <p className="fine">
            綁定商品的庫存已經預扣，別人買不到那些量。這條連結只能成立一張訂單。
          </p>
        </div>
      )}

      {/* 建立新連結：開合狀態放在網址上（?new=1），從企業訂購帶參數過來時自動開著 */}
      <details className="ad-newbox" id="new" open={openNew}>
        <summary>建立一條新的付款連結</summary>
        <div className="in">
          <PayLinkForm
            products={products}
            pays={pays}
            presets={{ title: sp.title, name: sp.name, phone: sp.phone, email: sp.email, taxId: sp.taxId, company: sp.company, qty: sp.qty }}
          />
        </div>
      </details>

      {list.length === 0 ? (
        <Empty>還沒有建立過付款連結。按右上角「建立付款連結」開第一條。</Empty>
      ) : (
        <>
          {/* 手機：一行一條，點開就地展開那一條的網址與作廢 */}
          <div className="ad-rows">
            {list.map((l) => {
              const items = payLinkItems(l);
              const [label, tone] = payLinkStatus(l.status);
              const on = openId === l.id;
              return (
                <div key={l.id} id={`l${l.id}`} className={`ad-rowwrap${on ? " on" : ""}`}>
                  <Link className="ad-row" href={rowHref(l.id)} data-tone={tone} aria-expanded={on}>
                    <span className="ad-l">
                      <span className="ad-nm">{l.title || "（沒有備註）"}<span className="no">　{itemText(l)}</span></span>
                      <span className="ad-tm sans">{fmtDateTimeDash(l.created_at)}</span>
                    </span>
                    <span className="ad-r">
                      <span className="ad-amt sans">{money(payLinkTotal(items))}</span>
                      <span className="ad-st2"><i />{label}</span>
                    </span>
                  </Link>
                  {on && (
                    <div className="ad-open">
                      <KV rows={[
                        { k: "狀態", v: <>{label}{l.reserved === 1 ? "（庫存預扣中）" : ""}</> },
                        { k: "品項", v: itemText(l) || "—" },
                        { k: "合計", v: <span className="sans">{money(payLinkTotal(items))}</span> },
                        { k: "寄送", v: l.need_address ? "需要收件地址" : "不用寄送（不收運費）" },
                        { k: "保留", v: `${l.hold_days} 天` },
                        { k: "付款", v: json<string[]>(l.pays, []).join("、") || "—" },
                        ...(l.inv_tax_id ? [{ k: "統編", v: <span className="sans">{l.inv_tax_id}</span> }] : []),
                        ...(l.order_no ? [{ k: "訂單", v: <Link className="sans" href="/admin/orders">{l.order_no}</Link> }] : []),
                      ]} />
                      {l.status === "open" && (
                        <div className="acts">
                          <CopyField value={`${site}/pay/${l.token}`} />
                          <form action={cancelPayLinkAction}>
                            <input type="hidden" name="id" value={l.id} />
                            <ConfirmSubmit className="danger-link" message="確定作廢這條付款連結？連結立刻失效，預扣的庫存會放回去，作廢後無法恢復。">作廢並放回庫存</ConfirmSubmit>
                          </form>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <p className="ad-listnote">點一條就地展開，網址與作廢都在裡面。</p>
        </>
      )}

      <div className="ad-tablebox">
        <div className="adm-table-wrap">
          <table className="adm-table">
            <thead><tr><th>備註</th><th>品項</th><th className="num">合計</th><th>狀態</th><th>條件</th><th>建立時間</th><th>連結</th></tr></thead>
            <tbody>
              {list.length === 0 && <tr><td colSpan={7} className="empty">還沒有建立過付款連結</td></tr>}
              {list.map((l) => {
                const items = payLinkItems(l);
                const [label, tone] = payLinkStatus(l.status);
                return (
                  <tr key={l.id}>
                    <td data-label="備註">{l.title || "（沒有備註）"}</td>
                    <td data-label="品項">{itemText(l) || "—"}</td>
                    <td data-label="合計" className="sans num">{money(payLinkTotal(items))}</td>
                    <td data-label="狀態">
                      <span className="ad-st" data-tone={tone}><i />{label}</span>
                      {/* 已保留的量在夥伴工作台看得到，所以這裡也要講清楚庫存還在不在手上 */}
                      {l.reserved === 1 && <div>庫存預扣中</div>}
                      {l.order_no && <div><Link className="sans" href="/admin/orders">{l.order_no}</Link></div>}
                    </td>
                    <td data-label="條件">
                      {l.need_address ? "需要收件地址" : "不用寄送"}・保留 {l.hold_days} 天
                      <div>{json<string[]>(l.pays, []).join("、") || "—"}{l.inv_tax_id ? `　統編 ${l.inv_tax_id}` : ""}</div>
                    </td>
                    <td data-label="建立時間" className="sans">{fmtDateTimeDash(l.created_at)}</td>
                    <td className="acts">
                      {l.status === "open" ? (
                        <div className="ad-actcol">
                          <CopyField value={`${site}/pay/${l.token}`} />
                          <form action={cancelPayLinkAction}>
                            <input type="hidden" name="id" value={l.id} />
                            <ConfirmSubmit className="danger-link" message="確定作廢這條付款連結？連結立刻失效，預扣的庫存會放回去，作廢後無法恢復。">作廢並放回庫存</ConfirmSubmit>
                          </form>
                        </div>
                      ) : (
                        <span className="tone-muted">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
