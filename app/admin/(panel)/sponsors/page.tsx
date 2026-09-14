import type { Metadata } from "next";
import Link from "next/link";
import ConfirmSubmit from "@/components/ConfirmSubmit";
import { emailTypoSuggestion } from "@/lib/email-typo";
import db from "@/lib/db";
import { money, fmtDateTime, SPONSOR_STATUS } from "@/lib/format";
import { updateSponsorship, deleteSponsorship, clearAllSponsorships, reissueSponsorInvoice, reconcileNow } from "@/app/admin/actions";
import RemindButtons from "@/components/admin/RemindButtons";
import { amegoConfig } from "@/lib/amego";
import { makeSourceLabel, sourceStats } from "@/lib/sponsor-source";

import { requireAdmin } from "@/lib/admin-guard";
import PageHead from "@/components/admin/PageHead";
import FilterBar from "@/components/admin/FilterBar";
import Empty from "@/components/admin/Empty";
import KV from "@/components/admin/KV";
import DangerZone from "@/components/admin/DangerZone";
import { relTime } from "@/components/admin/order-fmt";
import { sponsorTone, sponsorModeLabel, sponsorPayLabel, sponsorSourceText } from "@/components/admin/sponsor-fmt";
export const metadata: Metadata = { title: "贊助紀錄" };

type SponsorRow = {
  id: number; mode: string; amount: number; display_name: string; message: string; email: string; phone: string; pay_method: string; status: string; created_at: string; source: string; env: string;
  credit_hash: string; next_charge_at: string; last_charge_note: string; invoice_no: string;
  remind_at: string; remind_count: number; provider: string;
};

/* 補開發票的結果訊息 */
const INV_MSG: Record<string, string> = {
  done: "已送出補開發票。稍等幾秒重新整理，發票號碼就會出現；若仍是空的，狀態欄會顯示光貿回報的失敗原因。",
  already: "這筆已經有發票號碼了，沒有重複開立。",
  nocharge: "這筆每月定額還沒有任何一期扣款紀錄，無法開立。",
  notpaid: "這筆還不是已付款／扣款中，不能開發票。",
};

/* 補寄提醒信的結果訊息 */
const REMIND_MSG: Record<string, string> = {
  ok: "提醒信已寄出。信裡附了一鍵回到付款頁的連結，對方不用重填資料。",
  notpending: "這筆已經不是「待付款」了，沒有寄出提醒信。",
  noemail: "這筆沒有留 Email，無法寄提醒信。",
  nosmtp: "寄不出去：伺服器沒讀到 SMTP 設定，請確認 Zeabur 的 SMTP_HOST／SMTP_USER／SMTP_PASS。",
  fail: "寄送失敗，請稍後再試（詳細錯誤在伺服器日誌）。",
};

/* App 內建瀏覽器的短標籤，來源欄用 */
const ENV_LABEL: Record<string, string> = { fb: "FB內建", ig: "IG內建", line: "LINE內建", wv: "其他App內建" };

/*
 * 狀態膠囊（ia.md §4：列表頁四頁共用同一套）。
 *
 * 原本這頁只有「全部／每月定額／單筆」三顆，用的參數是 mode；
 * 站長每天真正要找的是「誰還沒付」，那要靠狀態。所以再加一個 status 參數，
 * 兩個參數各自獨立、互不覆蓋，舊書籤（?mode=monthly）照樣打得開。
 * 「失敗」對到 sponsorships 的 failed（刷卡沒過）；cancelled 是站長自己按的取消，
 * 那是正常結束不是失敗，不併進來，否則每一筆停掉的訂閱都會被當成問題。
 */
const CHIPS: { label: string; p: { mode?: string; status?: string } }[] = [
  { label: "全部", p: {} },
  { label: "待付款", p: { status: "pending" } },
  { label: "已付款", p: { status: "paid" } },
  { label: "每月定額", p: { mode: "monthly" } },
  { label: "單筆", p: { mode: "once" } },
  { label: "失敗", p: { status: "failed" } },
];

