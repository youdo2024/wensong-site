import type { Metadata } from "next";
import Link from "next/link";
import db, { getSetting } from "@/lib/db";
import { requireAdmin } from "@/lib/admin-guard";
import AdminTabs from "@/components/AdminTabs";
import CopyField from "@/components/CopyField";
import PageHead from "@/components/admin/PageHead";
import Empty from "@/components/admin/Empty";
import {
  lineEnabled, lineNotifyOn, lineReady, lineQuota, lineSentThisMonth, lineTestMode, lineTestUserIds, lineOaId,
  LINE_KINDS, LINE_VARS, lineTemplate, renderLine, composeLine, type LineLog,
} from "@/lib/line";
import { saveLineSettings } from "@/app/admin/actions";
import { fmtDateTimeDash } from "@/lib/format";

export const metadata: Metadata = { title: "LINE 通知" };
export const dynamic = "force-dynamic";

/*
 * LINE 通知（2026-09-06 改版第六批）。
 *
 * 四段：狀態與額度、最近綁定、要填進 LINE 後台的東西、訊息模板，最後是推播紀錄。
 * 每一段一條區塊標題（.ad-sect），不再靠「h3 加間距」猜哪裡分段。
 * 兩張表加 .always：手機也要看得到（它們不是 .wide，手機自己攤成一張一筆的卡）。
 */

const STATUS: Record<string, string> = { sent: "已推", failed: "失敗", blocked: "未推", info: "事件" };
const BIND_ST: Record<string, string> = { bound: "已綁定", blocked: "封鎖", nofriend: "沒加好友" };
const SAMPLE = { name: "王小明", order: "YD2609010001", total: "1600", info: "ATM 轉帳：822 1234567890123（9/10 前完成）", url: "https://www.wensong.tw/shop/thanks?no=YD2609010001&k=…", title: "阿嬤的醬缸" };

