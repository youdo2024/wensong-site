"use client";
import { useEffect, useRef, useState } from "react";
import Ico, { type IcoName } from "./Ico";

/*
 * 動作列：這一頁能做的幾件事排在一起，點了才展開對應的表單，而且同時只展開一個。
 *
 * 為什麼要收起來：訂單詳情原本九個表單全部平鋪，每一顆送出鈕看起來都一樣重要，
 * 站長要找「改數量」得先讀完整頁。收起來之後，畫面上永遠只有一件正在做的事。
 * 手機一列一個（56px 好按），桌機四顆並排，兩種長相是同一份 DOM 用 CSS 切的，
 * 表單只有一份，不會出現兩個同 id 的欄位。
 */
export type ActionItem = {
  key: string;
  label: string;
  icon: IcoName;
  /* 右邊那句灰字：先告訴他點下去會碰到什麼，例如「Email、LINE 可用」 */
  meta?: React.ReactNode;
  /* 網址錨點：別頁用 /admin/orders/12#notify 這種連結直接指進來時，要自動展開這一個 */
  anchor?: string;
  panel: React.ReactNode;
};

export default function ActionRow({ actions, defaultOpen }: { actions: ActionItem[]; defaultOpen?: string }) {
  const [open, setOpen] = useState<string>(defaultOpen || "");
  /*
   * 別頁的深層連結（提醒中心、待聯絡、訂單列表都有 #notify）必須還能用。
   * 動作預設收起來，錨點的目標元素還沒存在，瀏覽器自己捲不到，所以這裡自己開、自己捲。
   */
  const jumped = useRef(false);
  useEffect(() => {
    /* 只認第一次：之後站長自己關掉這一格時，不可以又被錨點打開 */
    if (jumped.current) return;
    const h = window.location.hash.slice(1);
    if (!h) return;
    const hit = actions.find((a) => a.anchor === h);
    if (!hit) return;
    jumped.current = true;
    setOpen(hit.key);
    const t = setTimeout(() => document.getElementById(`act-${hit.key}`)?.scrollIntoView({ block: "center" }), 0);
    return () => clearTimeout(t);
  }, [actions]);
  const cur = actions.find((a) => a.key === open);
  return (
    <div className="ad-act">
      <div className="ad-act-list">
        {actions.map((a) => (
          <button
            key={a.key}
            type="button"
            className="ad-act-btn"
            aria-expanded={a.key === open}
            aria-controls={`act-${a.key}`}
            onClick={() => setOpen(a.key === open ? "" : a.key)}
          >
            <span className="nm"><Ico n={a.icon} />{a.label}</span>
            <span className="mt">{a.meta}<Ico n="right" size={16} /></span>
          </button>
        ))}
      </div>
      {cur && (
        <div className="ad-act-panel" id={`act-${cur.key}`}>
          {cur.panel}
        </div>
      )}
    </div>
  );
}
