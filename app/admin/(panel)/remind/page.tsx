import type { Metadata } from "next";
import Link from "next/link";
import db from "@/lib/db";
import { money } from "@/lib/format";
import { requireAdmin } from "@/lib/admin-guard";
import AdminTabs from "@/components/AdminTabs";
import Check from "@/components/admin/Check";
import ConfirmSubmit from "@/components/ConfirmSubmit";
import {
  loadOrderTarget, loadSponsorTarget, nextRemindAt, failAt, channelsOf, supersededBy, notifyLogFor,
  notifyPaused, linksFor, type Target,
} from "@/lib/remind";
import { shortClickSummary } from "@/lib/short-link";
import { lineSentThisMonth, lineQuota } from "@/lib/line";
import { SUPERSEDED_MARK } from "@/lib/order-superseded";
import { remindCustom, toggleRemindStop, toggleContacted } from "@/app/admin/remind-actions";
import RemindButtons from "@/components/admin/RemindButtons";
import PageHead from "@/components/admin/PageHead";
import FilterBar from "@/components/admin/FilterBar";
import Empty from "@/components/admin/Empty";
import { remindTone } from "@/components/admin/sponsor-fmt";

export const metadata: Metadata = { title: "提醒中心" };
export const dynamic = "force-dynamic";

/*
 * 提醒中心（docs/notify-spec.md 第六章）。
 * 最近 14 天內所有待付款與付款失敗的商品訂單＋贊助，一筆一列：
 * 提醒過幾次、下一次自動什麼時候、三個管道通不通、同一人有沒有後來付成功。
 *
 * 2026-09-06 改版第四批：原本是一張十欄的表，402 寬要橫向捲兩次才看得到動作鈕，
 * 而催款正是站長走路時在做的事。改成分段的清單：待催（訂單）、待催（贊助）、
 * 已停止提醒、最近寄出，每段一個框；三顆管道鈕在手機是列底下的三等分格子。
 * 表單、欄位名、server action 一個都沒有換。
 */

/* 已取消的訂單裡，哪些是「付款失敗」而不是站長手動取消或被後續訂單取代（與 reconcile.mailFailedOrders 同一把尺） */
const FAIL_RE = /付款未完成|付款失敗|授權失敗|LINE Pay 請款失敗|逾期未付款，系統自動取消/;

type Row = {
  t: Target;
  remind_count: number;
  remind_at: string;
  contacted_at: string;
  failed: boolean;
};

type Filter = "all" | "order" | "sponsor" | "pending" | "failed";
const FILTERS: [Filter, string][] = [["all", "全部"], ["order", "商品"], ["sponsor", "贊助"], ["pending", "待付款"], ["failed", "已失敗"]];

const EVENT_LABEL: Record<string, string> = {
  remind1: "提醒第 1 次", remind2: "提醒第 2 次", remind3: "提醒第 3 次（最後）", failed: "付款失敗通知",
  charge_fail: "扣款失敗", charge_pause: "每月支持已暫停", manual: "手動", atm: "取號",
};
const CHANNEL_LABEL: Record<string, string> = { mail: "Email", line: "LINE", sms: "簡訊" };
const STATUS_LABEL: Record<string, string> = { sent: "已送", failed: "失敗", skipped: "略過", dry: "本來會寄", deferred: "延到早上" };
/* 靛藍已從後台拿掉（admin-ui-spec 第二節），dry 用灰不用 blue */
const STATUS_BADGE: Record<string, string> = { sent: "green", failed: "red", skipped: "grey", dry: "grey", deferred: "gold" };