/* 成功收到的贊助款 = 首次贊助（非 pending/failed）+ 每月續扣成功 */
function statsBetween(fromIso: string, toIso: string): { amount: number; people: number } {
  const first = db
    .prepare(
      `SELECT COALESCE(SUM(amount),0) s, COUNT(DISTINCT email) n FROM sponsorships
       WHERE status NOT IN ('pending','failed') AND created_at>=? AND created_at<?`
    )
    .get(fromIso, toIso) as { s: number; n: number };
  const recur = db
    .prepare(
      `SELECT COALESCE(SUM(c.amount),0) s, COUNT(DISTINCT sp.email) n
       FROM sponsor_charges c JOIN sponsorships sp ON sp.id=c.sponsorship_id
       WHERE c.status='paid' AND c.created_at>=? AND c.created_at<?`
    )
    .get(fromIso, toIso) as { s: number; n: number };
  return { amount: first.s + recur.s, people: first.n + recur.n };
}

/*
 * 年度紀錄：一年一列，把三筆錢合在一起看。
 *
 * 「加購贊助」跟一般贊助完全是兩套資料：加購是結帳時順手加的，
 * 存在 orders.addon_amount，從來不會寫進 sponsorships，
 * 所以贊助名單與贊助 CSV 都看不到它。要看年度總額就得自己併。
 *
 * created_at 存的是 UTC（new Date().toISOString()），
 * 直接用 strftime 取年份會讓 1/1 早上 8 點前的紀錄被算到前一年，
 * 所以先 +8 小時轉成台灣時間再取年份。
 *
 * 人數不能把兩張表的 COUNT 直接相加（同一個人首年贊助、隔年續扣會被算兩次），
 * 所以用 UNION 之後再 COUNT DISTINCT email。
 */
type YearRow = { year: string; spAmount: number; spPeople: number; addonAmount: number; addonOrders: number };

function yearlyRecords(): YearRow[] {
  const TW = "datetime(created_at,'+8 hours')";
  const rows = new Map<string, YearRow>();
  const touch = (y: string) =>
    rows.get(y) ?? (rows.set(y, { year: y, spAmount: 0, spPeople: 0, addonAmount: 0, addonOrders: 0 }), rows.get(y)!);

  /* 首次贊助（含單次與每月的第一期） */
  for (const r of db
    .prepare(
      `SELECT strftime('%Y',${TW}) y, COALESCE(SUM(amount),0) s FROM sponsorships
        WHERE status NOT IN ('pending','failed') GROUP BY y`
    )
    .all() as { y: string; s: number }[]) {
    if (r.y) touch(r.y).spAmount += r.s;
  }
  /* 每月定額的後續每一期扣款 */
  for (const r of db
    .prepare(
      `SELECT strftime('%Y',datetime(c.created_at,'+8 hours')) y, COALESCE(SUM(c.amount),0) s
         FROM sponsor_charges c WHERE c.status='paid' GROUP BY y`
    )
    .all() as { y: string; s: number }[]) {
    if (r.y) touch(r.y).spAmount += r.s;
  }
  /* 贊助人數：兩張表併起來去重，避免同一個人被算兩次 */
  for (const r of db
    .prepare(
      `SELECT y, COUNT(DISTINCT email) n FROM (
         SELECT strftime('%Y',${TW}) y, lower(email) email FROM sponsorships
          WHERE status NOT IN ('pending','failed')
         UNION ALL
         SELECT strftime('%Y',datetime(c.created_at,'+8 hours')) y, lower(sp.email) email
           FROM sponsor_charges c JOIN sponsorships sp ON sp.id=c.sponsorship_id
          WHERE c.status='paid'
       ) GROUP BY y`
    )
    .all() as { y: string; n: number }[]) {
    if (r.y) touch(r.y).spPeople = r.n;
  }
  /* 結帳加購：只算真的收到錢的訂單，待付款與已取消不列入 */
  for (const r of db
    .prepare(
      `SELECT strftime('%Y',${TW}) y, COALESCE(SUM(addon_amount),0) s, COUNT(*) n FROM orders
        WHERE addon_amount>0 AND status IN ('paid','shipped','done') GROUP BY y`
    )
    .all() as { y: string; s: number; n: number }[]) {
    if (r.y) { const x = touch(r.y); x.addonAmount = r.s; x.addonOrders = r.n; }
  }
  return [...rows.values()].sort((a, b) => b.year.localeCompare(a.year));
}

