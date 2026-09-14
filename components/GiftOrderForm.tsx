"use client";
import { useEffect, useRef, useState } from "react";
import { parseGiftList } from "@/lib/gift-parse";
import { phoneKind } from "@/lib/phone";
import { isCvsMethod } from "@/lib/cvs";

/*
 * 建立贈品訂單：一位收件人一組格子，按「再加一位」多一組。
 *
 * 為什麼不是貼一整塊文字就直接建單：欄位對錯位不會當場發現，
 * 而地址裡本來就常有逗號，拆錯了要等到出貨才知道。
 * 所以「貼上」只負責把名單拆進格子裡，站長逐格看過才送出。
 *
 * 出貨週與用途備註整批共用，放在最上面選一次。
 *
 * ── 草稿 ──
 * 每次改動都寫進 localStorage。為什麼一定要有：這張表單一次要填十幾位，
 * 而送出失敗是 server action 的 redirect，元件整個重新掛載、useState 全部歸零。
 * 沒有草稿的話，第 11 位漏填地址，前面 10 位就全部要重打。
 *
 * 草稿只留在站長自己的瀏覽器，成功建單之後立刻清掉——那份名單有別人的
 * 姓名、電話、地址，不該在建完單之後還留在瀏覽器裡。
 */

type Row = {
  name: string; phone: string; email: string; qty: string;
  shipMethod: string;
  address: string; storeName: string; storeNo: string;
};

const DRAFT_KEY = "yo_gift_draft_v1";

const emptyRow = (): Row => ({ name: "", phone: "", email: "", qty: "1", shipMethod: "宅配", address: "", storeName: "", storeNo: "" });

/* 這一列缺什麼。回空字串代表沒問題。
   跟 lib/gift-order.ts 的規則刻意保持一致，只是提早在瀏覽器講一次，
   省掉一趟來回；真正把關的還是伺服器那一份。 */
function rowProblem(r: Row): string {
  if (!r.name.trim()) return "還沒填姓名";
  if (phoneKind(r.phone) === "bad") return "電話看不出來是電話（手機、市話都可以）";
  const q = Number(r.qty);
  if (!Number.isFinite(q) || q < 1 || q > 99) return "盒數要在 1 到 99 之間";
  if (isCvsMethod(r.shipMethod)) {
    if (!r.storeName.trim() || !r.storeNo.trim()) return "門市名稱與店號都要填";
  } else if (!r.address.trim()) return "還沒填地址";
  return "";
}

