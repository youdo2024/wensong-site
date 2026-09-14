"use client";
import { useEffect, useRef, useState } from "react";
import { mailTabFromParams, type MailTab } from "./list-fmt";

/*
 * 發送頁的四個分頁：信／簡訊／LINE／紀錄。
 *
 * ia.md §3 說一頁只做一件事，站長補了一句「入口可以多，但要分好組」。
 * 這一頁的四件事對象是同一個人、目的是同一個（單獨通知某人），拆成四頁的話
 * 站長每次都要先想「他有沒有綁 LINE」才知道要點哪一頁，反而更難用。
 * 所以合在一頁，但同時只看得到一塊，長相跟訂單詳情的「動作／資料／紀錄」同一套（44px）。
 *
 * 四個面板都是伺服器算好的內容用 children 傳進來，這裡只負責顯示哪一塊。
 * 不做成四份 DOM 只顯示一份的話會有兩個同名表單欄位；做成四份 DOM 都留著、
 * 用 CSS 藏三份也不行：藏起來的 <input required> 照樣會擋住送出，而且瀏覽器
 * 沒辦法把焦點移到看不見的欄位，表單會靜靜地送不出去。所以只掛載當下那一塊。
 */
const TABS: { k: MailTab; label: string }[] = [
  { k: "mail", label: "信" },
  { k: "sms", label: "簡訊" },
  { k: "line", label: "LINE" },
  { k: "log", label: "紀錄" },
];

export default function MailTabs({
  initial, mail, sms, line, log,
}: {
  initial: MailTab;
  mail: React.ReactNode;
  sms: React.ReactNode;
  line: React.ReactNode;
  log: React.ReactNode;
}) {
  const [tab, setTab] = useState<MailTab>(initial);
  const panels: Record<MailTab, React.ReactNode> = { mail, sms, line, log };

  /*
   * 錨點只有瀏覽器讀得到（伺服器拿不到 #），所以掛載後自己再判一次。
   * 只認第一次：站長之後自己切到別的分頁時，網址上那個 #log 不可以又把他拉回紀錄。
   */
  const jumped = useRef(false);
  useEffect(() => {
    if (jumped.current) return;
    jumped.current = true;
    if (window.location.hash) {
      const want = mailTabFromParams({}, window.location.hash);
      if (want === "log") setTab("log");
    }
  }, []);

  return (
    <>
      <div className="ad-tabseg" role="tablist" aria-label="發送方式">
        {TABS.map((t) => (
          <button
            key={t.k}
            type="button"
            role="tab"
            aria-selected={tab === t.k}
            aria-controls={`mailpanel-${t.k}`}
            onClick={() => setTab(t.k)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="ad-tabpanel" id={`mailpanel-${tab}`} role="tabpanel">
        {panels[tab]}
      </div>
    </>
  );
}
