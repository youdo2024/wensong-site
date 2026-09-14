"use client";
import { useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import Ico from "./Ico";

/*
 * 黏在底部的儲存列。放在表單裡面，會自己找外層的 <form>。
 *
 * 為什麼要數「幾項還沒儲存」：設定頁一頁 25 個開關、一顆儲存管全部，
 * 站長改完滑到底常常忘了按，改了等於沒改。有數字才知道自己動過幾格。
 * 判斷方式是拿現在的值跟第一次渲染時的值比，不是聽 input 事件次數：
 * 改回原值就不該再亮，「亮著但其實沒差別」會讓這個提示變成雜訊。
 *
 * 第二件事（ia.md §2）：改了沒存要離開，跳三選「儲存後離開／不存離開／留下」。
 * 不自動丟、不自動存，兩種都會在站長沒看到的地方做掉他的決定。
 * 站內的連結（側欄、抽屜、底欄）自己攔下來畫對話框；分頁關閉與上一頁攔不到，
 * 只能靠瀏覽器原生的 beforeunload，那句話的文字是瀏覽器決定的，改不了。
 * 不用 window.confirm：它只有兩個選項，塞不下第三個「儲存後離開」。
 */
export default function StickySave({
  label = "儲存", guard = true, children,
}: {
  label?: string;
  /* 未儲存攔截。同一頁有多個表單時只讓其中一個開，不然會互相攔 */
  guard?: boolean;
  children?: React.ReactNode;
}) {
  const box = useRef<HTMLDivElement>(null);
  const initial = useRef<Map<string, string> | null>(null);
  const snap = useRef<() => Map<string, string>>(() => new Map());
  const [dirty, setDirty] = useState(0);
  /* 被攔下來的目的地。空字串＝沒有對話框 */
  const [ask, setAsk] = useState("");
  /* 按了「儲存後離開」要去哪。存完（pending 由 true 轉 false）才走 */
  const goAfter = useRef("");
  const wasPending = useRef(false);
  /* 自己發動的離開：beforeunload 不要再問一次 */
  const leaving = useRef(false);
  const { pending } = useFormStatus();
  const router = useRouter();

  useEffect(() => {
    const form = box.current?.closest("form");
    if (!form) return;
    /* 表單元素的目前值：checkbox 與 radio 看勾沒勾，其他看字串 */
    const snapshot = () => {
      const m = new Map<string, string>();
      form.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>("input,select,textarea").forEach((el, i) => {
        if (el instanceof HTMLInputElement && (el.type === "checkbox" || el.type === "radio")) m.set(`${i}:${el.name}`, el.checked ? "1" : "0");
        else if (el instanceof HTMLInputElement && el.type === "hidden") return; /* 隱藏欄位不是使用者改的，不算 */
        else m.set(`${i}:${el.name}`, el.value);
      });
      return m;
    };
    snap.current = snapshot;
    initial.current = snapshot();
    const recount = () => {
      const now = snapshot();
      let n = 0;
      now.forEach((v, k) => { if (initial.current?.get(k) !== v) n++; });
      setDirty(n);
    };
    form.addEventListener("input", recount);
    form.addEventListener("change", recount);
    return () => {
      form.removeEventListener("input", recount);
      form.removeEventListener("change", recount);
    };
  }, []);

  /* 存完之後：把基準線重設（不然存完還亮著「有 N 項沒儲存」），該續走的就續走 */
  useEffect(() => {
    if (pending) { wasPending.current = true; return; }
    if (!wasPending.current) return;
    wasPending.current = false;
    initial.current = snap.current();
    setDirty(0);
    const href = goAfter.current;
    goAfter.current = "";
    if (href) {
      leaving.current = true;
      if (href.startsWith("/")) router.push(href);
      else window.location.href = href;
    }
  }, [pending, router]);

  /* 有未儲存改動時才掛攔截：沒改動的時候點側欄要能直接走，不要多一個對話框 */
  useEffect(() => {
    if (!guard || dirty === 0) return;
    const onClick = (e: MouseEvent) => {
      /* 新分頁、右鍵、修飾鍵一律放行：那些不會離開這一頁，攔了只是擋路 */
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as HTMLElement | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || !a.closest(".adm")) return;
      if (a.target && a.target !== "_self") return;
      const href = a.getAttribute("href") || "";
      if (!href || href.startsWith("#")) return;
      /*
       * 只 preventDefault、不 stopPropagation。next/link 看到 defaultPrevented 就不會跳頁，
       * 這樣就夠了；把事件擋死的話手機抽屜收不到自己的點擊、會停在原地不關，
       * 使用者選了「不存離開」之後新的一頁還蓋著一層舊選單。
       */
      e.preventDefault();
      setAsk(href);
    };
    const onLeave = (e: BeforeUnloadEvent) => {
      if (leaving.current) return;
      e.preventDefault();
      e.returnValue = "";
    };
    /* 捕獲階段：Link 自己的 onClick 先跑的話就來不及攔了 */
    document.addEventListener("click", onClick, true);
    window.addEventListener("beforeunload", onLeave);
    return () => {
      document.removeEventListener("click", onClick, true);
      window.removeEventListener("beforeunload", onLeave);
    };
  }, [guard, dirty]);

  const leaveNow = () => {
    const href = ask;
    setAsk("");
    leaving.current = true;
    if (href.startsWith("/")) router.push(href);
    else window.location.href = href;
  };

  return (
    <div className={`ad-save${dirty > 0 ? " dirty" : ""}`} ref={box}>
      <div className="in">
        <span className="note">
          {dirty > 0 ? <><Ico n="alert" size={16} />有 {dirty} 項還沒儲存</> : <>沒有未儲存的改動</>}
        </span>
        {children || <button className="btn fill" type="submit">{label}</button>}
      </div>

      {ask && (
        <div className="ad-ask" role="dialog" aria-modal="true" aria-label="有未儲存的改動">
          <div className="in">
            <b>有 {dirty} 項還沒儲存</b>
            <p>離開這一頁，這些改動就沒了。</p>
            <div className="acts">
              {/* 這一顆是真的 submit：走表單原本的驗證與 action，存完才由上面的效果續走 */}
              <button
                className="btn fill"
                type="submit"
                disabled={pending}
                onClick={() => { goAfter.current = ask; }}
              >
                {pending ? "儲存中…" : "儲存後離開"}
              </button>
              <button className="btn danger" type="button" onClick={leaveNow}>不存離開</button>
              <button className="btn" type="button" onClick={() => setAsk("")}>留下</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