export default function GiftOrderForm({
  products,
  action,
  badRows = "",
}: {
  products: { id: number; name: string; choices: string[] }[];
  action: (fd: FormData) => void;
  /* 伺服器退回來的「第幾列有問題」，逗號分隔的索引 */
  badRows?: string;
}) {
  const [productId, setProductId] = useState(products[0]?.id ?? 0);
  const [rows, setRows] = useState<Row[]>([emptyRow()]);
  const [note, setNote] = useState("");
  const [paste, setPaste] = useState("");
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteMsg, setPasteMsg] = useState("");
  const [restored, setRestored] = useState(false);
  const [tried, setTried] = useState(false);
  const loaded = useRef(false);
  /*
   * 還原完成之前不准存檔。
   *
   * 兩個 effect 在第一次 render 之後會依序跑：還原那支呼叫 setRows 之後，
   * 存檔那支拿到的仍然是這一輪的舊值（空白的一列），就會把剛還原的草稿
   * 當成「使用者清空了」而刪掉。下一輪雖然會補寫回去，但中間那個空窗
   * 只要使用者關掉分頁，那份名單就真的沒了。
   */
  const ready = useRef(false);
  /* 還原那一輪要跳過一次存檔（理由同上：那一輪拿到的還是舊的空白值） */
  const skipSave = useRef(false);

  const product = products.find((p) => p.id === productId);
  const serverBad = new Set(badRows.split(",").filter(Boolean).map(Number));

  /* 掛載時先處理草稿。建單成功（網址帶 gift=）就把草稿丟掉，
     否則下一次打開這張表單會看到上一批的名單，很容易重複建單。 */
  useEffect(() => {
    if (loaded.current) return;
    loaded.current = true;
    try {
      const done = new URLSearchParams(window.location.search).has("gift");
      if (done) { window.localStorage.removeItem(DRAFT_KEY); return; }
      const raw = window.localStorage.getItem(DRAFT_KEY);
      if (!raw) return;
      const d = JSON.parse(raw) as { productId?: number; note?: string; rows?: Row[] };
      if (Array.isArray(d.rows) && d.rows.length > 0) {
        setRows(d.rows.map((r) => ({ ...emptyRow(), ...r })));
        if (d.note) setNote(d.note);
        if (d.productId && products.some((p) => p.id === d.productId)) setProductId(d.productId);
        setRestored(true);
        skipSave.current = true;
      }
    } catch {
      /* 草稿壞掉不是大事，就當作沒有草稿，不要讓整張表單掛掉 */
      window.localStorage.removeItem(DRAFT_KEY);
    } finally {
      ready.current = true;
    }
  }, [products]);

  /* 每次改動就存。只有一位而且完全空白的時候不存，
     免得單純點開看一下就留下一份空草稿。 */
  useEffect(() => {
    if (!ready.current) return;
    if (skipSave.current) { skipSave.current = false; return; }
    const blank = rows.length === 1 && !rows[0].name && !rows[0].phone && !rows[0].address && !rows[0].storeNo;
    try {
      if (blank && !note) window.localStorage.removeItem(DRAFT_KEY);
      else window.localStorage.setItem(DRAFT_KEY, JSON.stringify({ productId, note, rows }));
    } catch {
      /* 無痕視窗或空間滿了會丟例外，存不了就算了，不影響填單 */
    }
  }, [rows, note, productId]);

  const set = (i: number, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r, n) => (n === i ? { ...r, ...patch } : r)));

  const total = rows.reduce((s, r) => s + (Number(r.qty) || 0), 0);
  const problems = rows.map(rowProblem);
  const badCount = problems.filter(Boolean).length;

  const doPaste = (mode: "replace" | "append") => {
    const parsed = parseGiftList(paste);
    if (parsed.length === 0) { setPasteMsg("這段文字裡我找不到任何一位收件人。"); return; }
    const next: Row[] = parsed.map((p) => ({
      name: p.name, phone: p.phone, email: p.email, qty: p.qty,
      shipMethod: p.shipMethod, address: p.address, storeName: p.storeName, storeNo: p.storeNo,
    }));
    const warns = parsed.map((p, i) => (p.warn ? `第 ${i + 1} 位：${p.warn}` : "")).filter(Boolean);
    setRows((rs) => {
      const keep = mode === "append" ? rs.filter((r) => r.name || r.phone || r.address || r.storeNo) : [];
      return [...keep, ...next];
    });
    const boxes = parsed.reduce((s, p) => s + (Number(p.qty) || 0), 0);
    setPasteMsg(
      `拆出 ${parsed.length} 位、共 ${boxes} 盒，已經填進下面的格子。請逐位看過再送出。` +
      (warns.length ? `\n有 ${warns.length} 位我沒有把握：\n${warns.join("\n")}` : "")
    );
    setPaste("");
  };

  return (
    <form
      action={action}
      onSubmit={(e) => {
        setTried(true);
        /* 有問題就不要送出去繞一圈才被退回來。伺服器那邊照樣會再檢查一次。 */
        if (rows.some((r) => rowProblem(r))) {
          e.preventDefault();
          setPasteMsg("");
        }
      }}
    >
      {restored && (
        <p className="msg-ok" style={{ margin: "0 0 14px" }}>
          幫你把上次沒送出的草稿接回來了（{rows.length} 位）。要重新開始的話按下面的「清空重來」。
        </p>
      )}

      <div className="adm-2col">
        <div className="field">
          <label>商品</label>
          <select name="product_id" value={productId} onChange={(e) => setProductId(Number(e.target.value))}>
            {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        <div className="field">
          <label>出貨週 <em>＊整批共用</em></label>
          <select name="choice" required>
            {(product?.choices ?? []).map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
      </div>
      <div className="field">
        <label>用途備註（三個月後你會靠這句話想起這批是幹嘛的）</label>
        <input type="text" name="note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="例如：中秋公關品－媒體" />
      </div>

      {/* 貼上名單：站長的名單是從 LINE、Email 複製出來的一坨文字，
          一格一格敲十八位，敲到第十二位就會開始出錯。 */}
      <div className="gift-paste">
        <button type="button" className="link-btn" onClick={() => setPasteOpen((v) => !v)}>
          {pasteOpen ? "收起貼上名單" : "▸ 貼上一整段名單，自動拆成格子"}
        </button>
        {pasteOpen && (
          <>
            <p className="fine" style={{ lineHeight: 1.9, margin: "8px 0" }}>
              一位一段、中間空一行就好，欄位順序不用整理。有寫「2盒：」會套用到後面每一位。
              超商寫「◯◯門市 店號:123456」會自動認出來。拆完一定要自己逐位看過。
            </p>
            <div className="field">
              <textarea
                className="ta-l"
                value={paste}
                onChange={(e) => setPaste(e.target.value)}
                placeholder={"1盒：\n\n王小明\n0912345678\n台北市中正區重慶南路一段122號\n\n姓名：陳小美\n電話：0223456789\n地址：台北市大安區..."}
              />
            </div>
            <div className="adm-actions">
              <button type="button" className="btn sm" onClick={() => doPaste("append")} disabled={!paste.trim()}>
                加到現有名單後面
              </button>
              <button type="button" className="btn sm" onClick={() => doPaste("replace")} disabled={!paste.trim()}>
                取代現有名單
              </button>
            </div>
            {pasteMsg && <p className="fine" style={{ whiteSpace: "pre-wrap", lineHeight: 1.9, marginTop: 8 }}>{pasteMsg}</p>}
          </>
        )}
      </div>

      <input type="hidden" name="count" value={rows.length} />

      {rows.map((r, i) => {
        const prob = problems[i];
        const flagged = (tried && prob) || serverBad.has(i);
        return (
        <div className={`gift-row${flagged ? " bad" : ""}`} key={i}>
          <div className="gift-row-head">
            <b>第 {i + 1} 位{r.name ? `　${r.name}` : ""}</b>
            {rows.length > 1 && (
              <button type="button" className="danger-link" onClick={() => setRows((rs) => rs.filter((_, n) => n !== i))}>
                移除這位
              </button>
            )}
          </div>
          {flagged && <p className="gift-row-msg">{prob || "這一位有問題，請看上面的清單"}</p>}
          <div className="adm-3col">
            <div className="field">
              <label>姓名</label>
              <input type="text" name={`name_${i}`} value={r.name} onChange={(e) => set(i, { name: e.target.value })} />
            </div>
            <div className="field">
              <label>
                電話
                {/* 只有手機發得出簡訊。市話收得下，但要讓站長知道那位不能傳簡訊 */}
                {r.phone && phoneKind(r.phone) !== "mobile" && phoneKind(r.phone) !== "bad" && (
                  <em style={{ fontStyle: "normal" }}>＊市話，不能傳簡訊</em>
                )}
              </label>
              <input type="tel" name={`phone_${i}`} value={r.phone}
                placeholder="手機或市話都可以" onChange={(e) => set(i, { phone: e.target.value })} />
            </div>
            <div className="field">
              <label>盒數</label>
              <input type="number" min={1} max={99} name={`qty_${i}`} value={r.qty}
                onChange={(e) => set(i, { qty: e.target.value })} />
            </div>
          </div>
          <div className="field">
            <label>Email（可不填）</label>
            <input type="email" name={`email_${i}`} value={r.email}
              placeholder="留空＝出貨通知寄給你自己"
              onChange={(e) => set(i, { email: e.target.value })} />
          </div>
          <div className="field">
            <label>取貨方式</label>
            <select name={`ship_${i}`} value={r.shipMethod}
              onChange={(e) => set(i, { shipMethod: e.target.value as Row["shipMethod"] })}>
              <option value="宅配">宅配</option>
              <option value="7-11店到店">7-11 店到店</option>
            </select>
          </div>
          {r.shipMethod === "宅配" ? (
            <div className="field">
              <label>地址</label>
              <input type="text" name={`address_${i}`} value={r.address}
                placeholder="不必填郵遞區號，系統會自動判別" onChange={(e) => set(i, { address: e.target.value })} />
            </div>
          ) : (
            <div className="adm-2col">
              <div className="field">
                <label>門市名稱</label>
                <input type="text" name={`store_name_${i}`} value={r.storeName}
                  placeholder="例如：正文" onChange={(e) => set(i, { storeName: e.target.value })} />
              </div>
              <div className="field">
                <label>店號</label>
                <input type="text" name={`store_no_${i}`} value={r.storeNo} inputMode="numeric"
                  placeholder="例如：991285" onChange={(e) => set(i, { storeNo: e.target.value })} />
              </div>
            </div>
          )}
        </div>
        );
      })}

      <div className="adm-actions">
        <button type="button" className="ibtn add wide" onClick={() => setRows((rs) => [...rs, emptyRow()])}>
          ＋ 再加一位
        </button>
        <button className="btn fill" type="submit">
          建立 {rows.length} 筆贈品訂單（共 {total} 盒）
        </button>
        <button
          type="button"
          className="danger-link"
          onClick={() => {
            if (!window.confirm("草稿會被清掉，這動作救不回來。確定？")) return;
            window.localStorage.removeItem(DRAFT_KEY);
            setRows([emptyRow()]); setNote(""); setPaste(""); setPasteMsg(""); setRestored(false); setTried(false);
          }}
        >
          清空重來
        </button>
      </div>

      {tried && badCount > 0 && (
        <p className="msg-err" style={{ marginTop: 10 }}>
          還沒送出。有 {badCount} 位要補，已經在上面標出來了。你填的東西都還在，不會不見。
        </p>
      )}

      <p className="fine" style={{ lineHeight: 1.9 }}>
        任何一位有問題就整批不建，不會出現建到一半的狀態。填到一半離開也沒關係，會自動存成草稿。
        Email 留空的那幾位，出貨通知會寄到你自己的信箱——送禮常常不希望對方事先知道。
      </p>
    </form>
  );
}
