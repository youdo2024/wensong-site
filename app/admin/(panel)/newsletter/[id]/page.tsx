import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/admin-guard";
import { getNewsletter, newsletterProgress, audienceCount } from "@/lib/newsletter";
import { newsleopardEnabled } from "@/lib/newsleopard";
import { saveNewsletter, startNewsletterSend, retryNewsletterFailed, sendNewsletterTest } from "@/app/admin/actions";
import { fmtDateTimeDash } from "@/lib/format";
import db from "@/lib/db";
import PageHead from "@/components/admin/PageHead";
import StatusBar from "@/components/admin/StatusBar";
import { newsletterStatus } from "@/components/admin/list-fmt";
import ActionRow, { type ActionItem } from "@/components/admin/ActionRow";
import Card from "@/components/admin/Card";

export const metadata: Metadata = { title: "編輯電子報" };
export const dynamic = "force-dynamic";

/*
 * 一封電子報（2026-09-06 改版第六批）。
 *
 * 照 ia.md §5 的詳情頁骨架：狀態列在最上面（狀態、寄了幾封、失敗幾封、開始與結束時間、
 * 下一步該做什麼一句話），能做的事收進動作列，點了才展開，同時只展開一個。
 * 內容在一張卡裡：還是草稿就是可編輯的表單，已經開始寄就換成唯讀的預覽框，
 * 因為那時候欄位全部 disabled，長得像表單只會讓人以為還改得動。
 */

