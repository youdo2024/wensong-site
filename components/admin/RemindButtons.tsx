import ConfirmSubmit from "@/components/ConfirmSubmit";
import SmsAppButton from "@/components/admin/SmsAppButton";
import { remindVia } from "@/app/admin/remind-actions";
import { loadOrderTarget, loadSponsorTarget, channelsOf, smsDraftFor, type Kind } from "@/lib/remind";

/*
 * 手動提醒的三顆鈕（站長 2026-09-04）：LINE／Email／簡訊，各自只走那一個管道。
 * 簡訊按下去先選：訊息 App（自己的手機，內容填好）或 電子豹簡訊（系統發）。
 * 管道不通的鈕反灰、旁邊寫原因。提醒中心、訂單列表、贊助列表共用。
 * back＝做完回哪一頁：remind／orders／sponsors。
 */
export default function RemindButtons({ kind, id, back, f = "" }: { kind: Kind; id: number; back: "remind" | "orders" | "sponsors"; f?: string }) {
  const t = kind === "order" ? loadOrderTarget(id) : loadSponsorTarget(id);
  if (!t) return null;
  const ch = channelsOf(t);
  const failed = t.status !== "pending";
  const seq = Math.min(3, t.remind_seq + 1);
  const many = !failed && t.remind_seq >= 3;
  const draft = smsDraftFor(t);
  const hidden = (channel: string) => (
    <>
      <input type="hidden" name="id" value={t.id} />
      <input type="hidden" name="kind" value={t.kind} />
      <input type="hidden" name="channel" value={channel} />
      <input type="hidden" name="back" value={back} />
      {f && <input type="hidden" name="f" value={f} />}
    </>
  );
  const one = (channel: "mail" | "line", label: string, ok: boolean, why: string) => (
    <form action={remindVia} className="rb-form">
      {hidden(channel)}
      {!ok ? (
        <button type="submit" className="btn sm" disabled title={why}>{label}</button>
      ) : many ? (
        <ConfirmSubmit className="btn sm" message={`已經提醒過 ${t.remind_seq} 次，確定再用 ${label} 提醒？`}>{label}</ConfirmSubmit>
      ) : (
        <button type="submit" className="btn sm" title={failed ? `用 ${label} 寄付款失敗通知` : `用 ${label} 寄第 ${seq} 次提醒`}>{label}</button>
      )}
      {!ok && <span className="rb-why">{why}</span>}
    </form>
  );
  return (
    <div className="remind-btns">
      <div className="rb-row">
        {one("line", "LINE", ch.line.ok, ch.line.why)}
        {one("mail", "Email", ch.mail.ok, ch.mail.why)}
        <details className="smspick">
          <summary className="btn sm">簡訊</summary>
          <div className="smspick-in">
            <SmsAppButton kind={t.kind} id={t.id} phone={draft.phone} text={draft.text} disabled={!draft.phone} why="沒留電話" />
            <form action={remindVia} className="rb-form">
              {hidden("sms")}
              <button type="submit" className="btn sm" disabled={!ch.sms.ok} title={ch.sms.ok ? "由電子豹發送" : ch.sms.why}>電子豹簡訊</button>
            </form>
            {!draft.phone ? <span className="rb-why">沒留電話</span> : !ch.sms.ok ? <span className="rb-why">電子豹：{ch.sms.why}</span> : null}
          </div>
        </details>
      </div>
      <div className="rb-cap">
        {failed ? "已失敗：按了寄「換個方式再試」" : t.remind_seq > 0 ? `已提醒 ${t.remind_seq} 次，下一則是第 ${seq} 次${t.remind_seq >= 3 ? "（三次寄完）" : ""}` : "還沒提醒過，按了寄第 1 次"}
      </div>
    </div>
  );
}