/* 結帳加購的區間統計，欄位對齊 statsBetween 方便並排顯示 */
function addonBetween(fromIso: string, toIso: string): { amount: number; orders: number } {
  const r = db
    .prepare(
      `SELECT COALESCE(SUM(addon_amount),0) s, COUNT(*) n FROM orders
        WHERE addon_amount>0 AND status IN ('paid','shipped','done') AND created_at>=? AND created_at<?`
    )
    .get(fromIso, toIso) as { s: number; n: number };
  return { amount: r.s, orders: r.n };
}

export default async function AdminSponsors({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string; status?: string; open?: string; deleted?: string; cleared?: string; remind?: string; recon?: string; inv?: string; cancel?: string; q?: string }>;
}) {
  await requireAdmin();
  const { mode = "all", status = "all", open, deleted, cleared, remind, recon, inv, cancel, q } = await searchParams;
  /*
   * 搜尋：用信箱、名字或留言找人。
   * 沒有這個的話，收到一封退信卻不知道是誰、也翻不到那筆紀錄，
   * 等於看得到問題卻碰不到它。比對一律轉小寫，信箱大小寫不該影響找得到找不到。
   */
  const kw = String(q || "").trim().toLowerCase();
  /* 兩個篩選條件各自獨立地接到 WHERE 上，這樣「每月定額 + 待付款」也組得出來 */
  const cond: string[] = [];
  const args: string[] = [];
  if (mode !== "all") { cond.push("mode=?"); args.push(mode); }
  if (status !== "all") { cond.push("status=?"); args.push(status); }
  const list = (
    db
      .prepare(`SELECT * FROM sponsorships${cond.length ? ` WHERE ${cond.join(" AND ")}` : ""} ORDER BY id DESC`)
      .all(...args) as SponsorRow[]
  ).filter(
    (s) =>
      !kw ||
      [s.email, s.phone, s.display_name, s.message]
        .some((v) => String(v || "").toLowerCase().includes(kw))
  );

  /*
   * 這筆贊助用過的金流單號（sponsor_trade_nos）。
   * 只有超過一組才顯示：代表這個人換過付款方式或重試過，
   * 而被換掉的那組虛擬帳號在綠界那邊還收得到錢。
   * 站長對帳時看到入帳單號跟後台記的不一樣，答案就在這一行。
   * 罕見的診斷資料，只在展開那一筆時出現，不占列表版面。
   */
  const tradeNos = new Map<number, string[]>();
  for (const r of db
    .prepare("SELECT sponsorship_id, trade_no FROM sponsor_trade_nos ORDER BY id DESC")
    .all() as { sponsorship_id: number; trade_no: string }[]) {
    if (!tradeNos.has(r.sponsorship_id)) tradeNos.set(r.sponsorship_id, []);
    tradeNos.get(r.sponsorship_id)!.push(r.trade_no);
  }

  /* 來源欄顯示用（與總覽共用 lib/sponsor-source） */
  const sourceLabel = makeSourceLabel();
  /* 贊助來源統計：原本掛在總覽，改版後總覽只留「本月」與「今天要處理」，
     這份低頻的統計搬到它自己的資料所在頁（ia.md §3），收合在頁尾 */
  const srcStats = sourceStats();

  /* ── 頁尾工具區的數字（ia.md §4：統計卡從列表頁移除，本月贊助已經在總覽） ── */
  const now = new Date();
  const thisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const last = statsBetween(lastMonth.toISOString(), thisMonth.toISOString());
  const cur = statsBetween(thisMonth.toISOString(), nextMonth.toISOString());
  const all = statsBetween("1970-01-01", "9999-12-31");
  /* 加購支持：跟贊助分開算，因為它不在 sponsorships 裡 */
  const addonLast = addonBetween(lastMonth.toISOString(), thisMonth.toISOString());
  const addonCur = addonBetween(thisMonth.toISOString(), nextMonth.toISOString());
  const addonAll = addonBetween("1970-01-01", "9999-12-31");
  const years = yearlyRecords();
  /* 每月定額的發票號碼是記在「該期扣款」上（sponsor_charges），不是記在訂閱本身。
     這裡撈每筆訂閱最新一期的發票，否則畫面會誤以為沒開過而一直顯示「補開發票」。 */
  const lastCharge = new Map<number, { invoice_no: string; note: string }>();
  for (const c of db
    .prepare(
      `SELECT sponsorship_id, invoice_no, note FROM sponsor_charges
       WHERE id IN (SELECT MAX(id) FROM sponsor_charges GROUP BY sponsorship_id)`
    )
    .all() as { sponsorship_id: number; invoice_no: string; note: string }[]) {
    lastCharge.set(c.sponsorship_id, { invoice_no: c.invoice_no || "", note: c.note || "" });
  }

  const activeMonthly = db
    .prepare("SELECT COUNT(*) n, COALESCE(SUM(amount),0) s FROM sponsorships WHERE mode='monthly' AND status='active'")
    .get() as { n: number; s: number };
  /* 副標那一句要說得出這頁在管什麼，所以數字取全站的，不是篩過的 */
  const totalAll = (db.prepare("SELECT COUNT(*) n FROM sponsorships").get() as { n: number }).n;
  const pendingAll = (db.prepare("SELECT COUNT(*) n FROM sponsorships WHERE status='pending'").get() as { n: number }).n;

  /* 膠囊與展開列共用的網址組法：切狀態時搜尋字要留著，展開哪一筆也不該弄丟篩選 */
  const listHref = (extra: Record<string, string> = {}) => {
    const p = new URLSearchParams();
    if (mode !== "all") p.set("mode", mode);
    if (status !== "all") p.set("status", status);
    if (kw) p.set("q", String(q));
    for (const [k, v] of Object.entries(extra)) p.set(k, v);
    const s = p.toString();
    return s ? `/admin/sponsors?${s}` : "/admin/sponsors";
  };
  /* 「清除」要把搜尋字丟掉、篩選留著，所以不能走 chipHref（那支會把 q 帶回去） */
  const clearedHref = (() => {
    const u = new URLSearchParams();
    if (mode !== "all") u.set("mode", mode);
    if (status !== "all") u.set("status", status);
    const s = u.toString();
    return s ? `/admin/sponsors?${s}` : "/admin/sponsors";
  })();
  const chipHref = (p: { mode?: string; status?: string }) => {
    const u = new URLSearchParams();
    if (p.mode) u.set("mode", p.mode);
    if (p.status) u.set("status", p.status);
    if (kw) u.set("q", String(q));
    const s = u.toString();
    return s ? `/admin/sponsors?${s}` : "/admin/sponsors";
  };
  /* 展開中的那一筆。再點一次就收起來（回到沒有 open 的同一份網址） */
  const openId = Number(open) || 0;
  const rowHref = (id: number) => `${openId === id ? listHref() : listHref({ open: String(id) })}#s${id}`;

  /* 一筆贊助的發票號碼：每月定額看最新一期扣款，單筆看它自己 */
  const invoiceOf = (s: SponsorRow) => (s.mode === "monthly" ? lastCharge.get(s.id)?.invoice_no || "" : s.invoice_no || "");
  const canReissue = (s: SponsorRow) => !invoiceOf(s) && (s.status === "paid" || s.status === "active");

  return (
    <>
      <PageHead
        title="贊 助"
        sub={kw
          ? <>搜尋「{q}」找到 {list.length} 筆・<Link href={clearedHref}>清除</Link></>
          : <>{totalAll} 筆，{pendingAll} 筆待付款，每月定額 {activeMonthly.n} 人</>}
      />

      {/* 光貿發票環境：一眼看出金鑰有沒有被讀到 */}
      {amegoConfig().live ? (
        <p className="msg-ok">光貿電子發票：正式環境（統編 {amegoConfig().taxId}），付款成功會自動開立</p>
      ) : (
        <p className="msg-err">
          光貿電子發票目前是「測試環境」：Zeabur 沒讀到 AMEGO_TAX_ID／AMEGO_APP_KEY（名稱要完全一致），
          開出的發票不是真的也不會寄信。請確認環境變數後重新部署。
        </p>
      )}

      {remind && <p className={remind === "ok" ? "msg-ok" : "msg-err"}>{REMIND_MSG[remind] ?? "未知的結果。"}</p>}
      {/* 取消定期定額的結果：解約失敗一定要看得到，否則會誤以為停了，
          但金流商那邊的委託還在、客人繼續被扣款 */}
      {cancel === "ok" && <p className="msg-ok">已取消，並已向金流商解約，之後不會再扣款。</p>}
      {cancel && cancel !== "ok" && (
        <p className="msg-err">
          {cancel}
          <br />
          <b>狀態未變更。</b>這筆訂閱在金流商那邊仍然有效，還會繼續扣款。請直接到金流商後台解約，或稍後再試一次。
        </p>
      )}
      {inv && <p className={inv === "done" || inv === "already" ? "msg-ok" : "msg-err"}>{INV_MSG[inv] ?? "未知的結果。"}</p>}
      {recon && <p className="msg-ok">對帳完成：{recon}</p>}
      {deleted && <p className="msg-ok">已刪除該筆贊助紀錄。</p>}
      {cleared === "badconfirm" && <p className="msg-err">確認文字不符，未清空。請在框內輸入「清空贊助」四個字。</p>}
      {cleared && cleared !== "badconfirm" && <p className="msg-ok">已清空 {cleared} 筆贊助紀錄，統計歸零。</p>}

      <FilterBar
        chips={CHIPS.map((c) => ({
          label: c.label,
          href: chipHref(c.p),
          on: (c.p.status || "all") === status && (c.p.mode || "all") === mode,
        }))}
        search={{
          action: "/admin/sponsors",
          name: "q",
          defaultValue: q || "",
          placeholder: "搜信箱、名字、留言",
          hidden: {
            ...(mode === "all" ? {} : { mode }),
            ...(status === "all" ? {} : { status }),
          },
        }}
      />

      {/* 手機：一行一筆，點了就地展開（贊助沒有詳情頁，動作在展開的卡裡做）。
          桌機用下面那張表格，兩邊資料同一份 list。 */}
      {list.length === 0 ? (
        <Empty>沒有符合的贊助紀錄。換一顆狀態膠囊或清掉搜尋字看看。</Empty>
      ) : (
        <>
          <div className="ad-rows">
            {list.map((s) => {
              const on = openId === s.id;
              const invNo = invoiceOf(s);
              const chargeNote = s.mode === "monthly" ? lastCharge.get(s.id)?.note || "" : "";
              return (
                <div key={s.id} id={`s${s.id}`} className={`ad-rowwrap${on ? " on" : ""}`}>
                  <Link className="ad-row" href={rowHref(s.id)} data-tone={sponsorTone(s.status)} aria-expanded={on}>
                    <span className="ad-l">
                      <span className="ad-nm">
                        {s.display_name || "匿名"}
                        <span className="no">　{sponsorModeLabel(s.mode)}</span>
                      </span>
                      <span className="ad-tm sans">{relTime(s.created_at)}</span>
                    </span>
                    <span className="ad-r">
                      <span className="ad-amt sans">{money(s.amount)}{s.mode === "monthly" ? "／月" : ""}</span>
                      <span className="ad-st2"><i />{SPONSOR_STATUS[s.status] ?? s.status}</span>
                    </span>
                  </Link>
                  {on && (
                    <div className="ad-open">
                      <KV rows={[
                        { k: "狀態", v: <>{SPONSOR_STATUS[s.status] ?? s.status}{(s.status === "pending" || s.status === "failed") && s.last_charge_note ? <><br /><span className="tone-muted">{s.last_charge_note}</span></> : null}</> },
                        { k: "類別", v: sponsorModeLabel(s.mode) },
                        { k: "時間", v: <span className="sans">{fmtDateTime(s.created_at)}</span> },
                        { k: "付款", v: sponsorPayLabel(s.pay_method) },
                        { k: "發票", v: invNo ? <><span className="sans">{invNo}</span>{chargeNote ? `（${chargeNote}）` : ""}</> : "尚未開立" },
                        { k: "聯絡", v: <>{s.email || "—"}{s.phone ? <><br /><span className="sans">{s.phone}</span></> : null}{emailTypoSuggestion(s.email) ? <><br /><span className="tone-fail">信箱可能打錯，應該是 {emailTypoSuggestion(s.email)}</span></> : null}</> },
                        { k: "來源", v: <>{sponsorSourceText(s.source, sourceLabel)}{s.env ? `（${ENV_LABEL[s.env] || s.env}）` : ""}</> },
                        { k: "留言", v: <span className="ad-msg15">{s.message || "—"}</span> },
                        ...((tradeNos.get(s.id) || []).length > 1
                          ? [{
                              k: "金流單號",
                              v: (
                                <>
                                  {(tradeNos.get(s.id) || []).map((no) => (
                                    <span key={no} className="sans ad-block">{no}</span>
                                  ))}
                                  <span className="tone-muted">
                                    這個人換過付款方式或重試過，用過上面這幾組單號。舊的虛擬帳號不會失效，
                                    對帳看到不認得的單號請先比對這一份。
                                  </span>
                                </>
                              ),
                            }]
                          : []),
                      ]} />
                      <div className="acts">
                        {/* 待付款：一鍵補寄提醒信，信裡有直接回到付款頁的連結 */}
                        {s.status === "pending" && <RemindButtons kind="sponsor" id={s.id} back="sponsors" />}
                        {canReissue(s) && (
                          <form action={reissueSponsorInvoice}>
                            <input type="hidden" name="id" value={s.id} />
                            <button className="btn" type="submit">補開發票</button>
                          </form>
                        )}
                        {s.mode === "monthly" && s.status === "active" && (
                          <form action={updateSponsorship}>
                            <input type="hidden" name="id" value={s.id} />
                            <input type="hidden" name="status" value="cancelled" />
                            <ConfirmSubmit className="btn danger-link" message="確定要取消這筆每月定額？會向金流商解約，之後不再扣款，取消後無法恢復。">取消訂閱</ConfirmSubmit>
                          </form>
                        )}
                        {/* 這個人收過哪些信：連到發送頁最下面的寄件紀錄，用信箱篩 */}
                        {s.email && <a href={`/admin/mail?q=${encodeURIComponent(s.email)}#log`}>寄件紀錄</a>}
                        <form action={deleteSponsorship}>
                          <input type="hidden" name="id" value={s.id} />
                          <ConfirmSubmit className="btn danger-link" message="確定要刪除？此動作無法復原。">刪除這筆</ConfirmSubmit>
                        </form>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <p className="ad-listnote">點一行展開那一筆的細節與動作，再點一次收起來。要一次催很多人去「<Link href="/admin/remind">提醒</Link>」。</p>
        </>
      )}

      {/* 桌機表格；手機按「看表格」（ViewToggle）也會切到這張。
          八欄的分組是站長 2026-09-04 指定的，不要再併欄：
          時間／姓名＋電話／類別・狀態／狀態說明／金額＋付款方式＋發票／來源／留言／動作 */}
      <div className="ad-tablebox">
        <div className="adm-table-wrap">
          <table className="adm-table">
            <thead><tr><th>時間</th><th>姓名</th><th>類別・狀態</th><th>狀態說明</th><th>金額</th><th>來源</th><th>給主持人的話</th><th>動作</th></tr></thead>
            <tbody>
              {list.length === 0 && <tr><td colSpan={8} className="empty">還沒有紀錄</td></tr>}
              {list.map((s) => (
                <tr key={s.id}>
                  <td data-label="時間" className="sans">{fmtDateTime(s.created_at)}</td>
                  <td data-label="姓名" title={s.email}>
                    {s.display_name || "匿名"}
                    {s.phone && <span className="sub2 sans">{s.phone}</span>}
                    {emailTypoSuggestion(s.email) && (
                      <span className="sub2 tone-fail">{s.email} 寄不到，應該是 {emailTypoSuggestion(s.email)}</span>
                    )}
                  </td>
                  <td data-label="類別・狀態">
                    {sponsorModeLabel(s.mode)}
                    <span className="sub2">
                      <span className="ad-st" data-tone={sponsorTone(s.status)}><i />{SPONSOR_STATUS[s.status] ?? s.status}</span>
                      {s.mode === "monthly" && s.status === "active" && s.provider !== "ecpay" && !s.credit_hash && <span className="tone-fail ad-gapl">未綁卡</span>}
                    </span>
                  </td>
                  <td data-label="狀態說明" className="tone-muted">
                    {(s.status === "pending" || s.status === "failed") && s.last_charge_note ? s.last_charge_note : "—"}
                  </td>
                  <td className="sans" data-label="金額">
                    {money(s.amount)}{s.mode === "monthly" ? "／月" : ""}
                    <span className="sub2">{sponsorPayLabel(s.pay_method)}</span>
                    <span className="sub2">
                      {invoiceOf(s) ? (
                        <>
                          發票 <b>{invoiceOf(s)}</b>
                          {s.mode === "monthly" && lastCharge.get(s.id)?.note && <>（{lastCharge.get(s.id)?.note}）</>}
                        </>
                      ) : canReissue(s) ? (
                        <>
                          <form action={reissueSponsorInvoice} className="ad-inlineform">
                            <input type="hidden" name="id" value={s.id} />
                            <button className="link-btn" type="submit">補開發票</button>
                          </form>
                          {s.last_charge_note?.includes("發票開立失敗") && <span className="tone-fail ad-gapl">{s.last_charge_note}</span>}
                        </>
                      ) : (
                        <>發票 —</>
                      )}
                    </span>
                  </td>
                  <td className="sans" data-label="來源" title={s.source || ""}>
                    {sponsorSourceText(s.source, sourceLabel)}
                    {s.env ? <span className="tone-muted">（{ENV_LABEL[s.env] || s.env}）</span> : null}
                  </td>
                  {/* 一行 15 字，超過換行（站長指定） */}
                  <td data-label="給主持人的話" className="msg15 tone-muted">{s.message || "—"}</td>
                  <td className="acts" data-label="動作">
                    <div className="ad-actcol">
                      {s.status === "pending" && <RemindButtons kind="sponsor" id={s.id} back="sponsors" />}
                      {s.mode === "monthly" && s.status === "active" && (
                        <form action={updateSponsorship}>
                          <input type="hidden" name="id" value={s.id} />
                          <input type="hidden" name="status" value="cancelled" />
                          <ConfirmSubmit className="danger-link" message="確定要取消這筆每月定額？會向金流商解約，之後不再扣款，取消後無法恢復。">取消訂閱</ConfirmSubmit>
                        </form>
                      )}
                      {s.email && <a className="link-btn" href={`/admin/mail?q=${encodeURIComponent(s.email)}#log`}>寄件紀錄</a>}
                      <form action={deleteSponsorship}>
                        <input type="hidden" name="id" value={s.id} />
                        <ConfirmSubmit className="danger-link" message="確定要刪除？此動作無法復原。">刪除</ConfirmSubmit>
                      </form>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/*
        * 頁尾工具區（ia.md §4）：統計卡從列表頁移除，本月贊助已經在總覽那四格。
        * 剩下這些數字沒有別的家：上月與本月的贊助對加購、年度紀錄、目前定額總額，
        * 都是對帳或寫年報時才查一次的東西，跟「今天誰還沒付」不該擺在一起搶注意力。
        * 立即對帳與兩支匯出 CSV 也一起收進來，它們一週用不到一次。
        */}
      <details className="ad-tools">
        <summary>工具（統計、對帳、匯出 CSV）</summary>
        <div className="in">
          <p>
            目前每月定額：<b className="sans">{money(activeMonthly.s)}</b>／月（{activeMonthly.n} 人訂閱中，預估）
          </p>

          <h3 className="f">統 計</h3>
          {/*
            * 一張表收掉原本的十一張卡。
            *
            * 「贊助」與「加購」是兩套完全不同的資料：贊助在 sponsorships，
            * 加購是顧客結帳時順手加的，存在 orders.addon_amount，從不寫進 sponsorships，
            * 所以贊助名單與贊助 CSV 都看不到它。併成同一欄會讓人數失真，也對不上發票，
            * 因此併排列出、只在最右邊加總。
            */}
          <div className="adm-table-wrap">
            <table className="adm-table wide">
              <thead>
                <tr>
                  <th>期間</th><th>贊助金額</th><th>贊助人數</th><th>加購金額</th><th>加購筆數</th><th>合計</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="sans">上月</td>
                  <td className="sans">{money(last.amount)}</td>
                  <td className="sans">{last.people} 人</td>
                  <td className="sans">{money(addonLast.amount)}</td>
                  <td className="sans">{addonLast.orders} 筆</td>
                  <td className="sans"><b>{money(last.amount + addonLast.amount)}</b></td>
                </tr>
                <tr>
                  <td className="sans"><b>本月</b></td>
                  <td className="sans">{money(cur.amount)}</td>
                  <td className="sans">{cur.people} 人</td>
                  <td className="sans">{money(addonCur.amount)}</td>
                  <td className="sans">{addonCur.orders} 筆</td>
                  <td className="sans"><b>{money(cur.amount + addonCur.amount)}</b></td>
                </tr>
                {/* 年度紀錄：報稅、年報、寫年度回顧看這幾列就夠。依台灣時間分年 */}
                {years.map((y) => (
                  <tr key={y.year} className="yr">
                    <td className="sans"><b>{y.year} 年</b></td>
                    <td className="sans">{money(y.spAmount)}</td>
                    <td className="sans">{y.spPeople} 人</td>
                    <td className="sans">{money(y.addonAmount)}</td>
                    <td className="sans">{y.addonOrders} 筆</td>
                    <td className="sans"><b>{money(y.spAmount + y.addonAmount)}</b></td>
                  </tr>
                ))}
                <tr className="total">
                  <td className="sans"><b>總計</b></td>
                  <td className="sans"><b>{money(all.amount)}</b></td>
                  <td className="sans">—</td>
                  <td className="sans"><b>{money(addonAll.amount)}</b></td>
                  <td className="sans"><b>{addonAll.orders} 筆</b></td>
                  <td className="sans"><b>{money(all.amount + addonAll.amount)}</b></td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="fine">
            贊助金額含每月定額的自動續扣；年度列的人數已去除重複（同一個信箱同一年只算一人）。
            加購是顧客結帳時順手加的那一筆，記在訂單上不是獨立的贊助紀錄，只計入已收到款的訂單。
            總計那列的人數留空白，因為跨年度不能相加：同一個人可能連續好幾年都支持。
            要逐筆核對加購，到訂單頁匯出 CSV，裡面有「加購贊助」這一欄。
          </p>

          {/* 自動對帳：金流商不會通知「沒付款」，所以由我們主動去問 */}
          <h3 className="f">對 帳</h3>
          <p className="fine">
            系統每 15 分鐘會自動去問綠界與 LINE Pay，每一筆「待付款」到底付了沒。真的付了就自動補開發票、寄感謝信並通知你；
            確定沒付、且超過時限就標記為付款失敗；還沒逾時的則自動寄一封「未完成付款提醒信」（每筆只寄一次）。這顆按鈕只是讓你不用等。
          </p>
          <form action={reconcileNow}>
            <button className="btn sm" type="submit">立即對帳一次</button>
          </form>

          <h3 className="f">匯 出 Excel</h3>
          <div className="adm-actions">
            <a className="btn sm" href="/api/admin/sponsors-csv">匯出定額名單（進行中的每月贊助者）</a>
            <a className="btn sm" href="/api/admin/sponsors-csv?scope=all">匯出全部紀錄（含留言）</a>
          </div>
        </div>
      </details>

      {/* 贊助來源統計（2026-09-05 從總覽搬過來）：哪一頁帶來的贊助。
          2026-08 起才記錄，舊資料沒有來源，所以沒資料時整段不出現。 */}
      {srcStats.length > 0 && (
        <details className="ad-tools">
          <summary>贊助來源統計（哪一頁帶來的贊助）</summary>
          <div className="in">
            <div className="adm-table-wrap">
              <table className="adm-table wide">
                <thead><tr><th>來源頁</th><th>筆數</th><th>金額</th></tr></thead>
                <tbody>
                  {srcStats.map((r) => (
                    <tr key={r.source}>
                      <td title={r.source}>{sourceLabel(r.source)}</td>
                      <td className="sans">{r.cnt}</td>
                      <td className="sans">{money(r.sum)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="fine">只計成功收到的贊助；來源自 2026-08-09 起記錄，之前的贊助沒有來源資料。</p>
          </div>
        </details>
      )}

      {/* 危險區：一鍵清空全部贊助紀錄，要打字確認。規格說危險動作放最底 */}
      <DangerZone
        title="清 空 全 部 贊 助 紀 錄"
        warn={
          <>
            刪除「全部」贊助紀錄（含每月續扣紀錄），上方統計會一起歸零。通常用在正式上線前把測試資料清乾淨。<b>此動作無法復原</b>，且<b>不會</b>去 Portaly 取消進行中的訂閱；若已有真實訂閱，請先按該筆的「取消訂閱」再清空。要清空請在框內輸入 <b>清空贊助</b> 再按按鈕。
          </>
        }
      >
        <form action={clearAllSponsorships}>
          <input type="text" name="confirm" placeholder="輸入：清空贊助" />
          <ConfirmSubmit className="btn danger" message="確定要清空全部贊助紀錄？此動作無法復原。">清空全部贊助紀錄</ConfirmSubmit>
        </form>
      </DangerZone>
    </>
  );
}
