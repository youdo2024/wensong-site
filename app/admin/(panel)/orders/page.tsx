import type { Metadata } from "next";
import ConfirmSubmit from "@/components/ConfirmSubmit";
import Link from "next/link";
import db from "@/lib/db";
import { money, fmtDateTime, ORDER_STATUS } from "@/lib/format";
import { clearAllOrders, createGiftOrdersAction } from "@/app/admin/actions";
import RemindButtons from "@/components/admin/RemindButtons";
import GiftOrderForm from "@/components/GiftOrderForm";
import { json } from "@/lib/db";
import { orderSupersededBy } from "@/lib/order-superseded";
import { emailTypoSuggestion } from "@/lib/email-typo";
import PayStats from "@/components/PayStats";
import { orderStats } from "@/lib/order-stats";
import { amegoConfig } from "@/lib/amego";
import { tappayConfig, tappayEnabled } from "@/lib/tappay";
import { shopGateway } from "@/lib/shop";

import { requireAdmin } from "@/lib/admin-guard";
import AdminTabs from "@/components/AdminTabs";
import PageHead from "@/components/admin/PageHead";
import FilterBar from "@/components/admin/FilterBar";
import Empty from "@/components/admin/Empty";
import { relTime, statusTone, orderLast4 } from "@/components/admin/order-fmt";
export const metadata: Metadata = { title: "訂單管理" };

/* 手動補寄提醒信的結果訊息 */
const REMIND_MSG: Record<string, string> = {
  ok: "提醒已發出（信裡附免重填的付款連結；有綁 LINE 的推 LINE，沒有的補一則簡訊）。",
  notpending: "這筆已經不是「待付款」了，沒有寄出提醒信。",
  noemail: "這筆沒有 Email 或付款權杖，無法寄提醒信。",
  nosmtp: "還沒設定寄信服務（SMTP），無法寄提醒信。",
  fail: "提醒信寄送失敗，請稍後再試或檢查寄信設定。",
  superseded: "這位顧客後來已經有一筆訂單付款成功，沒有寄出提醒（再催他會以為自己沒買成功）。",
};

/*
 * 狀態膠囊五顆（ia.md §4，站長拍板）：全部、待付款、已付款、已出貨、失敗。
 * 「失敗」對到資料庫的 cancelled：付款沒完成的單會被自動取消，站長心裡叫它失敗不叫取消。
 * 網址參數名沿用原本的 status，舊書籤（含 status=done）照樣打得開，只是不再有膠囊。
 */
const CHIPS: [string, string][] = [
  ["all", "全部"],
  ["pending", "待付款"],
  ["paid", "已付款"],
  ["shipped", "已出貨"],
  ["cancelled", "失敗"],
];

/* App 內建瀏覽器的短標籤，來源欄用 */
const ENV_LABEL: Record<string, string> = { fb: "FB內建", ig: "IG內建", line: "LINE內建", wv: "其他App內建" };

