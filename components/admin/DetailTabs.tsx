"use client";
import { useState } from "react";

/*
 * 詳情頁的版面骨架（站長 2026-09-05 挑定：手機 B 方向、桌機 A 方向）。
 *
 * 手機：狀態列底下三個分頁籤「動作／資料／紀錄」，一次只看一塊，預設停在動作，
 *       因為打開一張訂單九成是要做一件事，不是要讀資料。
 * 桌機：分頁籤隱藏，左欄動作、右欄資料與紀錄，一頁看完。
 *
 * 兩種長相是同一份 DOM，差別全部寫在 admin.css 的媒體查詢裡。
 * 不做兩份 DOM 的理由很實際：表單裡有 name 與 id，複製一份就會有兩個同名欄位，
 * 送出時後端拿到哪一個要看瀏覽器心情，這種 bug 很難查。
 */
const TABS = [
  { k: "act", label: "動作" },
  { k: "data", label: "資料" },
  { k: "log", label: "紀錄" },
] as const;

type TabKey = (typeof TABS)[number]["k"];

export default function DetailTabs({
  act, data, log, danger,
}: { act: React.ReactNode; data: React.ReactNode; log: React.ReactNode; danger?: React.ReactNode }) {
  const [tab, setTab] = useState<TabKey>("act");
  return (
    <>
      <div className="ad-seg" role="tablist" aria-label="訂單分頁">
        {TABS.map((t) => (
          <button
            key={t.k}
            type="button"
            role="tab"
            aria-selected={tab === t.k}
            aria-controls={`panel-${t.k}`}
            onClick={() => setTab(t.k)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="ad-cols" data-tab={tab}>
        <div className="col">
          <div data-panel="act" id="panel-act" role="tabpanel">{act}</div>
        </div>
        <div className="col">
          <div data-panel="data" id="panel-data" role="tabpanel">{data}</div>
          <div data-panel="log" id="panel-log" role="tabpanel">{log}</div>
        </div>
        {/* 危險動作：手機跟在「動作」最底，桌機橫跨兩欄在整頁最下面 */}
        {danger && <div className="col full" data-panel="act">{danger}</div>}
      </div>
    </>
  );
}
