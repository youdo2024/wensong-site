import type { Metadata } from "next";
import ConfirmSubmit from "@/components/ConfirmSubmit";
import { notFound } from "next/navigation";
import db, { json } from "@/lib/db";
import { money, fmtDateTimeDash, ORDER_STATUS } from "@/lib/format";
import { updateOrder, deleteOrder, updateOrderItemChoice, updateOrderContact, notifyOrderChannels, markOrderPaidByHand, saveOrderShipList, switchOrderPay, updateOrderItemQty } from "@/app/admin/actions";
import CopyField from "@/components/CopyField";
import { payUrlFor } from "@/lib/sms";
import { shortClickSummary } from "@/lib/short-link";
import { orderStatusUrl } from "@/lib/line";
import { retryPayOptions } from "@/lib/shop";
import { orderChannels, NOTIFY_KINDS } from "@/lib/notify-order";
import { mailLogFor, MAIL_KIND_LABEL, MAIL_STATUS_LABEL } from "@/lib/mail-log";
import { isMultiShip, shipListTotal, type ShipRecipient } from "@/lib/multi-ship";
import ShipListForm from "@/components/ShipListForm";
import Check from "@/components/admin/Check";
import { emailTypoSuggestion } from "@/lib/email-typo";

import { requireAdmin } from "@/lib/admin-guard";
import { zipDisplay } from "@/lib/zip-lookup";
import { multiShipQuote } from "@/lib/freight";
import { freightRates } from "@/lib/shop";
import { isCvsMethod } from "@/lib/cvs";

import PageHead from "@/components/admin/PageHead";
import StatusBar, { type StatusTone } from "@/components/admin/StatusBar";
import DetailTabs from "@/components/admin/DetailTabs";
import ActionRow, { type ActionItem } from "@/components/admin/ActionRow";
import Card from "@/components/admin/Card";
import KV from "@/components/admin/KV";
import DangerZone from "@/components/admin/DangerZone";
import Empty from "@/components/admin/Empty";

export const metadata: Metadata = { title: "訂單詳情" };

type OrderRow = {
  id: number; order_no: string; name: string; phone: string; email: string; address: string;
  pay_method: string; invoice_type: string; invoice_data: string; items: string;
  subtotal: number; shipping: number; total: number; status: string; created_at: string; ship_detail?: string;
  addon_amount: number; discount_code: string; discount_amount: number; invoice_no: string;
  pay_note: string; token: string;
  ship_method: string; ship_list: string; zip: string;
  /* 催款次數：狀態列那句「已催 n 次」用的，lib/remind.ts 每寄一次就加一 */
  remind_count: number;
};

/* 狀態決定語意色：待處理是琥珀、完成是綠、失敗與取消是朱紅，其餘灰。四個顏色，沒有第五個 */
function toneOf(status: string): StatusTone {
  if (status === "pending") return "pending";
  if (status === "paid" || status === "shipped" || status === "done") return "ok";
  if (status === "cancelled" || status === "refunded" || status === "failed") return "fail";
  return "muted";
}

/*
 * 狀態列那句「下一步」。
 * 只講資料裡真的有的事：帳號效期是從付款備註裡抓出來的，抓不到就不寫那半句，
 * 不要為了讓句子完整而編一個日期，站長會照著它跟客人講話。
 */
function nextStepOf(o: OrderRow): string {
  const isAtm = /(?:ATM 轉帳：|繳費帳號)/.test(o.pay_note || "");
  const due = /(\d{4}[/-]\d{2}[/-]\d{2})/.exec(o.pay_note || "")?.[1] || "";
  const chased = Number(o.remind_count || 0) > 0 ? `已催 ${o.remind_count} 次` : "還沒催過";
  if (o.status === "pending") {
    const head = isAtm && due ? `帳號 ${due} 到期，` : isAtm ? "等她匯款，" : "等她付款，";
    return `${head}${chased}。`;
  }
  if (o.status === "paid") return "等出貨。";
  if (o.status === "shipped") return "完成。";
  if (o.status === "failed") return "可重寄付款連結。";
  return "";
}

