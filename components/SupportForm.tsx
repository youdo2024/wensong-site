"use client";
import { useEffect, useRef, useState } from "react";
import { createSponsorship } from "@/app/support/actions";
import { dollar } from "@/lib/format";
import { fbTrack } from "@/components/MetaPixel";
import { inAppBrowser } from "@/lib/webview";
import InAppWarn from "./InAppWarn";
import EmailField from "./EmailField";
import InvoicePicker from "./InvoicePicker";

const DEFAULT_PAYS = ["信用卡", "LINE Pay", "Apple Pay", "銀行轉帳"];
/* 多元支付（TWQR）可用的錢包，顯示在按鈕下方 */
const TWQR_WALLETS = ["台灣Pay", "街口", "全支付", "一卡通", "悠遊付"];

import PayChip from "@/components/PayChip";

export default function SupportForm({
  tiers,
  initAmount,
  initMode,
  initShowCustom = false,
  pays = DEFAULT_PAYS,
  provider = "payuni",
  monthlyExternal = "",
  modeTabs = false,
  bare = false,
}: {
  tiers: number[];
  initAmount: number;
  initMode: "monthly" | "once";
  initShowCustom?: boolean;
  pays?: string[];
  provider?: "portaly" | "payuni" | "ecpay";
  /* 綜合模式：每月定額導去的外部頁面；空字串＝定額照舊留在站內 */
  monthlyExternal?: string;
  /* 首頁嵌入用：把小小的模式切換連結換成兩顆大分頁鈕（每月定額／單筆支持） */
  modeTabs?: boolean;
  /* 已經放在別的信封框裡：不再自帶外框與上下色帶 */
  bare?: boolean;
}) {
  const portaly = provider === "portaly";
  const ecpay = provider === "ecpay";
  const creditOn = portaly || pays.includes("信用卡");
  /* 定額走外部頁時不需要站內信用卡也能選定額 */
  const canMonthly = creditOn || Boolean(monthlyExternal);
  const [monthly, setMonthly] = useState(initMode === "monthly" && canMonthly);
  const [amount, setAmount] = useState<number | null>(initShowCustom ? null : tiers.includes(initAmount) ? initAmount : null);
  const [custom, setCustom] = useState(tiers.includes(initAmount) ? "" : String(initAmount));
  const [showCustom, setShowCustom] = useState(initShowCustom || (!tiers.includes(initAmount) && initAmount > 0));
  const [payList, setPayList] = useState<string[]>(pays);
  const [pay, setPay] = useState(pays[0] || "信用卡");
  const [submitting, setSubmitting] = useState(false);
  const [phone, setPhone] = useState("");
  const [phoneBad, setPhoneBad] = useState(false);
  const phoneRef = useRef<HTMLInputElement | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  /* InitiateCheckout 只在「送出表單」那一刻發，而且帶得到金額。
     切換長期／單次分頁曾經也發一次（不帶金額），結果同一次瀏覽會送出兩筆同名事件，
     漏斗會被灌水而且其中一筆沒有價值可歸因，已移除。
     唯一例外是綜合模式那顆外連的「長期支持」，它離站後不會再經過表單，見下方標記。 */
  /* 來源頁記錄（後台歸因用）：掛載時填一次路徑，純同步、零延遲；JS 沒跑就是空字串，無任何影響 */
  const [srcPath, setSrcPath] = useState("");
  useEffect(() => { try { setSrcPath(location.pathname); } catch { /* 忽略 */ } }, []);
  /* 內建瀏覽器（FB/IG/LINE）：Apple Pay 無法完成一律隱藏、ATM（零失敗）提前到信用卡前，
     並記錄環境供後台歸因。偵測失敗一律當一般瀏覽器，不影響任何流程。 */
  const [envKind, setEnvKind] = useState("");
  /* Apple Pay 只給真的能付的裝置看（Safari／iOS 16 以上）。綠界頁在其他瀏覽器不會顯示 Apple Pay，
     客人選了會卡在綠界頁，所以在這裡就先不給選 */
  useEffect(() => {
    try {
      const w = window as unknown as { ApplePaySession?: { canMakePayments?: () => boolean } };
      if (!(w.ApplePaySession && w.ApplePaySession.canMakePayments && w.ApplePaySession.canMakePayments())) {
        setPayList((list) => list.filter((x) => x !== "Apple Pay"));
      }
    } catch { setPayList((list) => list.filter((x) => x !== "Apple Pay")); }
  }, []);
  useEffect(() => {
    const env = inAppBrowser();
    if (!env.inApp) return;
    setEnvKind(env.kind);
    setPayList((list) => {
      /*
       * 內建瀏覽器裡把刷卡類全部拿掉，只留 LINE Pay 與 ATM。
       *
       * 依據是實際資料：內建瀏覽器裡刷卡四個人嘗試只有一個人成功，
       * 而同一批人的 LINE Pay 是 4/4；一般瀏覽器裡刷卡則是 4/5。
       * 贊助那邊獨立量到的方向一致（內建信用卡 33%、LINE Pay 67%）。
       *
       * 「不要剝奪選擇」這個說法在這裡站不住：給他一個八成會失敗的選項，
       * 失敗之後多數人不會換瀏覽器重試，他們就走了。想刷卡的人還是有出路，
       * 上面的警示會告訴他用 Safari 或 Chrome 開這一頁。
       */
      let l = list.filter((x) => x !== "Apple Pay" && x !== "信用卡");
      /* 保險：後台若把 LINE Pay 與 ATM 都停用了，濾完會是空的。
         總不能讓人沒有任何付款方式，那時候就維持原樣。 */
      if (l.length === 0) return list;
      const ai = l.indexOf("ATM 轉帳");
      const ci = l.indexOf("信用卡");
      if (ai > -1 && ci > -1 && ai > ci) {
        l = l.filter((x) => x !== "ATM 轉帳");
        l.splice(l.indexOf("信用卡"), 0, "ATM 轉帳");
      }
      return l;
    });
    /*
     * Apple Pay 在內建瀏覽器裡無法完成，隱藏後改選 LINE Pay。
     *
     * 曾經改成優先選 ATM，理由是「LINE Pay 要跳出去開 App，內建瀏覽器容易斷」。
     * 但補上瀏覽器環境欄位、取得實際資料後，這個推論被推翻了：
     * 8/10 起的有效樣本裡，內建瀏覽器內各付款方式的成功率是
     *   LINE Pay 20/30＝67%、信用卡 1/3＝33%、ATM 2/2（樣本太小不可採信）。
     * 也就是說 LINE Pay 反而是內建瀏覽器裡表現最好的一種，把人推去別的方式
     * 只會更糟，所以改回來。
     *
     * 內建瀏覽器確實有問題，但問題不在「選了哪種付款方式」：
     * 同樣是 LINE Pay，一般瀏覽器 6/6＝100%、內建 20/30＝67%，
     * 而 10 筆 1150（查無交易）全部發生在內建瀏覽器、一般瀏覽器零筆。
     * 真正該解的是讓人跳出內建瀏覽器，不是換付款方式。
     */
    setPay((x) => {
      if (x !== "Apple Pay") return x; // 使用者已經自己選過的，不去干涉
      if (pays.includes("LINE Pay")) return "LINE Pay";
      if (pays.includes("信用卡")) return "信用卡";
      /* 這兩種都被後台關掉時，至少不要停在已經被隱藏的 Apple Pay 上，
         否則畫面會變成沒有任何一個付款方式被選中（這是既有問題，與上面無關） */
      return pays.filter((p) => p !== "Apple Pay")[0] || x;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* Apple Pay 只在支援的裝置（Safari／蘋果裝置）顯示，其他人看不到才不會困惑 */
  useEffect(() => {
    if (!ecpay) return;
    const w = window as unknown as { ApplePaySession?: { canMakePayments?: () => boolean } };
    /* Safari 在非 HTTPS 頁面（本機開發）呼叫 canMakePayments 會直接丟 InvalidAccessError */
    let ok = false;
    try {
      ok = Boolean(w.ApplePaySession && w.ApplePaySession.canMakePayments && w.ApplePaySession.canMakePayments());
    } catch {
      ok = false;
    }
    if (!ok) {
      setPayList((list) => list.filter((p) => p !== "Apple Pay"));
      setPay((p) => (p === "Apple Pay" ? "信用卡" : p));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const finalAmount = amount ?? (Number(custom) || 0);
  const phoneOk = (v: string) => /^09\d{8}$/.test(v.replace(/[\s-]/g, ""));

  function toggleMode() {
    const next = !monthly;
    setMonthly(next);
    if (next && pay !== "信用卡") setPay("信用卡");
    /* Portaly 每月定額走固定方案，只能選四階金額，切回時清掉自訂 */
    if (next && portaly && amount === null) {
      setAmount(tiers[0] ?? null);
      setCustom("");
      setShowCustom(false);
    }
  }

  return (
    <form
      ref={formRef}
      className={bare ? undefined : "box"}
      action={createSponsorship}
      onSubmit={(e) => {
        /*
         * 送出前在前端先擋。
         *
         * 為什麼非做不可：這是原生表單，伺服器端驗證失敗只能 redirect 回
         * /support?error=…，那一趟會把整頁重載——客人選的長期／單次、金額、
         * 名稱、留言、發票選項全部回到預設值，等於要他從頭再填一次。
         * 只是手機少打一碼，代價是整張表單重來，那種挫折感直接換成放棄。
         *
         * 伺服器那邊的檢查一行都沒拿掉，它擋的是繞過瀏覽器的請求。
         */
        if (!phoneOk(phone)) {
          e.preventDefault();
          setPhoneBad(true);
          phoneRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
          phoneRef.current?.focus({ preventScroll: true });
          return;
        }
        setSubmitting(true);
        /* Meta 轉換漏斗的中繼點：按下送出＝開始結帳（金額當下已確定） */
        fbTrack("InitiateCheckout", finalAmount);
      }}
    >
      {!bare && <div className="band" />}
      <div className={bare ? undefined : "inner"}>
        <input type="hidden" name="source" value={srcPath} />
      {envKind && <input type="hidden" name="env" value={envKind} />}
        <input type="hidden" name="mode" value={monthly ? "monthly" : "once"} />
        <input type="hidden" name="amount" value={finalAmount} />
        <input type="hidden" name="pay_method" value={monthly ? "信用卡" : pay} />
        {/* invoice_type 由 actions.ts 依 inv_kind 推導（打統編才是 b2b），這裡不再寫死 */}

        {modeTabs ? (
          <div className="pays" style={{ gridTemplateColumns: "1fr 1fr", marginBottom: monthly && monthlyExternal ? 4 : 20 }}>
            {/* 定額走外部頁時，「每月定額」本身就是連結，點了直接前往，不再多一顆下一步 */}
            {monthlyExternal ? (
              /*
               * 這顆是離站連結，點了就前往外部贊助頁。
               *
               * 原本這裡也發一次 InitiateCheckout，理由是「它與送出表單互斥」。
               * 那個假設是錯的：點了之後按上一頁回來、再改成單次支持送出，
               * 同一次瀏覽就會送出兩次，一次不帶金額、一次帶金額。
               * Meta 後台看到的是虛胖的漏斗中段，還混著一堆金額為 0 的事件。
               *
               * 現在只留「按下送出」那一次。代價是導去外部頁的這條路完全沒有事件，
               * 但那條路的轉換本來就發生在站外、像素也追不到，
               * 留一個追不到結果的中繼點只是讓數字更難讀。
               */
              <a className={`mode-tab long${monthly ? " on" : ""}`} href={monthlyExternal} style={{ textDecoration: "none", display: "block" }}>長期支持</a>
            ) : (
              /* button 而非 div：VoiceOver／鍵盤才能操作（iPhone 無障礙） */
              <button type="button" className={`mode-tab long${monthly ? " on" : ""}`} onClick={() => { if (!monthly && canMonthly) toggleMode(); }}>長期支持</button>
            )}
            <button type="button" className={`mode-tab once${!monthly ? " on" : ""}`} onClick={() => { if (monthly) toggleMode(); }}>單次支持</button>
          </div>
        ) : (
          <p className="mode-note">
            目前模式：<b>{monthly ? "長期支持" : "單次支持"}</b>
            {canMonthly && <a onClick={toggleMode}>{monthly ? "改為單次支持" : "改回長期支持"}</a>}
          </p>
        )}

        {monthly && monthlyExternal ? (
          /* 綜合模式的每月定額：分頁鈕本身就是連結（modeTabs），
             贊助頁（非分頁式）才需要這顆按鈕 */
          modeTabs ? (
            <p className="fine center" style={{ marginTop: 2 }}>隨時可停止</p>
          ) : (
            <div className="submit-row">
              <a className="btn fill" href={monthlyExternal}>下一步</a>
            </div>
          )
        ) : (
          <>
        <div className="amounts">
          {tiers.map((t) => (
            <div
              key={t}
              className={`amt${amount === t ? " on" : ""}`}
              onClick={() => {
                setAmount(t);
                setCustom("");
              }}
            >
              <span className="sans">{dollar(t)}</span>
            </div>
          ))}
        </div>
        {monthly && portaly ? (
          <p className="center" style={{ marginTop: 12, marginBottom: 0, fontSize: 13, color: "var(--grey)", letterSpacing: ".08em" }}>
            長期支持為固定方案，想自訂金額可改為單次支持
          </p>
        ) : showCustom ? (
          <div className="custom">
            <label>自訂金額</label>
            {/* 上下鍵與 ±鈕以 500 為一級：不能用 step=500（瀏覽器會擋掉 888 這種值），
                所以隱藏原生調節鈕、攔方向鍵自行加減。
                輸入框與按鈕直接當 .custom 的 flex 子項，不再包一層（巢狀 flex 在窄螢幕會把列擠爆跑版） */}
            <input
              className="sans no-spin"
              type="number"
              min={100}
              step="any"
              placeholder="例如：500"
              autoFocus
              value={custom}
              onKeyDown={(e) => {
                if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
                e.preventDefault();
                const d = e.key === "ArrowUp" ? 500 : -500;
                setCustom((prev) => String(Math.max(100, (Number(prev) || 0) + d)));
                setAmount(null);
              }}
              onChange={(e) => {
                setCustom(e.target.value);
                setAmount(null);
              }}
            />
            {([["−", -500], ["＋", 500]] as [string, number][]).map(([label, d]) => (
              <button
                key={label}
                type="button"
                className="amt-step"
                aria-label={`金額${d > 0 ? "增加" : "減少"} 500`}
                onClick={() => {
                  setCustom((prev) => String(Math.max(100, (Number(prev) || 0) + d)));
                  setAmount(null);
                }}
              >
                {label}
              </button>
            ))}
          </div>
        ) : (
          <p className="center" style={{ marginTop: 12, marginBottom: 0 }}>
            <a
              onClick={() => {
                setShowCustom(true);
                setAmount(null);
              }}
              style={{ fontSize: 13, color: "var(--grey)", textDecoration: "underline", textUnderlineOffset: 4, cursor: "pointer", letterSpacing: ".08em" }}
            >
              想用其他金額？自訂金額
            </a>
          </p>
        )}

        <hr className="divider" />

        {/* 內建瀏覽器（FB／IG／LINE）警示：付款前先講，不要等跳轉斷了才知道。
            資料上同樣是 LINE Pay，一般瀏覽器 6/6 成功、內建瀏覽器 20/30，
            而 10 筆「查無交易」全部發生在內建瀏覽器、一般瀏覽器零筆。
            這裡只提醒與提供複製連結，不強制、不擋流程，想直接付照樣付得下去。 */}
        <InAppWarn envKind={envKind} />

        <h3 className="f">付 款 方 式</h3>
        {portaly ? (
          <p className="fine center" style={{ marginTop: 4 }}>
            按下「下一步」後，會開啟 Portaly 安全付款頁完成刷卡{monthly ? "，之後每月自動扣款，隨時可取消" : ""}
          </p>
        ) : monthly ? (
          <div className="pays" style={{ gridTemplateColumns: "1fr" }}>
            <div className="pay on" style={{ cursor: "default", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <PayChip name="信用卡" />信用卡
            </div>
          </div>
        ) : (
          <>
            <div className="pays">
              {(ecpay ? payList.filter((p) => p !== "多元支付") : payList).map((p) => (
                <div key={p} className={`pay pay-stack${pay === p ? " on" : ""}`} onClick={() => setPay(p)}>
                  {/* 直排：圖示在上、名稱在下；LINE Pay 的組合字本身就是名字，不再重複文字（站長 2026-09-04） */}
                  <PayChip name={p} stack />{p === "LINE Pay" ? null : <span className="pay-lab">{p}</span>}
                </div>
              ))}
            </div>
            {/* 多元支付：一長條擺在格子下方，各錢包以品牌色徽章並排 */}
            {ecpay && payList.includes("多元支付") && (
              <div className={`pay multi${pay === "多元支付" ? " on" : ""}`} onClick={() => setPay("多元支付")}>
                <b>多元支付</b>
                <span className="wallets">
                  {TWQR_WALLETS.map((w) => (
                    <span key={w} className="wallet"><PayChip name={w} bare />{w}</span>
                  ))}
                </span>
              </div>
            )}
            {ecpay && pay === "ATM 轉帳" && (
              <p className="fine center" style={{ marginTop: 10 }}>
                會產生一組專屬轉帳帳號（寄到你的 Email），三天內完成轉帳即可
              </p>
            )}
          </>
        )}

        <hr className="divider" />

        <h3 className="f">支 持 者 資 訊</h3>
        <div className="field">
          <label>支持者名稱（顯示用，可匿名或自訂）</label>
          <input type="text" name="display_name" placeholder="例如：老陳、匿名支持者" />
        </div>
        <div className="field">
          <label>想對主持人說的話（選填）</label>
          <textarea name="message" placeholder="留言會讓我看到，謝謝你" />
        </div>
        <div className="field">
          <EmailField
            label={
              <label>
                Email <em>＊必填</em>（寄送收據與電子發票）
              </label>
            }
          />
        </div>

        {/*
          * 手機一律必填（站長指示 2026-08-31，原本只有滿 2,000 才問）。
          *
          * 為什麼要問：實際發生過信箱打錯、退信一封接一封，而我們手上完全沒有
          * 第二種聯絡方式，那筆錢就這樣卡著。定期定額扣款失敗、電子發票中獎通知
          * 也都是同一個問題——只有一個信箱就等於只有一條線。
          *
          * 必填就一定會少掉一些人，所以底下那三行不是客套話，是把「為什麼安全」
          * 講清楚的成本。要求資料卻不解釋用途，流失的會更多。
          */}
        <div className="field">
          <label>手機號碼 <em>＊必填</em></label>
          <input
            type="tel"
            name="phone"
            inputMode="numeric"
            autoComplete="tel"
            required
            placeholder="09xxxxxxxx"
            value={phone}
            maxLength={10}
            /* 只收數字、上限 10 碼。連字號、空格、貼上來的 +886 都在這裡就清掉，
               客人不會打完才被退回，也省掉伺服器端一次來回 */
            onChange={(e) => { setPhone(e.target.value.replace(/\D/g, "").slice(0, 10)); setPhoneBad(false); }}
            onBlur={(e) => setPhoneBad(e.target.value.trim() !== "" && !phoneOk(e.target.value))}
            ref={phoneRef}
          />
          {phoneBad && <p className="field-err">請填 10 碼手機號碼，09 開頭（例如 0912345678）。</p>}
          {/* 站長指定的文字，只留這一句 */}
          <p className="fine" style={{ margin: "8px 0 0", lineHeight: 1.95 }}>
            用於在發票中獎聯絡不到你、Email 錯誤、扣款失敗等相關網站業務
          </p>
        </div>

        {/* 電子發票：站長 2026-08-31 指示裝回來。伺服器（app/support/actions.ts）
            本來就支援四種，之前是被一行寫死的 inv_kind=email 蓋住 */}
        <InvoicePicker />

        {/*
          * 電子報訂閱。預設打勾，跟結帳頁同一套。
          *
          * 條款第八條第 8 款已經載明「支持方案提供之 Email 得用於寄送最新消息」，
          * 所以法律上不放這個框也成立。放的理由是別的：只寫在條款裡的同意，
          * 客人收到信的第一反應是「這誰啊」，然後按檢舉；
          * 看過一個自己可以取消的勾選框，反應就變成「喔對我有勾」。
          * 一個框的成本，換掉整個網域信譽的風險。
          */}
        <div className="field">
          {/* 站長 2026-09-04：灰框透明底灰勾、跟文字同高；不用 label 包，按文字不會切換，只有方框會。
              勾了同時代表收電子報，以及付款完成直接導去加 LINE */}
          <div className="soft-chk">
            <input type="checkbox" name="newsletter" value="1" defaultChecked aria-label="同意接收通知" />
            <span>
              如有抽獎或發票中獎聯絡不到你、Email 錯誤、扣款失敗等網站業務相關事項，以及新內容、產地故事等權益發送，不定期以 LINE、信箱通知，隨時可以取消。
            </span>
          </div>
        </div>

        <div className="submit-row">
          {/* 「下一步」比「前往付款」更貼近實情：按下去是跳到金流頁，還沒付完。
              底下那行提醒，是為了讓人有心理準備，減少跳轉後就放棄的情況 */}
          {/* inline-flex 才吃得到 submit-row 的 text-align:center（flex 會變滿版置左） */}
          <button
            className="btn fill"
            type="submit"
            disabled={submitting || finalAmount < 100}
            style={{ display: "inline-flex", flexDirection: "column", alignItems: "center", gap: 6, lineHeight: 1.4 }}
          >
            <span>{submitting ? "處理中…" : "下一步"}</span>
            {!submitting && (
              <span style={{ fontSize: 11.5, letterSpacing: ".06em", fontWeight: 400, border: "1px solid currentColor", padding: "2px 8px", opacity: 0.85 }}>
                請特別留意後續流程
              </span>
            )}
          </button>
        </div>
        {/* 法律聲明減到最少：只有「不適用七日猶豫期」依消保法 19 條需要事先明示同意，
            必須在按鈕附近看得到，所以留這一行小字；其餘說明收進可展開的摺疊，
            內容都在頁面上、點一下就看得到，不是藏起來 */}
        <p className="center" style={{ marginTop: 14, fontSize: 11.5, color: "var(--grey)", letterSpacing: ".04em", lineHeight: 1.9 }}>
          按下「下一步」即同意
          <a href="/terms" target="_blank" style={{ textDecoration: "underline", textUnderlineOffset: 3 }}>使用條款</a>
          第八條：數位內容一經提供即完成，不適用七日猶豫期
        </p>
        <details style={{ marginTop: 6, textAlign: "center" }}>
          <summary style={{ fontSize: 11.5, color: "var(--grey)", cursor: "pointer", letterSpacing: ".06em", listStyle: "none" }}>
            付款・發票・取消說明 ▾
          </summary>
          <p className="fine center" style={{ marginTop: 10 }}>
            付款由{portaly ? " Portaly " : ecpay ? "綠界科技（ECPay）與 LINE Pay " : "法定金流公司"}安全處理，本站不儲存你的卡號。完成後將寄送確認信與電子發票，定期定額支持者的信中附有取消訂閱連結，隨時可停止。
          </p>
          <p className="fine center" style={{ marginTop: 8, lineHeight: 2 }}>
            本服務為支持內容創作之交易行為（由於悅商行依法開立統一發票），並非捐贈或募資，不得作為捐贈申報所得稅扣除。
          </p>
        </details>
          </>
        )}
      </div>
      {!bare && <div className="band" />}
    </form>
  );
}
