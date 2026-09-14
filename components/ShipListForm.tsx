"use client";
import { useState } from "react";
import { isCvsMethod } from "@/lib/cvs";

/*
 * 多地址配送的收件名單：一位一組格子，按「再加一位」多一組。
 *
 * 為什麼不是貼一整塊文字：站長要的是「清楚的格子對應每一個人」。
 * 這跟贈品單（GiftOrderForm）是同一個理由——貼上看起來省事，
 * 但欄位對錯位不會當場發現，而地址裡本來就常有逗號，拆錯了要等到出貨才知道。
 *
 * 已經出貨的那幾位鎖住不給改：改了會對不上出貨紀錄，
 * 而站長真正想做的多半是「再加一位」，不是去動已經寄出去的那筆。
 * 真的要改就先取消出貨（下面那顆小連結），這樣至少是個有意識的動作。
 */

export type Row = {
  name: string; phone: string; qty: string; shipped: boolean;
  note?: string;
  /* 逐位獨立：企業訂 12 盒，六盒宅配六盒超商是常態 */
  shipMethod: string;
  address: string;
  storeName: string;
  storeNo: string;
  /* 手動郵遞區號（3 碼），留空＝系統顯示時自動推導。只在系統推錯或推不出時才填 */
  zip: string;
};

/* 已出貨那幾列用 readOnly 不用 disabled——disabled 的欄位不會被送進 FormData，
   重存的時候那幾位的姓名地址會整個變成空的 */
const LOCKED: React.CSSProperties = { background: "var(--rice-lt)", color: "var(--grey)", cursor: "not-allowed" };

const emptyRow = (): Row => ({ name: "", phone: "", qty: "1", shipped: false, shipMethod: "宅配", address: "", storeName: "", storeNo: "", zip: "" });