export default async function OrderDetail({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ saved?: string; nostock?: string; err?: string; shiplist?: string; notify?: string }>;
}) {
  await requireAdmin();
  const { id } = await params;
  const { saved, nostock, err, shiplist, notify } = await searchParams;
  const o = db.prepare("SELECT * FROM orders WHERE id=?").get(Number(id)) as OrderRow | undefined;
  if (!o) notFound();
  /* 這位客人三種通知管道走不走得通，「通知客人」那一區照這個畫 */
  const ch = orderChannels({ email: o.email, phone: o.phone || "" });
  const mails = mailLogFor({ email: o.email, refNo: o.order_no }, 10);
  const items = json<{ id: number; name: string; choice: string | null; price: number; qty: number }[]>(o.items, []);
  /* 多地址運費試算要知道溫層：任一品項是冷凍就用冷凍費率（較貴，寧可高估不低估） */
  const itemsAreCold = items.some((i) => {
    const r = db.prepare("SELECT temp_zone FROM products WHERE id=?").get(Number(i.id)) as { temp_zone?: string } | undefined;
    return r?.temp_zone === "cold";
  });
  const inv = json<Record<string, string>>(o.invoice_data, {});
  /* 多地址配送的收件名單。非多地址的訂單這裡就是空陣列，整塊 UI 不會出現 */
  const shipList = json<ShipRecipient[]>(o.ship_list || "[]", []);
  const shipTotal = shipListTotal(shipList);
  /* 拿來跟名單合計對帳：對不起來多半是名單漏填了某一位 */
  const itemTotalQty = items.reduce((n, it) => n + it.qty, 0);
  /* 各品項商品目前的選項清單與分週剩餘：改出貨週的下拉用 */
  const prodIds = [...new Set(items.map((i) => i.id).filter(Boolean))];
  const prodOpts = new Map<number, { choices: string[]; stocks: Record<string, number> }>();
  for (const pid of prodIds) {
    const p = db.prepare("SELECT option_choices,choice_stocks FROM products WHERE id=?").get(pid) as
      | { option_choices: string; choice_stocks: string }
      | undefined;
    if (p) prodOpts.set(pid, { choices: json<string[]>(p.option_choices, []), stocks: json<Record<string, number>>(p.choice_stocks, {}) });
  }
  const pays = retryPayOptions();
  const payUrl = (m?: string) => (o.token ? payUrlFor(o.order_no, o.token) + (m ? `&m=${encodeURIComponent(m)}` : "") : "");
  const otherPays = pays.filter((p) => p !== o.pay_method);
  /*
   * 這張單寄出去的連結被點過幾次（站內短網址，lib/short-link.ts）。
   * 三個管道合計，因為站長在這裡問的是「他到底有沒有看到」。
   * 還沒發過短網址就是空字串，那一行整個不出現，不要寫 0 次讓人以為他沒點。
   */
  const payClicks = o.token ? shortClickSummary("催款連結", payUrlFor(o.order_no, o.token)) : "";
  const statusClicks = o.token ? shortClickSummary("訂單狀態連結", orderStatusUrl(o.order_no, o.token)) : "";
  /* 先前建立過 LINE Pay 付款請求：那筆在 LINE 那端還是活的，顧客回頭完成也會付成功 */
  const linepayOpen = /LINEPAYREQ:/.test(o.pay_note || "");
  const canEditItems = o.status !== "cancelled";

  /* ── 動作一：通知客人。信、簡訊、LINE 三種管道的唯一入口（站長 2026-09-03） ── */
  const notifyPanel = (
    <div id="notify">
      <p className="fine">先看這位客人哪些管道走得通，勾好再按「發送」。</p>
      <KV
        rows={[
          { k: "Email", v: <><span className="sans">{o.email || "—"}</span>　{ch.mail.ok ? <b className="tone-ok">寄得到</b> : <b className="tone-fail">{ch.mail.why}</b>}</> },
          { k: "簡訊", v: <><span className="sans">{o.phone || "—"}</span>　{ch.sms.ok ? <b className="tone-ok">可以送</b> : <b className="tone-fail">{ch.sms.why}</b>}<span className="fine">　每則要錢</span></> },
          { k: "LINE", v: <>{ch.line.ok ? <b className="tone-ok">已綁定，可以推</b> : <b className="tone-fail">{ch.line.why}</b>}{ch.line.binding && <span className="sans fine">　{ch.line.binding.line_user_id}</span>}</> },
        ]}
      />
      {(payClicks || statusClicks) && (
        <p className="fine">
          {payClicks}
          {payClicks && statusClicks ? "・" : ""}
          {statusClicks}
        </p>
      )}
      <form action={notifyOrderChannels} className="adm-form ad-mt">
        <input type="hidden" name="id" value={o.id} />
        <div className="field">
          <label>要通知什麼</label>
          <select name="kind" defaultValue={o.status === "pending" && (o.pay_note || "").includes("繳費帳號") ? "atm" : o.status === "pending" ? "pending" : o.status === "shipped" ? "shipped" : "paid"}>
            {NOTIFY_KINDS.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}
          </select>
        </div>
        <div className="field">
          <label>用哪些管道（可複選）</label>
          <div className="chk-list">
            <Check name="ch_mail" label="Email" defaultChecked={ch.mail.ok} disabled={!ch.mail.ok} />
            <Check name="ch_line" label="LINE" defaultChecked={ch.line.ok} disabled={!ch.line.ok} />
            <Check name="ch_sms" label="簡訊" defaultChecked={ch.sms.ok && !ch.line.ok} disabled={!ch.sms.ok} />
          </div>
          <p className="fine">預設：Email 一定寄；有 LINE 就推 LINE，沒有才勾簡訊。要三個都發也可以。</p>
        </div>
        <details className="ad-mb">
          <summary>自訂內容（上面選「自訂內容」時才會用到）</summary>
          <div className="ad-mt">
            <div className="field"><label>主旨（只有信會用到）</label><input type="text" name="subject" placeholder={`關於你的訂單 ${o.order_no}`} /></div>
            <div className="field"><label>連結（選填，放最後一行）</label><input className="sans" type="text" name="url" placeholder="https://www.wensong.tw/..." /></div>
            <div className="field"><label>內文</label><textarea name="body" placeholder="開頭可以先寫對方的名字。簡訊會自動加署名，LINE 不加" /></div>
          </div>
        </details>
        <div className="adm-actions"><button className="btn fill" type="submit">發送</button></div>
      </form>
    </div>
  );

  /* ── 動作二：出貨處理（改狀態）。改成已出貨會自動寄信，所以要確認一次 ── */
  const shipPanel = (
    <form className="adm-form" action={updateOrder}>
      <input type="hidden" name="id" value={o.id} />
      <div className="field">
        <label>訂單狀態</label>
        <select name="status" defaultValue={o.status}>
          <option value="pending">待付款</option>
          <option value="paid">已付款</option>
          <option value="shipped">已出貨</option>
          <option value="done">已完成</option>
          <option value="cancelled">已取消（未收款，庫存自動回補）</option>
          <option value="refunded">已退款（已收款後退還，列入結算負項）</option>
        </select>
      </div>
      <ConfirmSubmit className="btn fill" message="確定更新訂單狀態？選了已取消會回補庫存、已退款會列入結算負項">更新訂單</ConfirmSubmit>
    </form>
  );

  /*
   * ── 動作三：改付款方式 ──
   * 顧客選錯付款方式不用重下單：同一張訂單、同一組連結，換個方式就好。
   * 庫存在建單時已經扣過，這裡不會再扣一次。
   */
  const payPanel = (
    <>
      <p className="fine">顧客選錯付款方式不用重下單：同一張訂單、同一組連結，換個方式就好。庫存在建單時已經扣過，這裡不會再扣一次。</p>
      {linepayOpen && (
        <p className="msg-err">這張單先前已建立過 LINE Pay 付款請求。顧客若回頭完成那筆 LINE Pay 也會付成功，換方式後留意別重複收款。</p>
      )}
      {pays.length === 0 ? (
        <p className="msg-err">目前沒有任何開放的付款方式，先到「網站設定」把付款方式打開。</p>
      ) : (
        <form className="adm-form" action={switchOrderPay}>
          <input type="hidden" name="id" value={o.id} />
          <div className="field">
            <label>付款方式</label>
            <select name="pay_method" defaultValue={pays.includes(o.pay_method) ? o.pay_method : pays[0]}>
              {pays.map((p) => (
                <option key={p} value={p}>{p}{p === o.pay_method ? "（目前）" : ""}</option>
              ))}
            </select>
          </div>
          {o.email && <Check name="mail" label={<>順便寄付款連結信到 <span className="sans">{o.email}</span></>} />}
          <div className="adm-actions">
            <button className="btn" type="submit">{o.token ? "換方式並更新連結" : "產生結帳連結"}</button>
          </div>
        </form>
      )}
    </>
  );

  /*
   * ── 動作四：改數量與改出貨週 ──
   * 兩件事都是「顧客來訊要調整」時做的，所以放在一起：
   * 改出貨週會把庫存從舊週搬到新週；改數量直接加減庫存（允許負數），金額不動，錢另外開連結請款。
   */
  const qtyPanel = (
    <>
      {items.map((i, idx) => {
        const opts = i.choice != null ? prodOpts.get(i.id) : undefined;
        const choiceList = opts ? [...new Set([i.choice || "", ...opts.choices])].filter(Boolean) : [];
        return (
          <div className="ad-itemedit" key={idx}>
            <b>{i.name}{i.choice ? `（${i.choice}）` : ""}　× {i.qty}</b>
            {choiceList.length > 1 && (
              <form action={updateOrderItemChoice} className="ad-inline">
                <input type="hidden" name="id" value={o.id} />
                <input type="hidden" name="item_idx" value={idx} />
                <select name="new_choice" defaultValue={i.choice || ""} className="sans" aria-label="出貨週">
                  {choiceList.map((c) => {
                    const left = Object.prototype.hasOwnProperty.call(opts!.stocks, c) ? opts!.stocks[c] : null;
                    return (
                      <option key={c} value={c}>
                        {c}{left !== null ? `（剩 ${left}${left <= 0 ? "・已滿" : ""}）` : ""}
                      </option>
                    );
                  })}
                </select>
                <button className="btn sm" type="submit">改出貨週</button>
              </form>
            )}
            <form action={updateOrderItemQty} className="ad-inline">
              <input type="hidden" name="id" value={o.id} />
              <input type="hidden" name="item_idx" value={idx} />
              <input className="sans ad-qty" type="number" name="new_qty" min={1} max={999} defaultValue={i.qty} aria-label="數量" />
              <input type="text" name="qty_note" className="grow" placeholder="備註（例如：多 2 盒另以付款連結請款）" />
              <ConfirmSubmit className="btn sm" message="改數量會直接加減庫存（可以變成負數），金額不會自動變。確定？">改數量</ConfirmSubmit>
            </form>
          </div>
        );
      })}
      <p className="fine">改出貨週會把庫存從舊週搬到新週，夥伴工作台立即跟上。改數量直接加減庫存，金額不會動，要收的錢另外開付款連結。</p>
    </>
  );

  const actions: ActionItem[] = [
    { key: "notify", label: "通知客人", icon: "mail", anchor: "notify", meta: [ch.mail.ok && "Email", ch.line.ok && "LINE", ch.sms.ok && "簡訊"].filter(Boolean).join("、") || "都走不通", panel: notifyPanel },
    { key: "ship", label: "出貨", icon: "box", meta: ORDER_STATUS[o.status] ?? o.status, panel: shipPanel },
    ...(o.status === "pending" ? [{ key: "pay", label: "改付款", icon: "card" as const, meta: `目前 ${o.pay_method}`, panel: payPanel }] : []),
    ...(canEditItems ? [{ key: "qty", label: "改數量", icon: "lines" as const, meta: `${itemTotalQty} 件`, panel: qtyPanel }] : []),
  ];

  const act = (
    <>
      {/*
        * 錢到了但系統沒入帳的救援口。
        *
        * 只在待付款與已取消時出現：已經是已付款的按了也沒意義。
        * 收合起來是刻意的，這是例外處理不是日常操作，
        * 而且按下去會開發票、寄信、扣庫存，不該擺在隨手會碰到的位置。
        */}
      {(o.status === "pending" || o.status === "cancelled") && (
        <details className="box ad-rescue">
          <summary className="sans">錢已經收到了，但這筆沒有自動入帳？</summary>
          <div className="in">
            <p className="fine">
              先到金流後台確認款項真的入帳了再按。按下去會做完整套入帳流程：
              開發票、寄確認信給顧客、進出貨清單。
              {o.status === "cancelled" && "這筆目前是已取消，補回來時庫存會重新扣除。"}
            </p>
            <form action={markOrderPaidByHand}>
              <input type="hidden" name="id" value={o.id} />
              <div className="field">
                <label>金流單號（選填，記下來日後才對得回去）</label>
                <input type="text" name="trade_no" className="sans" placeholder="綠界／LINE Pay 後台看到的交易編號" />
              </div>
              <div className="field">
                <label>請把訂單編號 <b className="sans">{o.order_no}</b> 打一次，確認你要標的是這一筆</label>
                <input type="text" name="confirm_no" className="sans" placeholder={o.order_no} required />
              </div>
              <button className="btn fill" type="submit">確認款項已到，補成已付款</button>
            </form>
          </div>
        </details>
      )}
      <ActionRow actions={actions} />
    </>
  );

  /* ── 資料分頁：收件、多地址名單、發票、明細、結帳連結 ── */
  const zip = zipDisplay(o.address, o.zip);
  const data = (
    <>
      <Card title="收 件" pad={false}>
        <KV
          rows={[
            { k: "姓名", v: o.name },
            { k: "電話", v: <span className="sans">{o.phone}</span> },
            {
              k: "Email",
              v: (
                <>
                  <span className="sans">{o.email}</span>
                  {/* 信箱網域打錯就收不到確認信與電子發票，而發票是付款當下就開出去的，事後改要作廢重開 */}
                  {emailTypoSuggestion(o.email) && (
                    <span className="tone-fail"> ／這個網域看起來打錯了，應該是 {emailTypoSuggestion(o.email)}</span>
                  )}
                </>
              ),
            },
            { k: "地址", v: o.address || "—" },
            /* 只放三碼。zipDisplay 的 text 是「郵遞區號＋地址」整串，那是給地址欄用的，放這裡會把地址印兩次 */
            ...(isCvsMethod(o.ship_method) ? [] : [{ k: "郵遞區號", v: o.zip ? `${o.zip}（手動指定）` : (zip.text.match(/^(\d{3})\s/)?.[1] || "—") + (zip.note ? `　${zip.note}` : "") }]),
            { k: "配送", v: o.ship_method || "—" },
          ]}
        />
        {/* 修改收在收合裡：一天看二十張單，只有偶爾一張要改，展開的欄位不該一直佔著畫面 */}
        <details className="ad-edit">
          <summary className="sans">修改收件資訊</summary>
          <form action={updateOrderContact} className="adm-form">
            <input type="hidden" name="id" value={o.id} />
            <div className="field full">
              <label>姓名</label>
              <input type="text" name="name" defaultValue={o.name} required />
            </div>
            <div className="field full">
              <label>電話</label>
              <input type="text" name="phone" defaultValue={o.phone} inputMode="numeric" required />
            </div>
            <div className="field full">
              <label>Email（確認信與電子發票寄到這裡）</label>
              <input type="email" name="email" defaultValue={o.email} required />
            </div>
            <div className="field full">
              <label>地址／取貨門市</label>
              <input type="text" name="address" defaultValue={o.address} />
            </div>
            {/* 郵遞區號：系統從地址即時推導（縣市＋區都比中才給，不猜）。
                這格只在系統推錯或推不出時才需要填，填了就以填的為準、永遠蓋過推導。
                超商取貨沒有郵遞區號這回事，不顯示。 */}
            {!isCvsMethod(o.ship_method) && (
              <div className="field full">
                <label>
                  郵遞區號
                  <em>
                    {o.zip
                      ? `＊手動指定中，出貨顯示 ${o.zip}`
                      : zip.note
                        ? `＊${zip.note.replace("⚠ ", "")}，需要的話在這裡補`
                        : `＊系統自動判別，出貨顯示「${zip.text.slice(0, 3)}」，不必填`}
                  </em>
                </label>
                <input type="text" name="zip" defaultValue={o.zip} inputMode="numeric" maxLength={3} placeholder="3 碼，留空＝自動判別" />
              </div>
            )}
            <div className="adm-actions">
              <button className="btn fill" type="submit">儲存收件資訊</button>
            </div>
          </form>
        </details>
      </Card>

      {/*
        * 多地址配送的收件名單。
        *
        * 顧客結帳時只選「寄到多個地址」，不填任何地址——企業訂購常常是
        * 對方還在跟各分公司要地址，卡在那裡他就結不了帳。名單改由站長在這裡補，
        * 補完會同步到出貨工作台，一位一列，可以逐一點出貨。
        * 出貨通知一律寄給主要訂購人（就是上面那個信箱），不寄給各收件人。
        */}
      {isMultiShip(o.ship_method) && (
        <Card title="多 地 址 收 件 名 單">
          {shiplist === "ok" && <p className="msg-ok">名單已儲存，出貨工作台同步更新了。</p>}
          {shiplist && shiplist !== "ok" && <p className="msg-err">{shiplist}</p>}
          <p className="fine">
            顧客結帳時只選了「寄到多個地址」，沒有填地址。
            在這裡把每一位填進來，儲存後會同步到出貨工作台，一位一列，可以逐一點出貨。
            出貨通知一律寄給主要訂購人（上面那個信箱），不會寄給各收件人。
          </p>
          {/* 運費試算：企業單的運費是站長跟客戶談的，系統不自動收，
              但要你自己按二十次計算機也太蠢。這裡只「算給你看」，
              規則照站長定的：無條件免第一位，其餘每位照費率收。 */}
          {shipList.length > 0 && (() => {
            const temp = itemsAreCold ? ("cold" as const) : ("ambient" as const);
            const q = multiShipQuote(shipList, temp, freightRates());
            return (
              <p className="callout">
                <b>運費試算</b>（{temp === "cold" ? "冷凍" : "常溫"}）：{shipList.length} 位收件人，
                宅配 {q.home} 位、店到店 {q.cvs} 位，首位免運（折抵 {money(q.freeOne)}）
                <br />
                <b className="tone-fail">建議運費 {money(q.total)}</b>
                　<span className="tone-muted">這只是算給你看的參考值，實際金額由你填進付款連結</span>
              </p>
            );
          })()}
          <ShipListForm
            orderId={o.id}
            itemTotalQty={itemTotalQty}
            action={saveOrderShipList}
            initial={shipList.map((r) => ({
              name: r.name || "",
              phone: r.phone || "",
              zip: r.zip || "",
              /* 舊資料沒有 shipMethod，一律當宅配（既有行為） */
              shipMethod: isCvsMethod(r.shipMethod) ? ("7-11店到店" as const) : ("宅配" as const),
              address: r.address || "",
              storeName: r.storeName || "",
              storeNo: r.storeNo || "",
              qty: String(r.qty ?? 1),
              shipped: Boolean(r.shipped),
              note: r.note || "",
            }))}
          />
          {shipTotal > 0 && (
            <p className="fine">
              目前名單合計 {shipTotal} 盒，已出貨 {shipList.filter((r) => r.shipped).length} / {shipList.length} 位。
            </p>
          )}
        </Card>
      )}

      <Card title="明 細" pad={false}>
        {items.map((i, idx) => (
          <div className="ad-line" key={idx}>
            <span className="grow">{i.name}{i.choice ? `（${i.choice}）` : ""} ×{i.qty}</span>
            <span className="sans">{money(i.price * i.qty)}</span>
          </div>
        ))}
        {o.discount_amount > 0 && (
          <div className="ad-line"><span className="grow">折扣（{o.discount_code}）</span><span className="sans">− {money(o.discount_amount)}</span></div>
        )}
        {o.addon_amount > 0 && (
          <div className="ad-line"><span className="grow tone-fail">額外贊助 ♥</span><span className="sans tone-fail">{money(o.addon_amount)}</span></div>
        )}
        <div className="ad-line">
          <span className="grow">
            運費
            {(() => {
              /* 多夥伴訂單的運費分組：結算對帳時要看得出這一單的運費各歸哪個出貨地 */
              try {
                const gs = JSON.parse(o.ship_detail || "[]") as { originName: string; temp: string; fee: number; free: boolean }[];
                if (gs.length > 1 || (gs.length === 1 && gs[0].originName))
                  return <small className="sub2">{gs.map((g) => `${g.originName || "整單"}${g.temp === "cold" ? "(低溫)" : ""} ${g.free ? "免運" : `$${g.fee}`}`).join("・")}</small>;
              } catch { /* 舊單沒有分組資料，照原樣顯示 */ }
              return null;
            })()}
          </span>
          <span className="sans">{money(o.shipping)}</span>
        </div>
        <div className="ad-line sum"><span className="grow">總金額</span><span className="sans">{money(o.total)}</span></div>
        <div className="ad-line small"><span className="grow tone-muted">要改數量或出貨週，到「動作」的改數量</span></div>
      </Card>

      <Card title="發 票" pad={false}>
        <KV
          rows={[
            {
              k: "開立",
              v: (
                <>
                  {o.invoice_type === "b2b"
                    ? `三聯式：${inv.company || "—"}（統編 ${inv.taxId || "—"}）`
                    : `二聯式：${inv.carrierType || "—"} ${inv.carrierNo || ""}`}
                  {/* TapPay 金流的發票由光貿開立，號碼記在訂單上（PayUni 的號碼在付款備註） */}
                  {o.invoice_no ? <>　<b className="sans tone-fail">{o.invoice_no}</b>（光貿）</> : null}
                </>
              ),
            },
          ]}
        />
      </Card>

      {o.status === "pending" && (
        <Card title="結 帳 連 結">
          {o.token ? (
            <>
              <p className="fine">目前連結（{o.pay_method}），複製貼給顧客即可：</p>
              <CopyField value={payUrl()} />
              {otherPays.length > 0 && (
                <details className="ad-mt">
                  <summary className="fine">其他付款方式的連結（不切換也能直接給）</summary>
                  {otherPays.map((p) => (
                    <div className="ad-mt" key={p}>
                      <p className="fine">{p}</p>
                      <CopyField value={payUrl(p)} />
                    </div>
                  ))}
                </details>
              )}
              <p className="fine">要換付款方式，到「動作」的改付款。</p>
            </>
          ) : (
            <p className="fine">這張舊單還沒有付款權杖。到「動作」的改付款按一次，就會補上並產生連結。</p>
          )}
        </Card>
      )}
    </>
  );

  /* ── 紀錄分頁：這位客人收過的信（信箱或訂單編號對得上），全站每封信都記在 mail_log ── */
  const log = (
    <Card title="寄 件 紀 錄" pad={false}>
      {mails.length === 0 ? (
        <Empty>還沒有寄過信給這位客人（2026-09-05 之前寄的沒有紀錄）。</Empty>
      ) : (
        mails.map((m) => (
          <div className="ad-line small" key={m.id}>
            <span className="t sans">{fmtDateTimeDash(m.created_at)}</span>
            <span className="grow">
              {MAIL_KIND_LABEL[m.kind]}　{m.subject}
              {m.detail ? <small className="sub2">{m.detail}</small> : null}
            </span>
            <span>
              <b className={m.status === "sent" ? "ok" : m.status === "failed" ? "bad" : "skip"}>{MAIL_STATUS_LABEL[m.status]}</b>
              {m.has_body ? <a className="link-btn ad-ml" href={`/admin/mail-log/${m.id}`} target="_blank" rel="noreferrer">看內容</a> : null}
            </span>
          </div>
        ))
      )}
      <div className="ad-line small">
        <a className="link-btn" href={`/admin/mail?q=${encodeURIComponent(o.email || o.order_no)}#log`}>
          看全部{mails.length >= 10 ? "（上面只列最近 10 封）" : ""}
        </a>
      </div>
    </Card>
  );

  const danger = (
    <DangerZone
      title="刪除訂單"
      warn="用於清除測試單。刪除後這筆訂單與它的統計都會消失，庫存會自動加回（已取消的單不加回）。此動作無法復原。"
    >
      <form action={deleteOrder}>
        <input type="hidden" name="id" value={o.id} />
        <ConfirmSubmit className="btn danger" message="確定要刪除此訂單？此動作無法復原。">刪除此訂單</ConfirmSubmit>
      </form>
    </DangerZone>
  );

  return (
    <>
      <PageHead
        back={{ href: "/admin/orders", label: "訂單列表" }}
        title={<>訂單 <span className="sans">{o.order_no}</span></>}
        sub={<>{o.name}・{fmtDateTimeDash(o.created_at)}</>}
      />

      {err && <p className="msg-err">{err}</p>}
      {saved === "contact" && <p className="msg-ok">收件資訊已更新。改了信箱的話記得按「重寄」，對方才收得到。</p>}
      {saved === "qty" && <p className="msg-ok">數量已更新，庫存已同步加減；備註寫在付款備註裡。金額沒有動，要收的錢另外開付款連結。</p>}
      {notify && <p className="msg-ok">已發送：{notify}</p>}
      {saved === "manualpaid" && (
        <p className="msg-ok">
          已補成已付款，發票、確認信與出貨清單都跑過一次了，跟正常付款的訂單沒有差別。
          這筆如果原本是已取消，庫存已經重新扣回去，記得確認貨做得出來。
        </p>
      )}
      {saved === "paylink" && <p className="msg-ok">付款方式已更新，到「資料」的結帳連結就能複製給顧客。庫存沒有變動。</p>}
      {saved === "paylinkmail" && <p className="msg-ok">付款方式已更新，付款連結信已寄給顧客。庫存沒有變動。</p>}
      {saved && !["contact", "manualpaid", "paylink", "paylinkmail", "qty"].includes(saved) && (
        <p className="msg-ok">已更新。改成「已出貨」時會自動寄通知信給買家。</p>
      )}
      {/* 出貨週搬不過去時要說清楚是哪一週、還剩幾個，不要讓庫存被扣成負數 */}
      {nostock && (
        <p className="msg-err">
          那一週的位子不夠，這筆沒有更動：{nostock}。
          要搬過去的話，先到「商品」把該週的庫存加大，或改搬到別週。
        </p>
      )}

      <StatusBar
        word={ORDER_STATUS[o.status] ?? o.status}
        tone={toneOf(o.status)}
        amount={<span className="sans">{money(o.total)}</span>}
        meta={<>{o.pay_method}　·　{fmtDateTimeDash(o.created_at)} 下單</>}
        next={nextStepOf(o) || undefined}
      />

      <DetailTabs act={act} data={data} log={log} danger={danger} />
    </>
  );
}