function fmt(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("zh-TW", { timeZone: "Asia/Taipei", hour12: false, month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function loadRows(): Row[] {
  const since = new Date(Date.now() - 14 * 86400_000).toISOString();
  const rows: Row[] = [];
  const orders = db
    .prepare(
      `SELECT id,status,COALESCE(pay_note,'') pay_note,COALESCE(remind_count,0) remind_count,COALESCE(remind_at,'') remind_at,COALESCE(contacted_at,'') contacted_at
       FROM orders WHERE created_at>=? AND COALESCE(gift,0)=0 AND status IN ('pending','cancelled') ORDER BY id DESC`
    )
    .all(since) as { id: number; status: string; pay_note: string; remind_count: number; remind_at: string; contacted_at: string }[];
  for (const o of orders) {
    const failed = o.status === "cancelled";
    if (failed && (!FAIL_RE.test(o.pay_note) || o.pay_note.includes(SUPERSEDED_MARK))) continue;
    const t = loadOrderTarget(o.id);
    if (t) rows.push({ t, remind_count: o.remind_count, remind_at: o.remind_at, contacted_at: o.contacted_at, failed });
  }
  const sps = db
    .prepare(
      `SELECT id,status,COALESCE(remind_count,0) remind_count,COALESCE(remind_at,'') remind_at,COALESCE(contacted_at,'') contacted_at
       FROM sponsorships WHERE created_at>=? AND status IN ('pending','failed') ORDER BY id DESC`
    )
    .all(since) as { id: number; status: string; remind_count: number; remind_at: string; contacted_at: string }[];
  for (const s of sps) {
    const t = loadSponsorTarget(s.id);
    if (t) rows.push({ t, remind_count: s.remind_count, remind_at: s.remind_at, contacted_at: s.contacted_at, failed: s.status === "failed" });
  }
  rows.sort((a, b) => (a.t.created_at < b.t.created_at ? 1 : a.t.created_at > b.t.created_at ? -1 : 0));
  return rows;
}

/*
 * 一筆待催的人長什麼樣：左邊誰欠多少、右邊下一次什麼時候，
 * 三顆管道鈕在手機是列底下的三等分格子（44px），桌機挪到右邊。
 * 兩個可逆的開關（停止提醒／已聯絡）跟管道鈕分開一列，免得手指按錯。
 */
function RemindRow({ r, f }: { r: Row; f: Filter }) {
  const { t } = r;
  const ch = channelsOf(t);
  const next = nextRemindAt(t);
  const fail = failAt(t);
  const by = supersededBy(t);
  const stopped = Boolean(t.remind_stop);
  const contacted = Boolean(r.contacted_at);
  const logs = notifyLogFor(t.kind, t.id);
  /* 贊助沒有詳情頁，就用信箱搜到贊助列表那一筆 */
  const link = t.kind === "order" ? `/admin/orders/${t.id}` : `/admin/sponsors?q=${encodeURIComponent(t.email)}`;
  const lamp = (label: string, x: { ok: boolean; why: string }) => (
    <span className={`badge ${x.ok ? "green" : "grey"}`} title={x.ok ? `${label} 走得通` : x.why}>
      {label}{x.ok ? "" : " ✕"}
    </span>
  );
  const nextWord = next ? `下一次 ${fmt(next)}` : stopped ? "已停止自動提醒" : !r.failed && t.remind_seq >= 3 ? "三次寄完" : "沒有下一次";
  /*
   * 寄出去的催款連結被點過幾次（站內短網址，lib/short-link.ts）。
   * 三個管道合計：這裡要回答的是「他到底有沒有看到」，不是「哪個管道贏了」。
   * 還沒發過短網址的舊資料回空字串，那一行就不出現。
   */
  const clicks = shortClickSummary("催款連結", linksFor(t).cont);

  return (
    <div className="ad-rrow" data-tone={remindTone({ failed: r.failed, stopped })}>
      <div className="top">
        <span className="ad-l">
          <span className="ad-nm">
            <Link href={link}>{t.name || "（沒有留名字）"}</Link>
            <span className="no sans">　{t.no}</span>
          </span>
          <span className="ad-tm sans">
            {t.pay_method || t.provider || "—"}・已提醒 {r.remind_count} 次
            {r.remind_at ? `（最近 ${fmt(r.remind_at)}）` : ""}
            {fail ? `・判失敗 ${fmt(fail)}` : ""}
          </span>
          {clicks && <span className="ad-tm sans">{clicks}</span>}
          <span className="tags">
            <span className={`badge ${r.failed ? "red" : "grey"}`}>{r.failed ? "付款失敗" : "待付款"}</span>
            {lamp("信", ch.mail)}
            {lamp("LINE", ch.line)}
            {lamp("簡訊", ch.sms)}
            {stopped && <span className="badge red">已停止自動提醒</span>}
            {contacted && <span className="badge green">已聯絡</span>}
            {/* 同一個人後來已經買成功了，再催他會以為自己沒買成功 */}
            {by && <span className="badge red" title={`同一人後來已由 ${by} 付款成功`}>同一人已付款 {by}</span>}
          </span>
        </span>
        <span className="ad-r">
          <span className="ad-amt sans">{money(t.total)}</span>
          <span className="ad-st2"><i />{nextWord}</span>
        </span>
      </div>

      <div className="acts">
        <RemindButtons kind={t.kind} id={t.id} back="remind" f={f} />
      </div>

      <div className="more">
        <div className="switches">
          <form action={toggleRemindStop}>
            <input type="hidden" name="id" value={t.id} />
            <input type="hidden" name="kind" value={t.kind} />
            <input type="hidden" name="f" value={f} />
            {stopped ? (
              <button className="link-btn" type="submit">恢復自動提醒</button>
            ) : (
              <ConfirmSubmit className="danger-link" message="停止後系統不會再自動提醒這一筆，只剩手動。確定？">停止自動提醒</ConfirmSubmit>
            )}
          </form>
          <form action={toggleContacted}>
            <input type="hidden" name="id" value={t.id} />
            <input type="hidden" name="kind" value={t.kind} />
            <input type="hidden" name="f" value={f} />
            <button className="link-btn" type="submit">{contacted ? "還原成未聯絡" : "標記已聯絡"}</button>
          </form>
        </div>

        {/* 要自己挑管道、改主旨或內文時才展開。九成的情況上面三顆鈕就夠了 */}
        <details>
          <summary>選管道與內容</summary>
          <form action={remindCustom} className="adm-form">
            <input type="hidden" name="id" value={t.id} />
            <input type="hidden" name="kind" value={t.kind} />
            <input type="hidden" name="f" value={f} />
            <div className="adm-2col">
              <div className="field">
                <label>要寄哪一則</label>
                <select name="event" defaultValue={r.failed ? "failed" : `remind${Math.min(3, t.remind_seq + 1)}`}>
                  <option value="remind1">提醒第 1 次</option>
                  <option value="remind2">提醒第 2 次</option>
                  <option value="remind3">提醒第 3 次（最後一次）</option>
                  <option value="failed">付款失敗通知（換個方式再試）</option>
                </select>
              </div>
              <div className="field">
                <label>用哪些管道</label>
                <div className="chk-list">
                  <Check name="ch_mail" label="Email" hint={ch.mail.ok ? undefined : ch.mail.why} defaultChecked={ch.mail.ok} disabled={!ch.mail.ok} />
                  <Check name="ch_line" label="LINE" hint={ch.line.ok ? undefined : ch.line.why} defaultChecked={ch.line.ok} disabled={!ch.line.ok} />
                  <Check name="ch_sms" label="簡訊" hint={ch.sms.ok ? "每則要錢" : ch.sms.why} defaultChecked={ch.sms.ok && !ch.line.ok} disabled={!ch.sms.ok} />
                </div>
              </div>
            </div>
            <div className="adm-2col">
              <div className="field">
                <label>主旨（選填，只有信會用到）</label>
                <input type="text" name="subject" placeholder="留空用後台「通知文案」的預設" />
              </div>
              <div className="field">
                <label>內文（選填，三個管道共用）</label>
                <textarea name="body" className="ta-s" placeholder="留空用預設。付款連結會自動接在後面" />
              </div>
            </div>
            <div className="adm-actions">
              <button className="btn sm" type="submit">照上面設定發送</button>
            </div>
          </form>
        </details>

        {/* 這一筆寄過哪些通知。收起來是因為它是「事後查」，不是「現在要做」 */}
        <details>
          <summary>紀錄{logs.length > 0 ? `（${logs.length} 則）` : ""}</summary>
          {logs.length === 0 ? (
            <p className="fine">還沒寄過任何通知。</p>
          ) : (
            <ul className="loglist">
              {logs.map((l) => (
                <li key={l.id}>
                  <span className="sans">{fmt(l.created_at)}</span>
                  　{EVENT_LABEL[l.event] || l.event}
                  　{CHANNEL_LABEL[l.channel] || l.channel}
                  　<span className={`badge ${STATUS_BADGE[l.status] || "grey"}`}>{STATUS_LABEL[l.status] || l.status}</span>
                  {l.detail && <>　{l.detail}</>}
                </li>
              ))}
            </ul>
          )}
        </details>
      </div>
    </div>
  );
}

export default async function AdminRemind({
  searchParams,
}: {
  searchParams: Promise<{ f?: string; ok?: string; err?: string }>;
}) {
  await requireAdmin();
  const sp = await searchParams;
  const f: Filter = (FILTERS.some(([k]) => k === sp.f) ? sp.f : "all") as Filter;
  const all = loadRows();
  const list = all.filter((r) =>
    f === "order" ? r.t.kind === "order" : f === "sponsor" ? r.t.kind === "sponsor" : f === "pending" ? !r.failed : f === "failed" ? r.failed : true
  );
  const paused = notifyPaused();
  const lineUsed = lineSentThisMonth();
  const quota = lineQuota();

  /* 四段（ia.md §4 的分段規則）：停掉的那些不該混在待催裡，看了會以為系統還在幫你催 */
  const stoppedRows = list.filter((r) => Boolean(r.t.remind_stop));
  const live = list.filter((r) => !r.t.remind_stop);
  const orderRows = live.filter((r) => r.t.kind === "order");
  const sponsorRows = live.filter((r) => r.t.kind === "sponsor");

  /*
   * 副標那一句：幾筆待催，以及系統下一次會自己動手的時間。
   * 時間取所有還在排程中的最早那一個；暫停中就不要報時間，那會是假的。
   */
  const upcoming = all.map((r) => nextRemindAt(r.t)).filter(Boolean).sort()[0] || "";
  const pendingN = all.filter((r) => !r.failed && !r.t.remind_stop).length;

  /* 最近寄出：跨所有人的最後十二則，用來確認「系統剛剛到底有沒有動」 */
  const recent = db
    .prepare("SELECT id,kind,ref_no,event,channel,status,detail,created_at FROM notify_log ORDER BY id DESC LIMIT 12")
    .all() as { id: number; kind: string; ref_no: string; event: string; channel: string; status: string; detail: string; created_at: string }[];

  return (
    <>
      <AdminTabs active="remind" tabs={[
        { key: "orders", label: "訂單", href: "/admin/orders" },
        { key: "remind", label: "提醒", href: "/admin/remind" },
        { key: "contact", label: "待聯絡", href: "/admin/contact" },
      ]} />
      <PageHead
        title="提 醒"
        sub={
          <>
            {pendingN} 筆待催，{all.filter((r) => r.failed).length} 筆已失敗
            {paused ? "・自動提醒暫停中，只剩手動" : upcoming ? `・下一次自動提醒 ${fmt(upcoming)}` : "・目前沒有排程中的自動提醒"}
          </>
        }
      />

      {/* 暫停與「只記錄不寄」的橫幅在後台版面（layout）每一頁都會出現，這裡不重複 */}
      {sp.ok && <p className="msg-ok">{sp.ok}</p>}
      {sp.err && <p className="msg-err">{sp.err}</p>}

      <FilterBar
        chips={FILTERS.map(([k, label]) => ({
          label,
          href: k === "all" ? "/admin/remind" : `/admin/remind?f=${k}`,
          on: f === k,
        }))}
        viewToggle={false}
      />

      <p className="fine">
        系統照下單後 10 分鐘、12 小時、24 小時自動提醒三次，48 小時判失敗；手動提醒也算一次，並從按下去那一刻重新計時。
        本月 LINE 已推 <b className="sans">{lineUsed}</b>／額度 <b className="sans">{quota}</b>
        {quota > 0 && lineUsed >= Math.ceil(quota * 0.75) && <span className="badge red">　快用完了，之後會自動改走簡訊</span>}
      </p>

      <div className="ad-sect"><h2>待 催（訂 單）</h2><div className="rule" /></div>
      {orderRows.length === 0 ? (
        <Empty>沒有要催的商品訂單。</Empty>
      ) : (
        <div className="ad-rlist">
          {orderRows.map((r) => <RemindRow key={`o${r.t.id}`} r={r} f={f} />)}
        </div>
      )}

      <div className="ad-sect"><h2>待 催（贊 助）</h2><div className="rule" /></div>
      {sponsorRows.length === 0 ? (
        <Empty>沒有要催的贊助。</Empty>
      ) : (
        <div className="ad-rlist">
          {sponsorRows.map((r) => <RemindRow key={`s${r.t.id}`} r={r} f={f} />)}
        </div>
      )}

      {/* 停掉的那些單獨一段：系統不會再動它們，站長只有想反悔時才會來看 */}
      {stoppedRows.length > 0 && (
        <>
          <div className="ad-sect"><h2>已 停 止 提 醒</h2><div className="rule" /></div>
          <div className="ad-rlist">
            {stoppedRows.map((r) => <RemindRow key={`x${r.t.kind}${r.t.id}`} r={r} f={f} />)}
          </div>
        </>
      )}

      {/* 最近寄出：跨所有人的一份流水帳。單筆的紀錄在每一列的「紀錄」裡，
          這一段回答的是另一個問題：系統剛剛到底有沒有在動 */}
      <div className="ad-sect"><h2>最 近 寄 出</h2><div className="rule" /></div>
      {recent.length === 0 ? (
        <Empty>還沒有寄出任何通知。</Empty>
      ) : (
        <div className="ad-rlist">
          {recent.map((l) => (
            <div className="ad-rrow" key={l.id}>
              <div className="top">
                <span className="ad-l">
                  <span className="ad-nm">
                    {l.kind === "order" ? "商品" : "贊助"}
                    <span className="no sans">　{l.ref_no}</span>
                  </span>
                  <span className="ad-tm sans">
                    {fmt(l.created_at)}・{EVENT_LABEL[l.event] || l.event}・{CHANNEL_LABEL[l.channel] || l.channel}
                    {l.detail ? `・${l.detail}` : ""}
                  </span>
                </span>
                <span className="ad-r">
                  <span className={`badge ${STATUS_BADGE[l.status] || "grey"}`}>{STATUS_LABEL[l.status] || l.status}</span>
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      <p className="fine">
        「標記已聯絡」只是做個記號，自動提醒照走；「停止自動提醒」之後系統不再寄，只剩這頁的手動按鈕。兩個都可以還原。
        第四次起的手動提醒會先問一次。訂單頁與訂單列表原本的提醒按鈕維持不變。
      </p>
    </>
  );
}
