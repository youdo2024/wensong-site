"use client";
import { useRef, useState } from "react";
import type { Copy, CopyEvent, CopyField } from "@/lib/notify-copy";

/*
 * 通知文案的一張卡（後台「通知文案」頁）。
 *
 * 這裡是 client 元件，不能 import lib/notify-copy 本體（它會拉進 lib/db 的 better-sqlite3），
 * 所以變數代入在這裡自己寫一份很小的版本，規則跟 renderCopy 一樣：中文大括號換成值，沒有的換空字。
 * 預覽用的是範例資料，不是真的訂單。
 */
const VARS = ["{姓名}", "{訂單編號}", "{金額}", "{期限}", "{付款方式}", "{帳號}", "{銀行代碼}"] as const;
const SAMPLE: Record<string, string> = {
  姓名: "王小明", 訂單編號: "YD2609010001", 金額: (1600).toLocaleString(), 期限: "2026/09/06",
  付款方式: "ATM 轉帳", 帳號: "9251262490218941", 銀行代碼: "822",
};
function render(text: string): string {
  return text.replace(/\{(姓名|訂單編號|金額|期限|付款方式|帳號|銀行代碼)\}/g, (_, k) => SAMPLE[k] ?? "");
}

/* 簡訊一則 268 字（含連結與署名約 80 字），文案本身超過 180 字就會被拆成兩則 */
const SMS_LIMIT = 268;
const SMS_RESERVED = 80;
const SMS_SAFE = SMS_LIMIT - SMS_RESERVED;

const LABELS: Record<CopyField, string> = {
  subject: "主旨", p1: "第一段", btn: "按鈕文字", btn2: "第二顆按鈕文字", line: "LINE", sms: "簡訊",
};
const TEXTAREAS: CopyField[] = ["p1", "line", "sms"];

export default function NotifyCopyCard({
  event, label, hasSms, defaults, initial,
}: {
  event: CopyEvent; label: string; hasSms: boolean; defaults: Copy; initial: Copy;
}) {
  const [val, setVal] = useState<Copy>(initial);
  const refs = useRef<Partial<Record<CopyField, HTMLInputElement | HTMLTextAreaElement | null>>>({});

  const fields: CopyField[] = ["subject", "p1"];
  if (defaults.btn) fields.push("btn");
  if (defaults.btn2) fields.push("btn2");
  fields.push("line");
  if (hasSms) fields.push("sms");

  const shown = (f: CopyField) => val[f] || defaults[f];
  const set = (f: CopyField, v: string) => setVal((s) => ({ ...s, [f]: v }));

  /* 把變數插到該格的游標處；該格還是空的（顯示預設）時，先把預設帶進來再插，不然使用者會以為預設不見了 */
  const insert = (f: CopyField, v: string) => {
    const el = refs.current[f];
    const base = val[f] || defaults[f];
    const start = el && val[f] ? el.selectionStart ?? base.length : base.length;
    const end = el && val[f] ? el.selectionEnd ?? start : base.length;
    const next = base.slice(0, start) + v + base.slice(end);
    set(f, next);
    requestAnimationFrame(() => {
      const e = refs.current[f];
      if (!e) return;
      e.focus();
      const pos = start + v.length;
      e.setSelectionRange(pos, pos);
    });
  };

  const reset = () => setVal({ subject: "", p1: "", btn: "", btn2: "", line: "", sms: "" });
  const smsLen = hasSms ? render(shown("sms")).length : 0;

  return (
    <section className="adm-card field">
      <h3 className="f">{label}</h3>
      <p className="fine">
        灰字是預設，留空就用預設。
        {" "}
        <button type="button" className="link-btn" onClick={reset}>還原預設</button>
      </p>

      {fields.map((f) => (
        <div className="field" key={f}>
          <label htmlFor={`ncopy_${event}_${f}`}>{LABELS[f]}</label>
          {TEXTAREAS.includes(f) ? (
            <>
              <textarea
                id={`ncopy_${event}_${f}`}
                className="ta-s"
                name={`ncopy_${event}_${f}`}
                value={val[f]}
                placeholder={defaults[f]}
                onChange={(e) => set(f, e.target.value)}
                ref={(el) => { refs.current[f] = el; }}
              />
              {f === "sms" && (
                smsLen > SMS_SAFE ? (
                  <p className="msg-err">代入範例後 {smsLen} 字，超過 {SMS_SAFE} 字。連結與署名還要約 {SMS_RESERVED} 字，這則簡訊會被拆成兩則計費。</p>
                ) : (
                  <p className="fine">代入範例後 {smsLen} 字，還可以再寫 {SMS_SAFE - smsLen} 字（連結與署名另外約 {SMS_RESERVED} 字，一則上限 {SMS_LIMIT} 字）。</p>
                )
              )}
              <div className="adm-actions">
                {VARS.map((v) => (
                  <button type="button" className="btn sm" key={v} onClick={() => insert(f, v)}>{v}</button>
                ))}
              </div>
            </>
          ) : (
            <input
              id={`ncopy_${event}_${f}`}
              type="text"
              name={`ncopy_${event}_${f}`}
              value={val[f]}
              placeholder={defaults[f]}
              onChange={(e) => set(f, e.target.value)}
              ref={(el) => { refs.current[f] = el; }}
            />
          )}
        </div>
      ))}

      <div className="callout">
        <b>預覽（範例資料）</b>
        {(["subject", "p1", "line", ...(hasSms ? (["sms"] as CopyField[]) : [])] as CopyField[]).map((f) => (
          <div key={f}>
            <b>{LABELS[f]}：</b>
            {render(shown(f)).split("\n").map((ln, i) => (
              <span key={i}>{i > 0 && <br />}{ln}</span>
            ))}
          </div>
        ))}
        {fields.includes("btn") && (
          <div>
            <b>按鈕：</b>{shown("btn")}{fields.includes("btn2") && `　／　${shown("btn2")}`}
          </div>
        )}
      </div>
    </section>
  );
}
