import type { Metadata } from "next";
import Link from "next/link";
import ConfirmSubmit from "@/components/ConfirmSubmit";
import db from "@/lib/db";
import { money } from "@/lib/format";
import { discountLabel, type Discount } from "@/lib/shop";
import { saveDiscount, toggleDiscount, deleteDiscount } from "@/app/admin/actions";

import { requireAdmin } from "@/lib/admin-guard";
import AdminTabs from "@/components/AdminTabs";
import PageHead from "@/components/admin/PageHead";
import Empty from "@/components/admin/Empty";
export const metadata: Metadata = { title: "折扣碼管理" };

type CodeRow = Discount & { name: string; active: number; expires_at: string; created_at: string };

/*
 * 折扣碼（2026-09-06 改版第六批）。
 *
 * 新增表單原本永遠攤在清單上面，佔掉手機的第一屏；現在收進頁首那顆「新增折扣碼」
 * 打開的收合區（?new=1，開合狀態放網址上，格式錯了退回來表單還開著）。
 * 手機一行一碼：碼與名稱、內容與到期日，右邊用了幾次與一顆啟用開關。
 * 刪除與單碼匯出留在桌機表格的動作欄：兩者都是一次處理一列的事。
 */
export default async function AdminDiscounts({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; new?: string }>;
}) {
  await requireAdmin();
  const { error, new: wantNew } = await searchParams;
  const list = db.prepare("SELECT * FROM discount_codes ORDER BY id DESC").all() as CodeRow[];
  const usage = db
    .prepare(
      `SELECT discount_code AS code, COUNT(*) AS n, COALESCE(SUM(discount_amount),0) AS off, COALESCE(SUM(total),0) AS rev
       FROM orders WHERE discount_code!='' AND status IN ('paid','shipped','done') GROUP BY discount_code`
    )
    .all() as { code: string; n: number; off: number; rev: number }[];
  const usageMap = new Map(usage.map((u) => [u.code, u]));

  const ERRORS: Record<string, string> = {
    code: "折扣碼需為 2–20 位英數字（可含連字號）",
    percent: "打折請填 1–99（85 = 85 折）",
    amount: "折抵金額需大於 0",
    dup: "這個折扣碼已存在",
  };

  const today = new Date().toISOString().slice(0, 10);
  const expired = (c: CodeRow) => Boolean(c.expires_at && c.expires_at < today);
  const activeN = list.filter((c) => c.active && !expired(c)).length;
  const openNew = wantNew === "1" || Boolean(error) || list.length === 0;

  return (
    <>
      <AdminTabs active="discounts" tabs={[
        { key: "pay-links", label: "付款連結", href: "/admin/pay-links" },
        { key: "discounts", label: "折扣碼", href: "/admin/discounts" },
      ]} />

      <PageHead
        title="折 扣 碼"
        sub={<>{list.length} 個，{activeN} 個現在可以用。不分大小寫；停用不影響已成立的訂單</>}
        action={<Link className="btn fill" href="/admin/discounts?new=1#new">新增折扣碼</Link>}
      />

      {error && <p className="msg-err">{ERRORS[error] ?? "格式有誤"}</p>}

      <details className="ad-newbox" id="new" open={openNew}>
        <summary>新增一個折扣碼</summary>
        <div className="in">
          <form className="adm-form" action={saveDiscount}>
            <div className="adm-3col">
              <div className="field">
                <label>折扣碼（英數字）</label>
                <input className="sans ad-uc" type="text" name="code" placeholder="例如 YOUDO85" required />
              </div>
              <div className="field">
                <label>名稱（管理用，如「開幕慶」「與某某合作」）</label>
                <input type="text" name="name" placeholder="這個碼是做什麼的" />
              </div>
              <div className="field">
                <label>到期日（留空＝永久有效）</label>
                <input className="sans" type="date" name="expires_at" />
              </div>
              <div className="field">
                <label>類型</label>
                <select name="kind" defaultValue="percent">
                  <option value="percent">打折（值填 1–99，85 = 85 折）</option>
                  <option value="amount">折抵固定金額（NT$）</option>
                  <option value="freeship">免運費（值免填）</option>
                </select>
              </div>
              <div className="field">
                <label>值</label>
                <input className="sans" type="number" name="value" placeholder="85 或 200" min={0} />
              </div>
            </div>
            <div className="adm-actions"><button className="btn fill" type="submit">新增折扣碼</button></div>
          </form>
        </div>
      </details>

      {list.length === 0 ? (
        <Empty>還沒有折扣碼。按右上角「新增折扣碼」開第一個。</Empty>
      ) : (
        <>
          {/* 手機：一行一碼，右邊是用了幾次與唯一一顆動作（啟用／停用） */}
          <div className="ad-rows">
            {list.map((c) => {
              const u = usageMap.get(c.code);
              const off = expired(c) || !c.active;
              return (
                <div className="ad-row withbtn" key={c.id} data-tone={off ? "muted" : "ok"}>
                  <span className="ad-l">
                    <span className="ad-nm sans">{c.code}<span className="no">　{c.name || discountLabel(c)}</span></span>
                    <span className="ad-tm sans">
                      {discountLabel(c)}・{c.expires_at ? `${c.expires_at} 到期` : "永久"}
                      {expired(c) && <>（已過期）</>}
                    </span>
                  </span>
                  <span className="ad-r">
                    <span className="ad-amt sans">用 {u?.n ?? 0} 次</span>
                    <span className="ad-rowbtn">
                      <form action={toggleDiscount}>
                        <input type="hidden" name="id" value={c.id} />
                        <button type="submit" className="btn sm" title="點一下切換啟用/停用">
                          {c.active ? "啟用中" : "已停用"}
                        </button>
                      </form>
                    </span>
                  </span>
                </div>
              );
            })}
          </div>
          <p className="ad-listnote">刪除與「此碼交易 Excel」在表格檢視裡（按上面的「看表格」）。</p>
        </>
      )}

      <div className="ad-tablebox">
        <div className="adm-table-wrap">
          <table className="adm-table">
            <thead><tr><th>折扣碼</th><th>名稱</th><th>內容</th><th>到期日</th><th className="num">使用次數</th><th className="num">累積折抵</th><th className="num">帶入營收</th><th>狀態（點擊切換）</th><th>匯出</th><th></th></tr></thead>
            <tbody>
              {list.length === 0 && <tr><td colSpan={10} className="empty">還沒有折扣碼</td></tr>}
              {list.map((c) => {
                const u = usageMap.get(c.code);
                return (
                  <tr key={c.id}>
                    <td data-label="折扣碼" className="sans"><b>{c.code}</b></td>
                    <td data-label="名稱">{c.name || "—"}</td>
                    <td data-label="內容">{discountLabel(c)}</td>
                    <td data-label="到期日" className="sans">
                      {c.expires_at || "永久"}
                      {expired(c) && <span className="badge red ad-gapl">已過期</span>}
                    </td>
                    <td data-label="使用次數" className="sans num">{u?.n ?? 0}</td>
                    <td data-label="累積折抵" className="sans num">{money(u?.off ?? 0)}</td>
                    <td data-label="帶入營收" className="sans num">{money(u?.rev ?? 0)}</td>
                    <td className="acts">
                      <form action={toggleDiscount} className="ad-inlineform">
                        <input type="hidden" name="id" value={c.id} />
                        <button type="submit" className="btn sm" title="點一下切換啟用/停用">
                          {c.active ? "✓ 啟用中" : "✕ 已停用"}
                        </button>
                      </form>
                    </td>
                    <td className="acts">
                      <a href={`/api/admin/orders-csv?code=${encodeURIComponent(c.code)}`}>
                        此碼交易 Excel ↓
                      </a>
                    </td>
                    <td className="acts">
                      <form action={deleteDiscount} className="ad-inlineform">
                        <input type="hidden" name="id" value={c.id} />
                        <ConfirmSubmit className="danger-link" message="確定要刪除？此動作無法復原。">刪除</ConfirmSubmit>
                      </form>
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