export default async function AdminLine({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  await requireAdmin();
  const sp = await searchParams;
  const ready = lineReady();
  const site = (process.env.SITE_URL || "https://www.wensong.tw").replace(/\/$/, "");
  const logs = db.prepare("SELECT * FROM line_log ORDER BY id DESC LIMIT 50").all() as LineLog[];
  const counts = db.prepare("SELECT status, COUNT(*) n FROM line_bindings GROUP BY status").all() as { status: string; n: number }[];
  const bound = counts.find((c) => c.status === "bound")?.n || 0;
  const blocked = counts.find((c) => c.status === "blocked")?.n || 0;
  const nofriend = counts.find((c) => c.status === "nofriend")?.n || 0;
  const webhookLast = getSetting("line_webhook_last", "");
  const bindings = db.prepare("SELECT line_user_id,phone,email,status,source,order_no,updated_at FROM line_bindings ORDER BY updated_at DESC LIMIT 20").all() as
    { line_user_id: string; phone: string; email: string; status: string; source: string; order_no: string; updated_at: string }[];
  const mask = (p: string) => (p ? p.replace(/^(\d{4})\d{3}(\d{3})$/, "$1***$2") : "");

  return (
    <>
      <AdminTabs active="line" tabs={[
        { key: "leads", label: "名單總覽", href: "/admin/leads" },
        { key: "members", label: "會員名單", href: "/admin/members" },
        { key: "mail", label: "發送", href: "/admin/mail" },
        { key: "newsletter", label: "電子報", href: "/admin/newsletter" },
        { key: "sms", label: "簡訊", href: "/admin/sms" },
        { key: "line", label: "LINE", href: "/admin/line" },
      ]} />

      <PageHead
        title="LINE 通 知"
        sub={ready.ok
          ? <>可以推。本月已推 {lineSentThisMonth()}／{lineQuota()} 則。沒綁、封鎖、額度用完都退回 Email 與簡訊</>
          : <>目前不會推 LINE：{ready.why}</>}
      />

      {sp.ok && <p className="msg-ok">{sp.ok}</p>}
      {sp.err && <p className="msg-err">{sp.err}</p>}
      {lineTestMode() && (
        <div className="ad-note warn">
          <b>LINE 測試模式中</b>
          <p className="fine">只推給白名單裡的 {lineTestUserIds().length} 個 userId，其他人一律走 Email 與簡訊。測完到「網站設定」把白名單清空。</p>
        </div>
      )}
      {!lineNotifyOn() && lineEnabled() && (
        <div className="ad-note warn">
          <b>LINE 通知總開關目前關閉</b>
          <p className="fine">客人看不到綁定入口，也不會推播（開關在「網站設定」）。測完再去打開。</p>
        </div>
      )}

      <div className="adm-cards">
        <div className="adm-card">
          <div className="k">本 月 已 推</div>
          <div className="v">{lineSentThisMonth()}<small>／{lineQuota()}</small></div>
          <div className="note">額度在網站設定改</div>
        </div>
        <div className="adm-card">
          <div className="k">已 綁 定</div>
          <div className="v">{bound}</div>
          <div className="note">封鎖 {blocked}・沒加好友 {nofriend}</div>
        </div>
        <div className="adm-card">
          <div className="k">webhook 最近收到</div>
          <div className="v sm">{webhookLast ? fmtDateTimeDash(webhookLast) : "還沒收過"}</div>
          <div className="note">{lineEnabled() ? "金鑰已設定" : "金鑰未設定"}</div>
        </div>
      </div>

      <div className="ad-part">
        <div className="ad-sect"><h2>最 近 綁 定</h2><div className="rule" /></div>
        <p className="fine">要填測試白名單就從這裡複製 userId。手機號碼中間三碼遮掉。</p>
        {bindings.length === 0 ? (
          <Empty>還沒有人綁定。自己測：加官方帳號好友，把自己一張訂單的編號（YD 開頭）傳給它，就會出現在這裡。</Empty>
        ) : (
          <div className="ad-tablebox always">
            <div className="adm-table-wrap">
              <table className="adm-table">
                <thead><tr><th>userId</th><th>狀態</th><th>來源</th><th>手機</th><th>Email</th><th>訂單</th><th>更新</th></tr></thead>
                <tbody>
                  {bindings.map((b) => (
                    <tr key={b.line_user_id}>
                      <td data-label="userId"><CopyField value={b.line_user_id} /></td>
                      <td data-label="狀態">{BIND_ST[b.status] || b.status}</td>
                      <td data-label="來源">{b.source}</td>
                      <td data-label="手機" className="sans">{mask(b.phone)}</td>
                      <td data-label="Email" className="sans brk">{b.email}</td>
                      <td data-label="訂單" className="sans">{b.order_no}</td>
                      <td data-label="更新" className="sans">{fmtDateTimeDash(b.updated_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      <div className="ad-part">
        <div className="ad-sect"><h2>LINE 後 台 要 填 的</h2><div className="rule" /></div>
        <p className="fine">連線探測（不推訊息、不算額度）：<a href="/api/line/probe" target="_blank" rel="noopener">/api/line/probe</a>，會顯示官方帳號名稱與 basicId。</p>
        <p className="fine">Messaging API channel 的 Webhook URL（填進去並開啟 Use webhook）：</p>
        <CopyField value={`${site}/api/line/webhook`} />
        <p className="fine">
          環境變數（Zeabur）：LINE_MESSAGING_ACCESS_TOKEN、LINE_MESSAGING_CHANNEL_SECRET、LINE_OA_ID（@ 開頭，現在{lineOaId() ? `是 ${lineOaId()}` : "還沒設"}）。
          金鑰只放 Zeabur，不要貼進後台任何欄位。
        </p>
      </div>

      <div className="ad-part">
        <div className="ad-sect"><h2>訊 息 模 板</h2><div className="rule" /></div>
        <p className="fine">
          可用變數：{LINE_VARS}
          <br />
          連結由系統加在最後一行，不用寫進去；不加署名，官方帳號名稱聊天室本來就顯示。留空會用預設文案。
          <br />
          加好友的歡迎訊息用 LINE 官方帳號後台那則，系統不發；「綁定成功」「綁定失敗」「非訂單編號訊息」三種是用回覆（reply）發的，LINE 不算進月額度，只有主動推播才算。
        </p>
        <form className="adm-form" action={saveLineSettings}>
          {LINE_KINDS.map((k) => (
            <div className="field" key={k.key}>
              <label>{k.label}</label>
              <textarea name={`line_tpl_${k.key}`} className="ta-s" defaultValue={lineTemplate(k.key)} />
              <p className="ad-hint pre">
                預覽：{"\n"}<b>{composeLine(renderLine(lineTemplate(k.key), SAMPLE), ["atm", "paid", "shipped", "pending", "failed"].includes(k.key) ? SAMPLE.url : "")}</b>
              </p>
            </div>
          ))}
          <div className="adm-actions sticky-save"><button className="btn fill" type="submit">儲存模板</button></div>
        </form>

        <p className="fine">
          要推 LINE：訂單相關的到訂單頁「通知客人」（信、簡訊、LINE 同一區）；不是訂單的到<Link href="/admin/mail">「發送」頁</Link>。
        </p>
      </div>

      <div className="ad-part">
        <div className="ad-sect"><h2>最 近 50 筆</h2><div className="rule" /></div>
        {logs.length === 0 ? (
          <Empty>還沒有推播紀錄。</Empty>
        ) : (
          <div className="ad-tablebox always">
            <div className="adm-table-wrap">
              <table className="adm-table">
                <thead><tr><th>時間</th><th>訂單</th><th>種類</th><th>狀態</th><th>內容</th><th>原因</th></tr></thead>
                <tbody>
                  {logs.map((l) => (
                    <tr key={l.id}>
                      <td data-label="時間" className="sans">{fmtDateTimeDash(l.created_at)}</td>
                      <td data-label="訂單" className="sans">{l.order_no}</td>
                      <td data-label="種類">{l.kind}</td>
                      <td data-label="狀態" className={l.status === "sent" ? "tone-ok" : "tone-fail"}>{STATUS[l.status] || l.status}</td>
                      <td data-label="內容" className="pre">{l.content}</td>
                      <td data-label="原因" className="tone-muted">{l.error}</td>
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