export default async function AdminOrders({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; deleted?: string; cleared?: string; remind?: string; detail?: string; q?: string; gift?: string; gifterr?: string; giftbad?: string }>;
}) {
  await requireAdmin();
  const { status = "all", deleted, cleared, remind, detail, q, gift, gifterr, giftbad } = await searchParams;
  /* 進到訂單頁＝已讀：清掉總覽鈴鐺的未讀數 */
  db.prepare("UPDATE orders SET admin_seen=1 WHERE admin_seen=0").run();
  const products = db.prepare("SELECT id,name,option_choices FROM products ORDER BY sort, id").all() as
    { id: number; name: string; option_choices: string }[];
  const list = (
    status === "all"
      ? db.prepare("SELECT id,order_no,name,email,total,status,created_at,remind_at,remind_count,source,env,pay_note,pay_method FROM orders ORDER BY id DESC").all()
      : db.prepare("SELECT id,order_no,name,email,total,status,created_at,remind_at,remind_count,source,env,pay_note,pay_method FROM orders WHERE status=? ORDER BY id DESC").all(status)
  ) as { id: number; order_no: string; name: string; email: string; total: number; status: string; created_at: string; remind_at: string; remind_count: number; source: string; env: string; pay_note: string; pay_method: string }[];
  /*
   * 搜尋：用訂單編號、信箱、姓名或電話找人。
   * 沒有這個的話，收到一封退信卻翻不到是哪一筆，等於看得到問題卻碰不到它。
   */
  const kw = String(q || "").trim().toLowerCase();
  if (kw) {
    const hit = (o: (typeof list)[number]) =>
      [o.order_no, o.email, o.name].some((v) => String(v || "").toLowerCase().includes(kw));
    for (let i = list.length - 1; i >= 0; i--) if (!hit(list[i])) list.splice(i, 1);
  }

  /* 待付款但同一個人後來買成功了＝前面那幾筆是刷失敗的殘骸，不該再催 */
  const superseded = new Map(
    list.filter((o) => o.status === "pending").map((o) => [o.id, orderSupersededBy(o)] as const)
  );

  const os = orderStats();
  /* 副標那一句：全站幾筆、其中幾筆待付款。統計卡已經搬到總覽，這句是這頁僅存的數字 */
  const totalAll = (db.prepare("SELECT COUNT(*) n FROM orders").get() as { n: number }).n;

  /* 建立贈品訂單用：上架中而且有出貨週選項的商品 */
  const giftProducts = (
    db.prepare("SELECT id,name,option_choices FROM products WHERE published=1 ORDER BY sort, id").all() as
      { id: number; name: string; option_choices: string }[]
  ).map((p) => ({ id: p.id, name: p.name, choices: json<string[]>(p.option_choices, []) }));

  /* 膠囊與「清除搜尋」的網址：狀態與關鍵字互不覆蓋，切狀態時搜尋字要留著 */
  const hrefFor = (k: string) => {
    const p = new URLSearchParams();
    if (k !== "all") p.set("status", k);
    if (kw) p.set("q", String(q));
    const s = p.toString();
    return s ? `/admin/orders?${s}` : "/admin/orders";
  };

  return (
    <>
      <AdminTabs active="orders" tabs={[
        { key: "orders", label: "訂單", href: "/admin/orders" },
        { key: "remind", label: "提醒", href: "/admin/remind" },
        { key: "contact", label: "待聯絡", href: "/admin/contact" },
      ]} />
      <PageHead
        title="訂 單"
        sub={kw
          ? <>搜尋「{q}」找到 {list.length} 筆・<Link href={status === "all" ? "/admin/orders" : `/admin/orders?status=${status}`}>清除</Link></>
          : <>{totalAll} 筆，{os.pending.n} 筆待付款</>}
      />

      {gift && (
        <p className="msg-ok">
          已建立 {gift.split(",").length} 筆贈品訂單：<b className="sans">{gift.split(",").join("、")}</b>
          。這幾筆已經在夥伴的待出貨清單裡，該週的位子也扣掉了。金額 0 元、不開發票、不計入營收統計。
        </p>
      )}
      {gifterr && (
        <div className="msg-err">
          {/* 一次把每一條問題都列出來。只講第一條的話，站長改完再送，
              系統才告訴他第二條，十八位的名單要來回好幾趟。 */}
          <b>整批都沒有建立，下面 {gifterr.split("\n").length} 個地方要改：</b>
          <ul className="ad-errlist">
            {gifterr.split("\n").map((line, i) => <li key={i}>{line}</li>)}
          </ul>
          <span className="fine">你剛剛填的名單沒有消失，已經自動存成草稿長回下面的表單裡了。</span>
        </div>
      )}

      {/* 發票環境：贊助頁本來就有這條，訂單頁卻沒有。
          商店訂單的發票同樣由光貿開立，開在測試環境時一樣要一眼看得出來。 */}
      {!amegoConfig().live && (
        <p className="msg-err">
          光貿電子發票目前是「測試環境」：Zeabur 沒讀到 AMEGO_TAX_ID／AMEGO_APP_KEY（名稱要完全一致），
          訂單開出的發票不是真的，顧客也不會收到。請確認環境變數後重新部署。
        </p>
      )}
      {/* 付款金流環境：沙箱代表顧客的卡不會真的被扣款 */}
      {shopGateway() === "tappay" && tappayEnabled() && tappayConfig().sandbox && (
        <p className="msg-err">
          TapPay 目前是「沙箱」環境：顧客刷卡不會真的扣款，訂單卻會顯示已付款。
          正式開賣前請到 Zeabur 設定 TAPPAY_SANDBOX=0。
        </p>
      )}
      {deleted && <p className="msg-ok">訂單已刪除，庫存已加回。</p>}
      {remind && <p className={remind === "ok" ? "msg-ok" : "msg-err"}>{REMIND_MSG[remind] || "提醒沒有發出。"}{detail && <><br /><span>{detail}</span></>}</p>}
      {cleared === "badconfirm" && <p className="msg-err">確認文字不符，未清空。請在框內輸入「清空訂單」四個字。</p>}
      {cleared && cleared !== "badconfirm" && <p className="msg-ok">已清空 {cleared} 筆訂單，所有商品統計歸零，庫存已加回。</p>}

      <FilterBar
        chips={CHIPS.map(([k, label]) => ({ label, href: hrefFor(k), on: status === k }))}
        search={{
          action: "/admin/orders",
          name: "q",
          defaultValue: q || "",
          placeholder: "搜訂單編號、姓名、信箱",
          hidden: status === "all" ? {} : { status },
        }}
      />

      {/* 手機：一行一單，整行點進詳情。桌機用下面那張表格，兩邊資料同一份 list */}
      {list.length === 0 ? (
        <Empty>沒有符合的訂單。換一顆狀態膠囊或清掉搜尋字看看。</Empty>
      ) : (
        <>
          <div className="ad-rows">
            {list.map((o) => (
              <Link key={o.id} className="ad-row" href={`/admin/orders/${o.id}`} data-tone={statusTone(o.status)}>
                <span className="ad-l">
                  <span className="ad-nm">{o.name || "（沒有留名字）"}<span className="no sans">　{orderLast4(o.order_no)}</span></span>
                  <span className="ad-tm sans">{relTime(o.created_at)}</span>
                </span>
                <span className="ad-r">
                  <span className="ad-amt sans">{money(o.total)}</span>
                  <span className="ad-st2"><i />{ORDER_STATUS[o.status] ?? o.status}</span>
                </span>
              </Link>
            ))}
          </div>
          <p className="ad-listnote">整行可點進詳情，動作在詳情頁做。要一鍵催款去「<Link href="/admin/remind">提醒</Link>」。</p>
        </>
      )}

      {/* 桌機表格；手機按「看表格」（ViewToggle）也會切到這張。
          外面那層 .adm-table-wrap 給橫向捲動，不然統計式在手機上會把版面撐爆 */}
      <div className="ad-tablebox">
        <div className="adm-table-wrap">
          <table className="adm-table">
            <thead><tr><th>訂單</th><th>姓名</th><th>金額・付款</th><th>狀態</th><th>時間</th><th>動作</th></tr></thead>
            <tbody>
              {list.length === 0 && <tr><td colSpan={6} className="empty">沒有符合的訂單</td></tr>}
              {list.map((o) => (
                <tr key={o.id}>
                  {/* 編號、信箱、來源同一格：來源與 App 內建瀏覽器是付款失敗時唯一的線索，
                      畫布上沒有這一欄，但拿掉等於失敗了只能用猜的，所以收進副行 */}
                  <td data-label="訂單">
                    <Link className="sans" href={`/admin/orders/${o.id}`}>{o.order_no}</Link>
                    <span className="sub2 sans">
                      <Link href={`/admin/mail?to=${encodeURIComponent(o.email)}`} title="用站上的信件版型寄信給他">{o.email}</Link>
                      {emailTypoSuggestion(o.email) && <><br /><span className="tone-fail">信箱可能打錯，應該是 {emailTypoSuggestion(o.email)}</span></>}
                      {o.source && <><br /><span className="tone-muted" title={o.source}>{o.source}{o.env ? `（${ENV_LABEL[o.env] || o.env}）` : ""}</span></>}
                    </span>
                  </td>
                  <td data-label="姓名">{o.name}</td>
                  <td className="sans" data-label="金額・付款">
                    {money(o.total)}
                    <span className="sub2">
                      {o.pay_method || "—"}
                      {o.status === "cancelled" && o.pay_note && <><br />{o.pay_note.replace(/\(https?:[^)）]*\)|（https?:[^）]*）/g, "").slice(0, 70)}</>}
                    </span>
                  </td>
                  <td data-label="狀態">
                    <span className="ad-st" data-tone={statusTone(o.status)}><i />{ORDER_STATUS[o.status] ?? o.status}</span>
                  </td>
                  <td className="sans" data-label="時間">{fmtDateTime(o.created_at)}</td>
                  {/* 動作只留在桌機這一欄：待付款可以手動補寄催款信（信裡有免重填的付款連結），
                      其他種類的通知與指定管道都在訂單詳情的同一區。 */}
                  <td data-label="動作">
                    {o.status === "pending" && superseded.get(o.id) ? (
                      <span className="tone-muted">已由 <b className="sans">{superseded.get(o.id)}</b> 付款成功，不再提醒</span>
                    ) : o.status === "pending" ? (
                      <RemindButtons kind="order" id={o.id} back="orders" />
                    ) : null}
                    <span className="sub2"><Link href={`/admin/orders/${o.id}#notify`}>其他通知 →</Link></span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* 頁尾工具區（ia.md §4）：匯出、贈品訂單、成功率速覽這些一週用不到一次的東西收起來。
          全部維持原本的表單與欄位名，只是換了位置。 */}
      <details className="ad-tools" open={Boolean(gifterr)}>
        <summary>工具（匯出、建立贈品訂單、付款成功率）</summary>
        <div className="in">
          <h3 className="f">匯 出 Excel</h3>
          <div className="adm-actions">
            <a className="btn sm" href={status === "all" ? "/api/admin/orders-csv" : `/api/admin/orders-csv?status=${status}`}>
              匯出 Excel（{status === "all" ? "全部" : ORDER_STATUS[status] ?? status}）
            </a>
          </div>
          <h3 className="f">匯 出 某 一 個 品 項</h3>
          {/* 選商品、填規格（例如尺寸 M），匯出所有含該品項的訂單 */}
          <form action="/api/admin/orders-csv" method="get" className="adm-search">
            <select name="product" required>
              <option value="">選商品…</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            <input type="text" name="choice" placeholder="規格（如 M；留空＝全部）" />
            <button className="btn sm" type="submit">匯出該品項訂單</button>
          </form>
          {giftProducts.length > 0 && (
            <>
              <h3 className="f">建 立 贈 品 訂 單（自 己 要 送 人 的，不 收 錢）</h3>
              <p className="fine">
                建出來的是 <b>YG</b> 開頭的 0 元訂單，狀態直接是已付款，夥伴照常出貨、照常按已出貨。
                會佔掉該週的產能（不佔的話你會超賣），出貨通知寄到 hi@wensong.tw，
                你再自己傳簡訊給收禮的人。不開發票、不記 GA、不寄付款完成信、不進待聯絡清單。
              </p>
              <GiftOrderForm products={giftProducts} action={createGiftOrdersAction} badRows={giftbad || ""} />
            </>
          )}
          {/* 付款成功率速覽：站長訂的兩個門檻要有對應的數字才對照得起來 */}
          <h3 className="f">付 款 成 功 率</h3>
          <PayStats />
        </div>
      </details>

      {/* 危險區：一鍵清空全部訂單（＝所有商品統計歸零），要打字確認。規格說危險動作放最底 */}
      <div className="danger-zone">
        <h3 className="f">清 空 全 部 訂 單</h3>
        <p className="fine">
          刪除「全部」訂單紀錄，所有商品的 Excel 統計會一起歸零、庫存加回。通常用在正式開賣前，把測試單清乾淨重新開始。<b>此動作無法復原。</b>要清空請在框內輸入 <b>清空訂單</b> 再按按鈕。
        </p>
        <form action={clearAllOrders}>
          <input type="text" name="confirm" placeholder="輸入：清空訂單" />
          <ConfirmSubmit className="btn danger" message="確定要清空全部訂單？此動作無法復原。">清空全部訂單</ConfirmSubmit>
        </form>
      </div>
    </>
  );
}
