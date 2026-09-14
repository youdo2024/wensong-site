import type { Metadata } from "next";
import Link from "next/link";
import db from "@/lib/db";
import { requireAdmin } from "@/lib/admin-guard";
import AdminTabs from "@/components/AdminTabs";
import Switch from "@/components/admin/Switch";
import PageHead from "@/components/admin/PageHead";
import Empty from "@/components/admin/Empty";
import { smsReady, smsBrand, smsSignature, smsTemplate, composeSms, pendingSms, failedSms, payUrlFor, SMS_VARS, type SmsLog } from "@/lib/sms";
import { saveSmsSettings } from "@/app/admin/actions";
import { fmtDateTimeDash } from "@/lib/format";
import { getSetting } from "@/lib/db";

export const metadata: Metadata = { title: "簡訊" };
export const dynamic = "force-dynamic";

/*
 * 簡訊（2026-09-06 改版第六批）。
 *
 * 這一頁做兩件事：設定簡訊怎麼寄，以及看寄了什麼。所以分成兩段，各有一條區塊標題。
 * 寄送紀錄留在頁面上、不收進工具區：簡訊被電信商擋掉是靜靜發生的，
 * 那張表是唯一看得出來的地方，收起來等於沒有人會發現。
 * 紀錄那張表加 .always：手機直接顯示（它不是 .wide，手機自己會攤成一張一則的卡）。
 */

const STATUS: Record<string, string> = { sent: "已送出", failed: "失敗", blocked: "未送出" };

