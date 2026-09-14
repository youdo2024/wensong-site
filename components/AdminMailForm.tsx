"use client";
import { useEffect, useRef, useState } from "react";
import { sendAdminMail } from "@/app/admin/actions";

/*
 * 後台手寫信的表單，右邊是即時預覽。
 *
 * 預覽是把伺服器產生的 HTML 塞進 iframe 的 srcDoc，不是在這裡重畫一份版型。
 * 前端自己畫的話兩份遲早會不一樣，然後你看到的跟收件人收到的就不同了。
 *
 * 2026-09-06 改版第五批：手機把預覽收進 <details>，因為原本它固定長在表單下面，
 * 402 寬要往下捲過一整封信才碰得到寄出鈕。桌機仍然是右邊一直開著的那一欄。
 * 欄位名、server action、預覽 API 一個都沒有換。
 */
export default function AdminMailForm({ max, presetTo = "", fill }: {
  max: number; presetTo?: string;
  /* 「帶入已付款未出貨的客人」：伺服器算好名單傳進來，按了合併進收件人欄（去重） */
  fill?: { label: string; emails: string[]; hint?: string };
}) {
  const [to, setTo] = useState(presetTo);
  const [subject, setSubject] = useState("");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [btnText, setBtnText] = useState("");
  const [btnUrl, setBtnUrl] = useState("");
  const [footnote, setFootnote] = useState("");
  const [html, setHtml] = useState("");
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | null>(null);

  /*
   * 預覽的開合：桌機開、手機關。
   *
   * 為什麼用 matchMedia 而不是 CSS：關著的 <details> 內容藏不藏是瀏覽器內部決定的，
   * CSS 蓋不掉，所以「手機收合、桌機展開」沒辦法只靠媒體查詢做出來。
   * 伺服器端沒有視窗寬度，先預設開著（桌機的樣子），掛載後再依實際寬度修正，
   * 這樣桌機不會閃一下才打開。之後站長自己按開或按關，onToggle 會跟著記住。
   */
  const [prevOpen, setPrevOpen] = useState(true);
  useEffect(() => {
    const mq = window.matchMedia("(min-width:841px)");
    const sync = () => setPrevOpen(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  /* 邊打邊預覽會打一個字送一次請求，所以延遲 400 毫秒再送 */
  useEffect(() => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(async () => {
      try {
        const res = await fetch("/api/admin/mail-preview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title, body, btnText, btnUrl, footnote }),
        });
        if (res.ok) setHtml(await res.text());
      } catch { /* 預覽失敗不影響寄信，維持上一版畫面 */ }
    }, 400);
    return () => { if (timer.current) window.clearTimeout(timer.current); };
  }, [title, body, btnText, btnUrl, footnote]);

  const count = to.split(/[\n,，;；\s]+/).map((s) => s.trim()).filter(Boolean).length;

  const fillIn = () => {
    if (!fill?.emails.length) return;
    const have = new Set(to.split(/[\n,，;；\s]+/).map((s) => s.trim().toLowerCase()).filter(Boolean));
    const add = fill.emails.filter((e) => !have.has(e.toLowerCase()));
    setTo([to.trim(), ...add].filter(Boolean).join("\n"));
  };

  const copyHtml = async () => {
    try {
      await navigator.clipboard.writeText(html);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch { setCopied(false); }
  };

  return (
    <div className="mailgrid">
      <form action={sendAdminMail} className="adm-form">
        <div className="field full">
          <label>收件人（一行一個，最多 {max} 位）</label>
          <textarea
            name="to"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="ta-s"
            placeholder={"someone@gmail.com\nanother@yahoo.com.tw"}
            required
          />
          <p className={`fine${count > max ? " over" : ""}`}>
            目前 {count} 位{count > max && `　超過上限 ${max} 位，送出會被擋下`}
          </p>
          {fill && (
            <p className="ad-mt">
              <button type="button" className="btn sm" onClick={fillIn} disabled={fill.emails.length === 0}>
                {fill.label}{fill.emails.length > 0 ? ` ${fill.emails.length} 位` : "（目前沒有）"}
              </button>
            </p>
          )}
          {fill?.hint && <p className="fine">{fill.hint}</p>}
        </div>

        <div className="field full">
          <label>信件主旨（收件匣看到的那一行）</label>
          <input type="text" name="subject" value={subject} onChange={(e) => setSubject(e.target.value)} required
            placeholder="例如：關於你剛才那筆訂單（沒有扣到款）｜問爽的" />
        </div>

        <div className="field full">
          <label>信件大標（信裡最上面那行大字）</label>
          <input type="text" name="title" value={title} onChange={(e) => setTitle(e.target.value)}
            placeholder="例如：你的訂單沒有扣到款" />
        </div>

        <div className="field full">
          <label>內文</label>
          <textarea name="body" className="ta-l" value={body} onChange={(e) => setBody(e.target.value)} required
            placeholder={"直接打字就好，空一行代表分段。\n\n不用寫 HTML，版型會自動套上去。"} />
          <p className="fine">空一行分段，段落裡按 Enter 就是換行。預覽會即時更新（桌機在右邊，手機在下面那格「預覽」）。</p>
        </div>

        <div className="adm-2col">
          <div className="field">
            <label>按鈕文字（可留空）</label>
            <input type="text" name="btn_text" value={btnText} onChange={(e) => setBtnText(e.target.value)} placeholder="前往付款" />
          </div>
          <div className="field">
            <label>按鈕連結</label>
            <input type="url" name="btn_url" value={btnUrl} onChange={(e) => setBtnUrl(e.target.value)} placeholder="https://www.wensong.tw/pay/…" />
          </div>
        </div>

        <div className="field full">
          <label>按鈕下方小字（可留空）</label>
          <input type="text" name="footnote" value={footnote} onChange={(e) => setFootnote(e.target.value)}
            placeholder="例如：名額保留到 8/23" />
        </div>

        <p className="ad-sendrow">
          <button className="btn fill" type="submit">寄出給這 {count} 位</button>
          <a className="link-btn" href="#mailprev">先看預覽</a>
        </p>
        <p className="fine">
          寄出前先看預覽。信會從網站的寄信信箱送出，收件人直接回信會回到那個信箱。超過 5 位會在背景寄，結果看「紀錄」分頁。
        </p>
      </form>

      {/* 手機收合、桌機展開（開合由上面的 matchMedia 決定，桌機連 summary 都不顯示） */}
      <details className="ad-prevbox" open={prevOpen} onToggle={(e) => setPrevOpen((e.currentTarget as HTMLDetailsElement).open)}>
        <summary>預覽</summary>
        <div className="mailprev" id="mailprev">
          <div className="pv-top">
            <b className="sans">預覽</b>
            <button type="button" className="link-btn" onClick={copyHtml}>
              {copied ? "已複製 HTML" : "複製 HTML 原始碼"}
            </button>
          </div>
          <iframe title="信件預覽" srcDoc={html} />
        </div>
      </details>
    </div>
  );
}