export default function ShipListForm({
  initial,
  orderId,
  itemTotalQty,
  action,
}: {
  initial: Row[];
  orderId: number;
  /* 訂單品項的總盒數，用來跟名單合計對帳 */
  itemTotalQty: number;
  action: (fd: FormData) => void;
}) {
  const [rows, setRows] = useState<Row[]>(initial.length ? initial : [emptyRow()]);
  const set = (i: number, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r, n) => (n === i ? { ...r, ...patch } : r)));

  const total = rows.reduce((s, r) => s + (Number(r.qty) || 0), 0);
  const shippedCount = rows.filter((r) => r.shipped).length;
  const cvsCount = rows.filter((r) => isCvsMethod(r.shipMethod)).length;
  const mismatch = total > 0 && itemTotalQty > 0 && total !== itemTotalQty;

  return (
    <form action={action}>
      <input type="hidden" name="id" value={orderId} />
      <input type="hidden" name="count" value={rows.length} />

      {rows.map((r, i) => (
        <div className="gift-row" key={i}>
          <div className="gift-row-head">
            <b>
              第 {i + 1} 位
              {r.shipped && <span className="badge green" style={{ marginLeft: 8 }}>已出貨</span>}
            </b>
            {!r.shipped && rows.length > 1 && (
              <button type="button" className="danger-link" onClick={() => setRows((rs) => rs.filter((_, n) => n !== i))}>
                移除這位
              </button>
            )}
            {r.shipped && (
              <button type="button" className="link-btn" onClick={() => set(i, { shipped: false })}>
                取消出貨標記（才能改）
              </button>
            )}
          </div>
          {/* 出貨狀態跟著這一列一起送回去，不然重存會把已出貨洗掉 */}
          <input type="hidden" name={`shipped_${i}`} value={r.shipped ? "1" : "0"} />
          <div className="adm-3col">
            <div className="field">
              <label>姓名</label>
              <input type="text" name={`name_${i}`} value={r.name} readOnly={r.shipped} style={r.shipped ? LOCKED : undefined}
                onChange={(e) => set(i, { name: e.target.value })} required />
            </div>
            <div className="field">
              <label>手機</label>
              <input type="tel" inputMode="numeric" name={`phone_${i}`} value={r.phone} readOnly={r.shipped} style={r.shipped ? LOCKED : undefined}
                placeholder="09xxxxxxxx" onChange={(e) => set(i, { phone: e.target.value })} />
            </div>
            <div className="field">
              <label>盒數</label>
              <input type="number" min={1} max={999} name={`qty_${i}`} value={r.qty} readOnly={r.shipped} style={r.shipped ? LOCKED : undefined}
                onChange={(e) => set(i, { qty: e.target.value })} required />
            </div>
            <div className="field">
              <label>備註（夥伴包貨時會看到）</label>
              <input type="text" name={`note_${i}`} value={r.note || ""} readOnly={r.shipped} style={r.shipped ? LOCKED : undefined}
                placeholder="例如：附紙袋 5 個" onChange={(e) => set(i, { note: e.target.value })} />
            </div>
          </div>
          <div className="field">
            <label>取貨方式</label>
            <select name={`ship_${i}`} value={r.shipMethod} disabled={r.shipped}
              style={r.shipped ? LOCKED : undefined}
              onChange={(e) => set(i, { shipMethod: e.target.value as Row["shipMethod"] })}>
              <option value="宅配">宅配</option>
              <option value="7-11店到店">7-11 店到店</option>
            </select>
            {/* select 用 disabled 會不進 FormData，所以鎖住時另外補一個 hidden 把值送回去 */}
            {r.shipped && <input type="hidden" name={`ship_${i}`} value={r.shipMethod} />}
          </div>
          {r.shipMethod === "宅配" ? (
            <div className="field">
              <label>地址</label>
              <input type="text" name={`address_${i}`} value={r.address} readOnly={r.shipped} style={r.shipped ? LOCKED : undefined}
                placeholder="不必填郵遞區號，系統會自動判別"
                onChange={(e) => set(i, { address: e.target.value })} required />
              {/* 郵遞區號補登格：系統從地址推不出（或推錯）時才需要，填了以人的為準。
                  平常留空就好，出貨工作台會自動帶 3 碼 */}
              <input type="text" name={`zip_${i}`} value={r.zip} readOnly={r.shipped}
                style={{ marginTop: 6, ...(r.shipped ? LOCKED : {}) }}
                inputMode="numeric" maxLength={3} placeholder="郵遞區號（通常免填）"
                onChange={(e) => set(i, { zip: e.target.value })} />
            </div>
          ) : (
            <div className="adm-2col">
              <div className="field">
                <label>門市名稱</label>
                <input type="text" name={`store_name_${i}`} value={r.storeName} readOnly={r.shipped} style={r.shipped ? LOCKED : undefined}
                  placeholder="例如：正文門市" onChange={(e) => set(i, { storeName: e.target.value })} required />
              </div>
              <div className="field">
                <label>店號</label>
                <input type="text" name={`store_no_${i}`} value={r.storeNo} inputMode="numeric" readOnly={r.shipped} style={r.shipped ? LOCKED : undefined}
                  placeholder="例如：991285" onChange={(e) => set(i, { storeNo: e.target.value })} required />
              </div>
            </div>
          )}
        </div>
      ))}

      {mismatch && (
        <p className="msg-err" style={{ margin: "12px 0" }}>
          ⚠️ 名單合計 {total} 盒，訂單品項共 {itemTotalQty} 盒，對不起來。
          出貨前請確認是不是少填或多填了一位。（還是可以儲存，有時候本來就會不一樣）
        </p>
      )}

      <div className="adm-actions">
        <button type="button" className="ibtn add wide" onClick={() => setRows((rs) => [...rs, emptyRow()])}>
          ＋ 再加一位
        </button>
        <button className="btn fill" type="submit">
          儲存 {rows.length} 位（共 {total} 盒{cvsCount > 0 ? `・${rows.length - cvsCount} 宅配 ${cvsCount} 超商` : ""}）
        </button>
        <span className="fine">
          {shippedCount > 0
            ? `已出貨 ${shippedCount} 位，那幾格鎖住不給改，避免對不上出貨紀錄。`
            : "儲存後會同步到出貨工作台，一位一列，可以逐一點出貨。"}
        </span>
      </div>
    </form>
  );
}
