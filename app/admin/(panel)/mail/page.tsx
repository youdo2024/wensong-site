import type { Metadata } from "next";
import { mailEnabled, blockedMails } from "@/lib/mail";
import { fmtDateTimeDash } from "@/lib/format";
import { blockMailAddress, unblockMailAddress, sendManualSms, sendManualLine, resendMailLog, makeShortLink } from "@/app/admin/actions";
import { listSent, MAIL_KIND_LABEL, MAIL_STATUS_LABEL, MAIL_ROUTE_LABEL } from "@/lib/mail-log";
import Check from "@/components/admin/Check";
import { smsReady, smsSignature, SMS_LIMIT } from "@/lib/sms";
import { lineEnabled, lineNotifyOn } from "@/lib/line";
import { ADMIN_MAIL_MAX, paidUnshippedEmails } from "@/lib/admin-mail";
import AdminMailForm from "@/components/AdminMailForm";
import ConfirmSubmit from "@/components/ConfirmSubmit";
import CopyField from "@/components/CopyField";
import { recentShortLinks, shortClickTime, shortSiteUrl, SHORT_CHANNEL_LABEL } from "@/lib/short-link";

import { requireAdmin } from "@/lib/admin-guard";
import AdminTabs from "@/components/AdminTabs";
import PageHead from "@/components/admin/PageHead";
import Empty from "@/components/admin/Empty";
import MailTabs from "@/components/admin/MailTabs";
import { mailTabFromParams } from "@/components/admin/list-fmt";
export const metadata: Metadata = { title: "發送" };
export const dynamic = "force-dynamic";

/*
 * 發送（改版第五批，2026-09-06）。
 *
 * 原本一頁從上到下攤開五件事：手寫信、簡訊、LINE、寄不到的信箱、寄件紀錄，
 * 402 寬要捲七八屏才到得了紀錄，而且四個送出鈕同時在畫面上。
 * 現在改成四個分頁籤（信／簡訊／LINE／紀錄），同時只看得到一塊；
 * 「寄不到的信箱」跟著紀錄走，因為它們回答的是同一個問題：這封到底寄不寄得到。
 *
 * server action、表單欄位名、網址參數一個都沒有換。舊的 /admin/mail?q=…#log
 * 照樣會停在紀錄那一頁（判斷寫在 components/admin/list-fmt.ts 的 mailTabFromParams）。
 */

