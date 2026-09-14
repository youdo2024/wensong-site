import type { Metadata } from "next";
import db from "@/lib/db";
import { requireAdmin } from "@/lib/admin-guard";
import PageHead from "@/components/admin/PageHead";
import Empty from "@/components/admin/Empty";
import { fmtDateTimeDash } from "@/lib/format";

export const metadata: Metadata = { title: "修改記錄" };

type LogRow = { id: number; user_name: string; action: string; target: string; detail: string; created_at: string };

/*
 * 修改記錄（第 2 段：3 帳號各自登入）。
 * 只列最近 300 筆，這支是給站長回頭查「誰改了什麼」用的，不是完整稽核系統，
 * 真要查更早的直接進資料庫。寫入端在 lib/admin-log.ts。
 */
export default async function AdminLog() {
  await requireAdmin();
  const rows = db.prepare("SELECT * FROM admin_log ORDER BY id DESC LIMIT 300").all() as LogRow[];

  return (
    <>
      <PageHead title="修 改 記 錄" sub={`最近 ${rows.length} 筆`} />

      {rows.length === 0 ? (
        <Empty>還沒有任何修改記錄。</Empty>
      ) : (
        <div className="ad-tablebox always">
          <div className="adm-table-wrap">
            <table className="adm-table">
              <thead>
                <tr>
                  <th>時間</th>
                  <th>誰</th>
                  <th>動作</th>
                  <th>對象</th>
                  <th>說明</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td data-label="時間" className="sans">{fmtDateTimeDash(r.created_at)}</td>
                    <td data-label="誰">{r.user_name || "—"}</td>
                    <td data-label="動作">{r.action}</td>
                    <td data-label="對象" className="sans">{r.target || "—"}</td>
                    <td data-label="說明">{r.detail || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}
