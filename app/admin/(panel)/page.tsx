import { lineEnabled, lineSentThisMonth, lineQuota, lineTestMode } from "@/lib/line";
import type { Metadata } from "next";
import Link from "next/link";
import db from "@/lib/db";
import { money } from "@/lib/format";
import { monthRange, taipeiNow } from "@/lib/month";
import { adminTodo } from "@/lib/admin-todo";
import { orderStats } from "@/lib/order-stats";

import { requireAdmin } from "@/lib/admin-guard";
import PageHead from "@/components/admin/PageHead";
import Ico from "@/components/admin/Ico";
export const metadata: Metadata = { title: "後台總覽" };

const WEEK = ["日", "一", "二", "三", "四", "五", "六"];

/* 今天（台北）：副標那一句「9 月 5 日（五）」。伺服器時區不保證是台北，所以自己換算 */
function todayLabel(): string {
  const t = taipeiNow();
  return `${t.getUTCFullYear()} 年 ${t.getUTCMonth() + 1} 月 ${t.getUTCDate()} 日（${WEEK[t.getUTCDay()]}）`;
}

export default async function AdminHome() {
  await requireAdmin();
  const todo = adminTodo();
  const os = orderStats();
  const mr = monthRange();
  const one = (sql: string, ...a: unknown[]) => (db.prepare(sql).get(...a) as { v: number }).v;

  /* ── 本月贊助實收（台北時區 1 號～月底）：單筆已付款 ＋ 定期定額當月扣款 ── */
  const onceSum = one("SELECT COALESCE(SUM(amount),0) v FROM sponsorships WHERE mode='once' AND status='paid' AND created_at>=? AND created_at<?", mr.start, mr.end);
  const chargeSum = one("SELECT COALESCE(SUM(amount),0) v FROM sponsor_charges WHERE status='paid' AND created_at>=? AND created_at<?", mr.start, mr.end);
  const onceCnt = one("SELECT COUNT(*) v FROM sponsorships WHERE mode='once' AND status='paid' AND created_at>=? AND created_at<?", mr.start, mr.end);
  const chargeCnt = one("SELECT COUNT(*) v FROM sponsor_charges WHERE status='paid' AND created_at>=? AND created_at<?", mr.start, mr.end);
  const monthReceived = onceSum + chargeSum;

  /*
   * 「該催的」＝提醒中心那張清單有幾列：14 天內、還沒付成功、也還沒被同一個人的後續訂單取代的
   * 商品訂單與贊助。條件跟 /admin/remind 的 loadRows 對齊，兩邊數字對得起來才有人信。
   */
  const remindOrders = one(`SELECT COUNT(*) v FROM orders
    WHERE created_at>=? AND COALESCE(gift,0)=0 AND (
      status='pending'
      OR (status='cancelled'
          AND (pay_note LIKE '%付款未完成%' OR pay_note LIKE '%付款失敗%' OR pay_note LIKE '%授權失敗%' OR pay_note LIKE '%請款失敗%' OR pay_note LIKE '%逾期未付款，系統自動取消%')
          AND pay_note NOT LIKE '%後續已由%')
    )`, new Date(Date.now() - 14 * 86400_000).toISOString());
  const remindSponsors = one("SELECT COUNT(*) v FROM sponsorships WHERE created_at>=? AND status IN ('pending','failed')", new Date(Date.now() - 14 * 86400_000).toISOString());

  /* 每月定額：不是本月的實收，是「目前還在扣的月加總」，收在頁尾的其他數字裡 */
  const activeSponsors = one("SELECT COUNT(*) v FROM sponsorships WHERE mode='monthly' AND status='active'");
  const monthlySum = one("SELECT COALESCE(SUM(amount),0) v FROM sponsorships WHERE mode='monthly' AND status='active'");

  /* 本月四格（ia.md §3）：營收、贊助金額、訂單數、贊助筆數。營收沿用訂單頁那套「實收」定義 */
  const tiles: { k: string; v: string }[] = [
    { k: "本月營收", v: money(os.thisMonth.revenue) },
    { k: "本月贊助", v: money(monthReceived) },
    { k: "訂單", v: `${os.thisMonth.orders} 筆` },
    { k: "贊助", v: `${onceCnt + chargeCnt} 筆` },
  ];

  /*
   * 今天要處理：每一列點了直接進「已經篩好的」列表，不是進去再自己篩。
   * 前五列固定在（數字是零也留著，站長要看得到「今天沒事」），
   * 可疑款項與逾期未出是例外狀況，沒有就不出現，出現就用朱紅。
   */
  const rows: { label: string; n: number; unit: string; href: string; tone?: "fail" }[] = [
    { label: "待付款", n: os.pending.n, unit: "筆", href: "/admin/orders?status=pending" },
    { label: "該催的", n: remindOrders + remindSponsors, unit: "筆", href: "/admin/remind" },
    { label: "該出貨", n: todo.toShip, unit: "筆", href: "/admin/orders?status=paid" },
    { label: "待聯絡", n: todo.contact, unit: "位", href: "/admin/contact" },
    ...(todo.suspect > 0 ? [{ label: "可疑款項", n: todo.suspect, unit: "筆", href: "/admin/contact", tone: "fail" as const }] : []),
    ...(todo.lateWeeks > 0 ? [{ label: "逾期未出", n: todo.lateWeeks, unit: "筆", href: "/partner", tone: "fail" as const }] : []),
  ];

  return (
    <>
      <PageHead title="總 覽" sub={todayLabel()} />

      {/* 區塊標題用 .ad-sect（一行字加一條細線）。這裡不用 <Card>：
          四格與待辦清單自己就是框，再包一層卡會變成雙框。 */}
      <div className="ad-sect"><h2>本 月</h2><div className="rule" /></div>
      <div className="ad-tiles">
        {tiles.map((t) => (
          <div className="ad-tile" key={t.k}>
            <div className="k">{t.k}</div>
            <div className="v sans">{t.v}</div>
          </div>
        ))}
      </div>

      <div className="ad-sect"><h2>今 天 要 處 理</h2><div className="rule" /></div>
      <div className="ad-todo">
        {rows.map((r) => (
          /* 零就不是待辦，灰掉；顏色走 data-tone，頁面不寫 inline color */
          <Link key={r.label} href={r.href} data-tone={r.tone || (r.n === 0 ? "muted" : "pending")}>
            <span className="t">{r.label}</span>
            <span className="n"><span className="sans">{r.n}</span> {r.unit}<Ico n="right" size={16} /></span>
          </Link>
        ))}
      </div>

      {/* 其他數字：不是今天要動手的，但站長偶爾要看。收合起來，免得跟上面四格搶注意力 */}
      <details className="ad-tools">
        <summary>其他數字（每月定額、LINE 用量）</summary>
        <div className="in">
          <p>
            每月定額：<b className="sans">{money(monthlySum)}</b>／月（{activeSponsors} 人訂閱中，預估）・
            本月贊助實收明細：單筆 {onceCnt} 筆、定額扣款 {chargeCnt} 筆・
            <Link href="/admin/sponsors">看贊助列表</Link>
          </p>
          {lineEnabled() && (
            <p>
              本月 LINE 已推 <b className="sans">{lineSentThisMonth()}</b>／{lineQuota()} 則
              （{lineTestMode() ? "測試模式中" : "到 75% 會寄信提醒"}）・
              <Link href="/admin/line">看 LINE 設定</Link>
            </p>
          )}
        </div>
      </details>
    </>
  );
}