export default async function EditNewsletter({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ saved?: string; err?: string; started?: string }>;
}) {
  await requireAdmin();
  const { id } = await params;
  const sp = await searchParams;
  const isNew = id === "new";
  const n = isNew ? null : getNewsletter(Number(id));
  if (!isNew && !n) notFound();

  const p = n ? newsletterProgress(n.id) : null;
  const editable = !n || n.status === "draft";
  const fails = n
    ? (db.prepare("SELECT email,error FROM newsletter_sends WHERE newsletter_id=? AND status='failed' LIMIT 20").all(n.id) as { email: string; error: string }[])
    : [];

  /* 下一步一句話。算不出來就不寫，不編（admin-ui-spec 第四節） */
  const nextLine = !n
    ? "先寫好主旨與內文，按儲存草稿。"
    : n.status === "draft"
      ? "先寄一封給自己看過版型，再按「正式寄出」。"
      : n.status === "sending"
        ? "每 20 秒自動寄一批（100 封）。可以離開這一頁，它會在背景繼續，重新整理看最新進度。"
        : p && p.failed > 0
          ? `已寄完，有 ${p.failed} 封失敗，可以重試。`
          : "已寄完。";

  /* 動作列：測試信永遠有，正式寄出只有草稿有，重試只有寄過而且有失敗的才有 */
  const actions: ActionItem[] = n
    ? [
        {
          key: "test",
          label: "寄測試信",
          icon: "mail",
          anchor: "test",
          meta: "先給自己",
          panel: (
            <>
              <form action={sendNewsletterTest} className="adm-form">
                <input type="hidden" name="id" value={n.id} />
                <div className="field">
                  <label>測試收件信箱</label>
                  <input type="email" name="test_to" placeholder="你自己的信箱" required />
                </div>
                <div className="adm-actions"><button className="btn fill" type="submit">寄測試信</button></div>
              </form>
              <p className="fine">內容與版型跟正式寄出完全一樣，只有主旨前面多了［測試］。</p>
            </>
          ),
        },
        ...(n.status === "draft"
          ? [{
              key: "send",
              label: "正式寄出",
              icon: "check" as const,
              anchor: "send",
              meta: `${audienceCount()} 位`,
              panel: (
                <>
                  <p className="fine">
                    會寄給目前 <b className="sans">{audienceCount()}</b> 位訂閱者（已排除退訂與寄不到的信箱）。
                    <br />
                    按下去之後名單就固定了，之後才訂閱的人不會收到這一封。
                    <b>寄出無法收回，先用「寄測試信」給自己確認。</b>
                  </p>
                  <form action={startNewsletterSend} className="ad-mt">
                    <input type="hidden" name="id" value={n.id} />
                    <button className="btn fill" type="submit" disabled={!newsleopardEnabled()}>
                      開始寄送
                    </button>
                  </form>
                  {!newsleopardEnabled() && <p className="msg-err">電子豹尚未設定，現在不能寄。</p>}
                </>
              ),
            }]
          : []),
        ...(p && p.failed > 0 && n.status !== "draft"
          ? [{
              key: "retry",
              label: "重試失敗的",
              icon: "alert" as const,
              anchor: "retry",
              meta: `${p.failed} 封`,
              panel: (
                <>
                  <form action={retryNewsletterFailed}>
                    <input type="hidden" name="id" value={n.id} />
                    <button className="btn fill" type="submit">重試失敗的 {p.failed} 封</button>
                  </form>
                  {fails.length > 0 && (
                    <details className="ad-mt">
                      <summary className="fine">看失敗的（前 20 筆）</summary>
                      <ul className="ad-errlist fine">
                        {fails.map((f) => <li key={f.email}>{f.email}：{f.error}</li>)}
                      </ul>
                    </details>
                  )}
                </>
              ),
            }]
          : []),
      ]
    : [];

  return (
    <>
      <PageHead
        back={{ href: "/admin/newsletter", label: "回電子報列表" }}
        title={isNew ? "寫 一 封 電 子 報" : n!.subject}
        sub={isNew ? "主旨與內文寫完先存草稿，寄出前一定先寄一封給自己" : undefined}
      />

      {sp.saved && <p className="msg-ok">已儲存。</p>}
      {sp.started && <p className="msg-ok">{sp.started}</p>}
      {sp.err && <p className="msg-err">{sp.err}</p>}

      {n && (
        <StatusBar
          word={newsletterStatus(n.status)[0]}
          tone={newsletterStatus(n.status)[1]}
          amount={p && p.total > 0 ? <span className="sans">{p.sent} / {p.total}</span> : undefined}
          meta={
            <>
              收件人 {p?.total ?? 0} 位
              {p && p.failed > 0 && <>・<span className="tone-fail">失敗 {p.failed}</span></>}
              　建立 {fmtDateTimeDash(n.created_at)}
              {n.started_at && <>・開始 {fmtDateTimeDash(n.started_at)}</>}
              {n.finished_at && <>・寄完 {fmtDateTimeDash(n.finished_at)}</>}
            </>
          }
          next={nextLine}
        />
      )}

      {actions.length > 0 && <ActionRow actions={actions} />}

      <Card title="內 容">
        {editable ? (
          <form className="adm-form" action={saveNewsletter}>
            <input type="hidden" name="id" value={n?.id ?? ""} />
            <div className="field">
              <label>信件主旨 <em>＊</em>（收件人在信箱列表看到的那一行）</label>
              <input type="text" name="subject" defaultValue={n?.subject ?? ""} required />
            </div>
            <div className="field">
              <label>信件大標（版型裡那行大字，留空就用主旨）</label>
              <input type="text" name="title" defaultValue={n?.title ?? ""} />
            </div>
            <div className="field">
              <label>內文 <em>＊</em>（純文字，空一行分段）</label>
              <textarea name="body" className="ta-l" defaultValue={n?.body ?? ""} />
            </div>
            <div className="adm-2col">
              <div className="field">
                <label>按鈕文字（選填）</label>
                <input type="text" name="btn_text" defaultValue={n?.btn_text ?? ""} placeholder="例如：看這篇文章" />
              </div>
              <div className="field">
                <label>按鈕連結（選填）</label>
                <input type="text" name="btn_url" defaultValue={n?.btn_url ?? ""} placeholder="https://www.wensong.tw/articles/..." />
              </div>
            </div>
            <div className="adm-actions">
              <button className="btn fill" type="submit">儲存草稿</button>
            </div>
          </form>
        ) : (
          <>
            <p className="fine">
              已經開始寄送，內容不能再改。前半段收到的人跟後半段收到的人會看到不一樣的信，
              那件事沒有辦法對客人解釋。要改就開一封新的。
            </p>
            <div className="ad-preview">{n!.body}</div>
            {n!.btn_text && (
              <p className="fine">按鈕：{n!.btn_text}　{n!.btn_url}</p>
            )}
          </>
        )}
      </Card>
    </>
  );
}
