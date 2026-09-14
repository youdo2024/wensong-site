"use client";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

/*
 * 手機上表格的兩種看法（站長 2026-09-04：「卡片很棒，但有時還是要看表格統計式」）。
 * 預設卡片；按一下切成表格（橫向捲動），選擇記在這支手機的 localStorage。
 * 做法是在 .adm 根元素掛 class "tbl"，admin.css 的卡片規則只在沒有 tbl 時生效。
 * 桌機不顯示這顆（桌機本來就是表格）。
 */
export default function ViewToggle() {
  const [table, setTable] = useState(false);
  /* 頁面上根本沒有表格（總覽、詳情、提醒中心）就不顯示：掛載後看一眼 DOM，比列網址清單可靠 */
  const [hasTable, setHasTable] = useState(true);
  /* 詳情頁（網址最後一段是數字）沒有表格可切，這顆鈕在那裡只是雜訊 */
  const pathname = usePathname() || "";
  /* 設定六頁與目錄頁也一樣：那裡的表格都是 wide（費率表、環境總覽），切了不會有變化 */
  const detail = /^\/admin\/[a-z-]+\/\d+/.test(pathname) || pathname.startsWith("/admin/settings") || pathname === "/admin";
  useEffect(() => {
    let v = false;
    try { v = localStorage.getItem("adm_view") === "table"; } catch { v = false; }
    setTable(v);
    document.querySelector(".adm")?.classList.toggle("tbl", v);
    setHasTable(Boolean(document.querySelector(".adm .adm-table:not(.kv), .adm .ad-tablebox")));
  }, []);
  const flip = () => {
    const v = !table;
    setTable(v);
    document.querySelector(".adm")?.classList.toggle("tbl", v);
    try { localStorage.setItem("adm_view", v ? "table" : "cards"); } catch { /* 私密模式存不了就算了 */ }
  };
  if (detail || !hasTable) return null;
  return (
    <button type="button" className="adm-viewtoggle" onClick={flip} aria-pressed={table} title="切換表格與卡片">
      {table ? "切回卡片" : "看表格"}
    </button>
  );
}