export default async function AdminSms({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; err?: string }>;
}) {
  await requireAdmin();
  const sp = await searchParams;
  const ready = smsReady();
  const logs = db.prepare("SELECT * FROM sms_log ORDER BY id DESC LIMIT 50").all() as SmsLog[];
  const todayCount = (db
    .prepare("SELECT COUNT(*) c FROM sms_log WHERE status='sent' AND created_at >= date('now','-1 day')")
    .get() as { c: number }).c;

  return (
    <>
      <AdminTabs active="sms" tabs={[
        { key: "leads", label: "名單總覽", href: "/admin/leads" },
        { key: "members", label: "會員名單", href: "/admin/members" },
        { key: "mail", label: "發送", href: "/admin/mail" },
        { key: "newsletter", label: "電子報", href: "/admin/newsletter" },
        { key: "sms", label: "簡訊", href: "/admin/sms" },
        { key: "line", label: "LINE", href: "/admin/line" },
      ]} />

      <PageHead
        title="簡 訊"
        sub={ready.ok
          ? <>可以寄。近 24 小時已送出 {todayCount} 則</>
          : <>目前還不能寄：{ready.why}</>}
      />

      {sp.ok && <p className="msg-ok">{sp.ok}</p>}
      {sp.err && <p className="msg-err">{sp.err}</p>}

      {!ready.ok && (
        <div className="ad-note warn">
          <b>還不能寄簡訊</b>
          <p className="fine">
            {ready.why}
            <br />待繳費與付款失敗的自動簡訊也會一樣被擋下並記錄在下面的寄送紀錄，不會靜靜地消失。
          </p>
        </div>
      )}

      <div className="ad-part">
        <div className="ad-sect"><h2>設 定</h2><div className="rule" /></div>
        <form className="adm-form" action={saveSmsSettings}>
          <div className="adm-2col">
            <div className="field">
              <label>實名制身份（你在電子豹送審通過的那個名稱）</label>
              <input type="text" name="sms_brand" defaultValue={smsBrand()} placeholder="問爽的" />
              <p className="ad-hint">
                這一格不會直接印在簡訊裡，是下面的「署名」<b>留空時</b>的備援。
                NCC 只要求標示出現在簡訊的開頭或結尾，我們放結尾。
              </p>
            </div>
            <div className="field">
              <Switch
                name="sms_whitelist_ok"
                label="電信商白名單已通過"
                hint={<>電子豹後台的「實名制身份」與「網域白名單」兩個都顯示<b>已通過</b>再勾。程式沒有辦法自己知道電信商審過了沒，勾早了只會一直失敗還照樣扣你的簡訊額度。</>}
                defaultChecked={getSetting("sms_whitelist_ok", "0") === "1"}
              />
            </div>
          </div>

          <div className="field">
            <label>署名（每則簡訊的最後一行，系統自動加，不用寫在下面的內容裡）</label>
            <input type="text" name="sms_signature" defaultValue={smsSignature()} placeholder="問爽的 WenSong" />
            <p className="ad-hint">
              這一行就是 NCC 要求的實名制標示。<b>留空的話會自動退回用上面的實名制身份</b>，
              因為沒有標示的簡訊會被電信商整則擋下。
            </p>
          </div>

          <div className="ad-sect"><h2>內 容 模 板</h2><div className="rule" /></div>
          <p className="fine">
            可用變數：{SMS_VARS}
            <br />
            連結與署名由系統加在後面，不用寫進去。留空會用預設文案。
          </p>

          <p className="ad-hint">
            待繳費提醒分三輪，語氣一輪比一輪明確，跟提醒中心手動傳的那套一致。
            第三次以後都用最後一次的語氣。
          </p>
          <div className="field">
            <label>待繳費提醒・第一次</label>
            <textarea name="sms_tpl_pending" className="ta-s" defaultValue={smsTemplate("pending")} />
            <p className="ad-hint pre">
              實際寄出會長這樣：{"\n"}
              <b>{composeSms(pendingSms({ order_no: "YD2609010001", total: 1600, name: "王小明", remind_count: 0 }), payUrlFor("YD2609010001", "abc123def456"))}</b>
            </p>
          </div>
          <div className="field">
            <label>待繳費提醒・第二次</label>
            <textarea name="sms_tpl_pending2" className="ta-s" defaultValue={smsTemplate("pending2")} />
            <p className="ad-hint pre">
              實際寄出會長這樣：{"\n"}
              <b>{composeSms(pendingSms({ order_no: "YD2609010001", total: 1600, name: "王小明", remind_count: 1 }), payUrlFor("YD2609010001", "abc123def456"))}</b>
            </p>
          </div>
          <div className="field">
            <label>待繳費提醒・最後一次</label>
            <textarea name="sms_tpl_pending3" className="ta-s" defaultValue={smsTemplate("pending3")} />
            <p className="ad-hint pre">
              實際寄出會長這樣：{"\n"}
              <b>{composeSms(pendingSms({ order_no: "YD2609010001", total: 1600, name: "王小明", remind_count: 2 }), payUrlFor("YD2609010001", "abc123def456"))}</b>
            </p>
          </div>

          <div className="field">
            <label>付款失敗</label>
            <textarea name="sms_tpl_failed" className="ta-s" defaultValue={smsTemplate("failed")} />
            <p className="ad-hint pre">
              實際寄出會長這樣：{"\n"}
              <b>{composeSms(failedSms({ order_no: "YD2609010002", name: "王小明" }), payUrlFor("YD2609010002", "abc123def456"))}</b>
            </p>
          </div>

          <div className="adm-actions"><button className="btn fill" type="submit">儲存</button></div>
        </form>

        <p className="fine">
          要發簡訊：訂單相關的到訂單頁「通知客人」（信、簡訊、LINE 同一區）；不是訂單的到<Link href="/admin/mail">「發送」頁</Link>。
        </p>
      </div>

      <div className="ad-part">
        <div className="ad-sect"><h2>寄 送 紀 錄</h2><div className="rule" /></div>
        {logs.length === 0 ? (
          <Empty>還沒有寄過簡訊。</Empty>
        ) : (
          <div className="ad-tablebox always">
            <div className="adm-table-wrap">
              <table className="adm-table">
                <thead>
                  <tr><th>時間</th><th>號碼</th><th>類型</th><th>狀態</th><th>內容</th></tr>
                </thead>
                <tbody>
                  {logs.map((l) => (
                    <tr key={l.id}>
                      <td data-label="時間" className="sans">{fmtDateTimeDash(l.created_at)}</td>
                      <td data-label="號碼" className="sans">{l.phone}</td>
                      <td data-label="類型">
                        {l.kind === "pending" ? "待繳費" : l.kind === "failed" ? "付款失敗" : "手動"}
                      </td>
                      <td data-label="狀態" className={l.status === "sent" ? "" : "tone-fail"}>
                        {STATUS[l.status] || l.status}
                        {l.error && <div>{l.error}</div>}
                      </td>
                      <td data-label="內容" className="pre">{l.content}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
