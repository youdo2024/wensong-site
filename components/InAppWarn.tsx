"use client";

import { useState } from "react";
import { webviewLabel } from "@/lib/webview";

/*
 * 內建瀏覽器（FB／IG／LINE）警示，贊助頁與商店結帳頁共用。
 *
 * 資料上同樣是 LINE Pay，一般瀏覽器 6/6 成功、內建瀏覽器 20/30，
 * 而 10 筆「查無交易」全部發生在內建瀏覽器、一般瀏覽器零筆。
 * 付款前先講，不要等跳轉斷了才知道。
 *
 * 只提醒與提供複製連結，不強制、不擋流程，想直接付照樣付得下去。
 * envKind 空字串＝一般瀏覽器（或偵測失敗），什麼都不顯示。
 */
export default function InAppWarn({ envKind }: { envKind: string }) {
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);

  /* 內建瀏覽器常常拿不到 navigator.clipboard（非安全內容或 App 沒開權限），
     所以一定要留 execCommand 那條舊路，不然按了沒反應使用者只會更困惑。 */
  const copyPageLink = async () => {
    let url = "";
    try { url = location.href; } catch { return; }
    let ok = false;
    try {
      await navigator.clipboard.writeText(url);
      ok = true;
    } catch {
      try {
        const ta = document.createElement("textarea");
        ta.value = url;
        ta.setAttribute("readonly", "");
        ta.style.cssText = "position:fixed;top:0;left:0;opacity:0";
        document.body.appendChild(ta);
        ta.select();
        ta.setSelectionRange(0, url.length);
        ok = document.execCommand("copy");
        document.body.removeChild(ta);
      } catch { ok = false; }
    }
    setCopied(ok);
    /* 兩條路都失敗時（部分內建瀏覽器兩種 API 都不給），把網址直接顯示出來讓人長按選取。
       沒有這一步的話，按了完全沒反應，使用者只會以為壞掉。 */
    setCopyFailed(!ok);
    if (ok) window.setTimeout(() => setCopied(false), 3000);
  };

  if (!envKind) return null;
  /* wv＝認得出是內建瀏覽器但不知道是哪個 App（YouTube、Threads 之類），
     這時候不能亂猜名字，講「這個 App」比講錯一個名字好。 */
  const appName = webviewLabel(envKind);
  const known = envKind !== "wv";
  return (
    <div className="wv-warn">
      <b>建議改用瀏覽器開啟再付款</b>
      <p>
        你目前是從 {known ? `${appName} 的內建瀏覽器` : "某個 App 的內建瀏覽器"}開啟這一頁。
        這種內建瀏覽器在跳轉到付款頁時比較容易中斷，付了卻查不到交易的情況幾乎都發生在這裡。
      </p>
      <p>
        請按畫面右{envKind === "line" ? "下" : "上"}角的選單，選「用其他瀏覽器開啟」或「在瀏覽器中開啟」；
        找不到的話，用下面的按鈕複製連結，再自己貼到 Safari 或 Chrome 的網址列。
      </p>
      <button type="button" className="wv-copy" onClick={copyPageLink}>
        {copied ? "已複製，貼到瀏覽器網址列即可" : "複製這一頁的連結"}
      </button>
      {copyFailed && (
        <p className="wv-url">
          這個瀏覽器不讓網頁複製，請長按下面這行網址選取後複製：
          <span>{typeof window === "undefined" ? "" : window.location.href}</span>
        </p>
      )}
    </div>
  );
}