export default async function AdminMail({
  searchParams,
}: {
  searchParams: Promise<{ sent?: string; failed?: string; err?: string; ok?: string; to?: string; blocked?: string; unblocked?: string; q?: string; n?: string; owner?: string | string[]; test?: string | string[]; queued?: string; tab?: string; short?: string }>;
}) {
  await requireAdmin();
  const sp = await searchParams;
  const blocked = blockedMails();
  const fillEmails = paidUnshippedEmails();
  /* 寄件紀錄的篩選：Check 開關送 0 與 1 兩個值，有 1 就算開 */
  const flag = (v: string | string[] | undefined) => (Array.isArray(v) ? v : [v]).some((x) => x === "1");
  const showOwner = flag(sp.owner), showTest = flag(sp.test);
  const n = Math.min(500, Math.max(50, Number(sp.n) || 50));
  const log = listSent({ q: sp.q || "", showOwner, showTest, limit: n });
  const moreUrl = (() => {
    const u = new URLSearchParams();
    if (sp.q) u.set("q", sp.q);
    if (showOwner) u.set("owner", "1");
    if (showTest) u.set("test", "1");
    u.set("n", String(n + 100));
    return `/admin/mail?${u.toString()}#log`;
  })();
  /* 標記／恢復寄不到的信箱之後 action 會導回這頁，那些訊息屬於「紀錄」那一塊 */
  const initialTab = sp.blocked || sp.unblocked ? "log" : mailTabFromParams(sp);
  /* 站內短網址：最近發過的幾條，跟簡訊放在一起（會用到它的就是簡訊） */
  const shorts = recentShortLinks(30);

  /* ── 信 ── */
  const panelMail = (
    <>
      <AdminMailForm
        max={ADMIN_MAIL_MAX}
        presetTo={sp.to || ""}
        fill={{ label: "帶入已付款未出貨的客人", emails: fillEmails, hint: "會跳過已經綁 LINE 的人和標記寄不到的信箱；帶進來以後還是可以在欄位裡刪。" }}
      />
      {/* 群發的那一段話收成一行：它是一條界線，不是一個區塊 */}
      <p className="fine">
        這頁不是拿來群發的：一次最多 {ADMIN_MAIL_MAX} 位，這是刻意的。群發需要退訂連結與寄送速率控制，
        少了那些，網域很快會被判定成垃圾信來源，連訂單確認信都會跟著進垃圾桶。要做電子報請用「電子報」那一頁。
      </p>
    </>
  );

  /* ── 簡訊 ── */
  const panelSms = (
    <>
      {!smsReady().ok && <p className="msg-err">目前還不能寄簡訊：{smsReady().why}（設定在「簡訊」分頁）</p>}
      <form className="adm-form" action={sendManualSms}>
        <div className="adm-2col">
          <div className="field">
            <label>手機號碼 <em>＊</em></label>
            <input className="sans" type="tel" name="phone" inputMode="numeric" maxLength={10} placeholder="09xxxxxxxx" required />
          </div>
          <div className="field">
            <label>網址（選填，會放在最後一行）</label>
            <input type="text" name="url" placeholder="https://www.wensong.tw/..." />
          </div>
        </div>
        <div className="field">
          <label>內容 <em>＊</em></label>
          <textarea name="body" required placeholder="開頭可以先寫對方的名字。署名系統會自動加在最後一行" />
          <p className="fine">
            整則上限 {SMS_LIMIT} 字元，網址與最後一行的署名「{smsSignature()}」都算進去。
            網址一定要是白名單內的網域，其他網域（含短網址）會被電信商擋掉。每則要錢。
          </p>
        </div>
        <div className="adm-actions"><button className="btn fill" type="submit">送出簡訊</button></div>
      </form>

      {/* ── 站內短網址 ──
          自己蓋的原因：電信商對簡訊網址是白名單制，第三方短網址的網域一律被擋，
          整則寄不出去（錢照扣、人沒收到）。所以這裡只縮本站的網址。 */}
      <div className="ad-sect"><h2>短 網 址</h2><div className="rule" /></div>
      <p className="fine">
        貼一條本站的網址，換一條 {shortSiteUrl().replace(/^https?:\/\//, "")}/l/xxxxxxxx（共 30 個字元），
        手寫簡訊時用它可以多留六十幾個字給內文。系統自動發的催款簡訊、Email 與 LINE 已經自動換過了。
        只縮本站網址：短網址掛在送審通過的那個網域上，能縮站外就等於把白名單借給別人。
      </p>
      {sp.short && (
        <div className="field">
          <label>短網址（複製起來貼進訊息）</label>
          <CopyField value={sp.short} />
        </div>
      )}
      <form className="adm-form" action={makeShortLink}>
        <div className="field">
          <label>要縮的網址 <em>＊</em></label>
          <input className="sans" type="text" name="url" required placeholder="/api/orders/pay?no=YD...&t=... 或 https://www.wensong.tw/..." />
        </div>
        <div className="adm-actions"><button className="btn" type="submit">產生短網址</button></div>
      </form>

      {shorts.length === 0 ? (
        <Empty>還沒有發過短網址。</Empty>
      ) : (
        <div className="ad-tablebox">
          <div className="adm-table-wrap">
            <table className="adm-table">
              <thead><tr><th>短網址</th><th>指到哪</th><th>管道</th><th>點擊</th><th>最後點擊</th></tr></thead>
              <tbody>
                {shorts.map((l) => (
                  <tr key={l.code}>
                    <td data-label="短網址" className="sans brk">/l/{l.code}</td>
                    <td data-label="指到哪" className="sans brk">{l.target}</td>
                    <td data-label="管道">{SHORT_CHANNEL_LABEL[l.channel] || l.channel}</td>
                    <td data-label="點擊" className="sans">
                      {l.clicks}
                      {/* 被限流擋下的次數：有人拿字典在掃這條連結時才會不是 0 */}
                      {l.blocked > 0 ? <span className="sub2">另有 {l.blocked} 次被限流擋下</span> : null}
                    </td>
                    <td data-label="最後點擊" className="sans">{shortClickTime(l.last_click_at) || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );

  /* ── LINE ── */
  const panelLine = (
    <>
      {!lineEnabled() ? (
        <p className="msg-err">還沒設定 LINE 金鑰，推不出去。</p>
      ) : !lineNotifyOn() ? (
        <p className="msg-err">LINE 通知總開關關著（網站設定），現在推不出去。</p>
      ) : null}
      <p className="fine">填訂單編號會推給那張訂單綁定的人；也可以直接填 LINE userId（U 開頭，會員名單看得到）。算額度。</p>
      <form className="adm-form" action={sendManualLine}>
        <div className="adm-2col">
          <div className="field"><label>訂單編號或 LINE userId <em>＊</em></label><input className="sans" type="text" name="target" placeholder="YD2609010001 或 Uxxxx" required /></div>
          <div className="field"><label>連結（選填，放最後一行）</label><input className="sans" type="url" name="url" placeholder="https://" /></div>
        </div>
        <div className="field"><label>內容 <em>＊</em></label><textarea name="body" required /></div>
        <div className="adm-actions"><button className="btn fill" type="submit">推送 LINE</button></div>
      </form>
    </>
  );

  /* ── 紀錄（寄件紀錄＋寄不到的信箱）── */
  const panelLog = (
    <div id="log">
      <p className="fine">
        全站每一封信都在這裡：手寫信、訂單與贊助的例行信、提醒與失敗通知；這頁發的簡訊與 LINE 也一起列。
        手寫信可以「看內容」，寄失敗的可以「重寄」。留一年。營運通知與測試信預設藏起來。
      </p>
      <form method="get" action="/admin/mail" className="ad-mb">
        <input type="hidden" name="n" value={n} />
        {/* 送出後要回到這一頁分頁，不然按了搜尋會跳回「信」 */}
        <input type="hidden" name="tab" value="log" />
        <div className="chk-list">
          <Check name="owner" label="顯示營運通知" defaultChecked={showOwner} />
          <Check name="test" label="顯示測試信" defaultChecked={showTest} />
        </div>
        <div className="adm-search">
          <input type="search" name="q" defaultValue={sp.q || ""} placeholder="信箱、訂單編號、主旨、手機" className="sans" />
          <button className="btn" type="submit">搜尋</button>
          {(sp.q || showOwner || showTest) && <a className="btn" href="/admin/mail?tab=log">清除</a>}
        </div>
      </form>
      {log.rows.length === 0 ? (
        <Empty>還沒有紀錄{sp.q ? "（換個關鍵字試試）" : "。2026-09-05 之前寄的信沒有紀錄"}。</Empty>
      ) : (
        <div className="ad-tablebox">
          <div className="adm-table-wrap">
            <table className="adm-table maillog">
              <thead><tr><th>時間</th><th>管道</th><th>收件人</th><th>主旨／內容</th><th>結果</th><th></th></tr></thead>
              <tbody>
                {log.rows.map((r) => (
                  <tr key={r.key}>
                    <td data-label="時間" className="sans">{fmtDateTimeDash(r.created_at)}</td>
                    <td data-label="管道">
                      {r.src === "sms" ? "簡訊" : r.src === "line" ? "LINE" : "信"}
                      <span className="sub2">{r.src === "mail" ? MAIL_KIND_LABEL[r.kind] : "手動"}{r.route && MAIL_ROUTE_LABEL[r.route] ? `・${MAIL_ROUTE_LABEL[r.route]}` : ""}</span>
                    </td>
                    <td data-label="收件人" className="sans brk">
                      {r.to}
                      {r.ref_no && r.ref_no !== r.to ? <span className="sub2">{r.ref_no}</span> : null}
                    </td>
                    <td data-label="主旨／內容" className="subj">{r.subject}</td>
                    <td data-label="結果">
                      <b className={r.status === "sent" ? "ok" : r.status === "failed" ? "bad" : "skip"}>{MAIL_STATUS_LABEL[r.status]}</b>
                      {r.detail ? <span className="sub2">{r.detail}</span> : null}
                    </td>
                    <td className="acts">
                      {r.has_body && <a className="link-btn" href={`/admin/mail-log/${r.id}`} target="_blank" rel="noreferrer">看內容</a>}
                      {r.src === "mail" && r.kind === "manual" && r.status === "failed" && r.has_body && (
                        <form action={resendMailLog} className="ad-inlineform">
                          <input type="hidden" name="id" value={r.id} />
                          <ConfirmSubmit className="link-btn" message={`再寄一次給 ${r.to}？`}>重寄</ConfirmSubmit>
                        </form>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {log.more && <p className="ad-mt"><a className="btn sm" href={moreUrl}>再看 100 筆</a></p>}

      {/* 寄不到的信箱跟紀錄放在一起：兩者回答同一個問題（這封到底寄不寄得到） */}
      <div className="ad-sect"><h2>寄 不 到 的 信 箱</h2><div className="rule" /></div>
      <p className="fine">
        收到退信就把那個信箱貼進來。標了之後全站都不會再寄給它：待付款提醒、訂單通知、手寫信一律跳過，
        你也就不會再收到那個人的退信。對方哪天把信箱清乾淨了，按「恢復」就好。
      </p>
      {sp.blocked && <p className="msg-ok">已標記 {sp.blocked}，之後不會再寄給這個信箱。</p>}
      {sp.unblocked && <p className="msg-ok">已恢復 {sp.unblocked}，之後會照常寄。</p>}
      <form action={blockMailAddress} className="adm-form">
        <div className="adm-2col">
          <div className="field">
            <label>信箱</label>
            <input type="text" name="email" className="sans" placeholder="someone@gmail.com" required />
          </div>
          <div className="field">
            <label>原因（自己看的）</label>
            <input type="text" name="reason" placeholder="信箱已滿／查無此人" />
          </div>
        </div>
        <div className="adm-actions">
          <ConfirmSubmit className="danger-link" message="確定標記？之後全站都不會再寄信給這個信箱。">標記為寄不到</ConfirmSubmit>
        </div>
      </form>

      {blocked.length === 0 ? (
        <Empty>目前沒有標記寄不到的信箱。</Empty>
      ) : (
        <div className="ad-tablebox">
          <div className="adm-table-wrap">
            <table className="adm-table">
              <thead><tr><th>信箱</th><th>原因</th><th>標記時間</th><th></th></tr></thead>
              <tbody>
                {blocked.map((b) => (
                  <tr key={b.email}>
                    <td data-label="信箱" className="sans brk">{b.email}</td>
                    <td data-label="原因" className="fine">{b.reason}</td>
                    <td data-label="標記時間" className="sans">{fmtDateTimeDash(b.created_at)}</td>
                    <td className="acts">
                      <form action={unblockMailAddress}>
                        <input type="hidden" name="email" value={b.email} />
                        <button className="link-btn" type="submit">恢復</button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );

  return (
    <>
      <AdminTabs active="mail" tabs={[
        { key: "leads", label: "名單總覽", href: "/admin/leads" },
        { key: "members", label: "會員名單", href: "/admin/members" },
        { key: "mail", label: "發送", href: "/admin/mail" },
        { key: "newsletter", label: "電子報", href: "/admin/newsletter" },
        { key: "sms", label: "簡訊", href: "/admin/sms" },
        { key: "line", label: "LINE", href: "/admin/line" },
      ]} />
      <PageHead
        title="發 送"
        sub="單獨發一則給某個人：信、簡訊、LINE 都在這一頁。跟某張訂單有關的（催款、出貨、重寄繳費資訊）在訂單頁「通知客人」那一區，那裡會先告訴你對方哪些管道收得到。"
      />

      {!mailEnabled() && (
        <p className="msg-err">
          還沒設定寄信服務（SMTP），這頁可以預覽但寄不出去。請確認 Zeabur 的 SMTP_HOST／SMTP_USER／SMTP_PASS。
        </p>
      )}
      {sp.err && <p className="msg-err">{sp.err}</p>}
      {sp.ok && <p className="msg-ok">{sp.ok}</p>}
      {sp.sent && Number(sp.sent) > 0 && <p className="msg-ok">已寄出 {sp.sent} 封。</p>}
      {sp.queued && Number(sp.queued) > 0 && (
        <p className="msg-ok">正在背景寄出 {sp.queued} 封，一封約一到三秒。結果在「紀錄」分頁，過一會兒重新整理這頁就看得到。不用再按一次寄出。</p>
      )}
      {sp.failed && (
        <p className="msg-err">
          這幾封沒寄成功，請確認信箱是否正確：{sp.failed.split(",").join("、")}
        </p>
      )}

      <MailTabs initial={initialTab} mail={panelMail} sms={panelSms} line={panelLine} log={panelLog} />
    </>
  );
}
