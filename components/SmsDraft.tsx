"use client";
import { useState } from "react";

/*
 * 一則可以直接傳出去的簡訊：內容看得到、可以改、按一下複製，
 * 或直接開手機的訊息 App（Mac 上會開「訊息」，手機上會開簡訊，號碼與內容都填好）。
 *
 * 為什麼讓它可以改：每個人的情況不完全一樣，站長常常會想加一句自己的話。
 * 草稿是省打字的，不是綁死的。
 */
export default function SmsDraft({ phone, text }: { phone: string; text: string }) {
  /* 沒有電話就傳不了簡訊（舊的贊助紀錄都沒有）。這時候只留複製，
     把內容貼到後台寄信頁去寄。留一顆按不動的按鈕比拿掉更糟。 */
  const hasPhone = Boolean(String(phone || "").replace(/[^\d+]/g, ""));
  const [body, setBody] = useState(text);
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);

  async function copy() {
    let ok = false;
    try {
      await navigator.clipboard.writeText(body);
      ok = true;
    } catch {
      /* 沒有安全內容或瀏覽器不給的時候還有這條舊路，不然按了完全沒反應 */
      try {
        const ta = document.createElement("textarea");
        ta.value = body;
        ta.setAttribute("readonly", "");
        ta.style.cssText = "position:fixed;top:0;left:0;opacity:0";
        document.body.appendChild(ta);
        ta.select();
        ta.setSelectionRange(0, body.length);
        ok = document.execCommand("copy");
        document.body.removeChild(ta);
      } catch { ok = false; }
    }
    setCopied(ok);
    setFailed(!ok);
    if (ok) window.setTimeout(() => setCopied(false), 2500);
  }

  /* iOS 與 macOS 認 &，Android 認 ?，兩個都放上去在各平台都開得起來 */
  const href = `sms:${phone.replace(/[^\d+]/g, "")}?&body=${encodeURIComponent(body)}`;

  return (
    <div className="sms-draft">
      <textarea
        className="sans"
        value={body}
        rows={Math.min(9, body.split("\n").length + 1)}
        onChange={(e) => setBody(e.target.value)}
      />
      <div className="sms-acts">
        <button type="button" className={copied ? "btn sm copied" : "btn sm"} onClick={copy}>
          {copied ? "已複製 ✓" : hasPhone ? "複製簡訊內容" : "複製內容，貼到寄信頁"}
        </button>
        {hasPhone && <a className="btn sm" href={href}>用訊息 App 開啟</a>}
        <span className="sms-len">{body.length} 字</span>
      </div>
      {failed && <p className="sms-warn">這個瀏覽器不讓網頁複製，請直接選取上面的文字複製。</p>}
    </div>
  );
}
