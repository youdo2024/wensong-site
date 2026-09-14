"use client";
import { useState } from "react";
import { createPayLinkAction } from "@/app/admin/actions";
import EmailField from "./EmailField";
import Check from "./admin/Check";

type Product = { id: number; name: string; price: number; option_name: string; choices: string[]; stocks: Record<string, number>; stock: number };
type Row = { pid: number; name: string; choice: string; price: number; qty: number };

/*
 * 建立付款連結的表單。
 *
 * 一列＝一個項目。選了商品就帶出定價與出貨週（庫存會在建立時預扣），
 * 商品留空＝不綁商品的純收款列（例如「影片拍攝服務」），不扣庫存也不進出貨工作台。
 *
 * 價格可以改：企業訂購一定會議價，30 盒和 300 盒不可能同一個單價。
 * 但改的是這條連結的價格，不是商品定價，所以不會影響一般顧客看到的金額。
 */
export default function PayLinkForm({
  products,
  pays,
  presets,
}: {
  products: Product[];
  pays: string[];
  presets?: { title?: string; name?: string; phone?: string; email?: string; taxId?: string; company?: string; qty?: string };
}) {
  const [rows, setRows] = useState<Row[]>([{ pid: 0, name: "", choice: "", price: 0, qty: Number(presets?.qty) || 1 }]);
  const [needAddress, setNeedAddress] = useState(true);

  const setRow = (i: number, patch: Partial<Row>) =>
    setRows((r) => r.map((x, n) => (n === i ? { ...x, ...patch } : x)));

  /* 選商品時帶出它的名稱與定價；改成「不綁商品」時清掉出貨週，
     否則會留下一個屬於別的商品的週別字串，看起來像有綁其實沒有 */
  const pickProduct = (i: number, pid: number) => {
    const p = products.find((x) => x.id === pid);
    setRow(i, p ? { pid, name: p.name, price: p.price, choice: "" } : { pid: 0, choice: "" });
  };

  const total = rows.reduce((s, r) => s + Math.max(0, r.price) * Math.max(0, r.qty), 0);
  const anyBound = rows.some((r) => r.pid > 0);

  return (
    <form action={createPayLinkAction} className="adm-form">
      <div className="field full">
        <label>備註（只有你看得到）</label>
        <input type="text" name="title" defaultValue={presets?.title || ""} placeholder="例如：＿＿公司 100 盒 中秋" />
      </div>

      <h3 className="f">項 目</h3>
      {rows.map((r, i) => {
        const p = products.find((x) => x.id === r.pid);
        return (
          <div key={i} className="box" style={{ marginBottom: 12 }}>
            <div className="inner" style={{ padding: "14px 16px", display: "grid", gap: 10 }}>
              <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1.4fr) minmax(0,1fr)", gap: 10 }}>
                <div className="field">
                  <label>綁定商品</label>
                  <select value={r.pid} onChange={(e) => pickProduct(i, Number(e.target.value))}>
                    <option value={0}>不綁商品（純收款，不扣庫存、不進出貨清單）</option>
                    {products.map((x) => (
                      <option key={x.id} value={x.id}>{x.name}（定價 {x.price}，總庫存 {x.stock}）</option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label>{p?.option_name || "出貨週"}</label>
                  <select value={r.choice} onChange={(e) => setRow(i, { choice: e.target.value })} disabled={!p || p.choices.length === 0}>
                    <option value="">{p ? (p.choices.length ? "請選擇" : "此商品沒有規格") : "先選商品"}</option>
                    {p?.choices.map((c) => (
                      <option key={c} value={c}>
                        {c}
                        {Object.prototype.hasOwnProperty.call(p.stocks, c) ? `（剩 ${p.stocks[c]}）` : "（不限量）"}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "minmax(0,2fr) minmax(0,1fr) minmax(0,1fr)", gap: 10 }}>
                <div className="field">
                  <label>項目名稱（會印在發票上）</label>
                  <input type="text" value={r.name} onChange={(e) => setRow(i, { name: e.target.value })} placeholder="例如：影片拍攝服務" />
                </div>
                <div className="field">
                  <label>單價</label>
                  <input type="number" min={0} value={r.price} onChange={(e) => setRow(i, { price: Number(e.target.value) })} />
                </div>
                <div className="field">
                  <label>數量</label>
                  <input type="number" min={1} value={r.qty} onChange={(e) => setRow(i, { qty: Number(e.target.value) })} />
                </div>
              </div>
              {/* 真正送出的值：受控欄位的 name 會被 React 的 value 綁住，所以另外用 hidden 送 */}
              <input type="hidden" name="item_pid" value={r.pid} />
              <input type="hidden" name="item_name" value={r.name} />
              <input type="hidden" name="item_choice" value={r.choice} />
              <input type="hidden" name="item_price" value={r.price} />
              <input type="hidden" name="item_qty" value={r.qty} />
              {rows.length > 1 && (
                <p style={{ margin: 0, textAlign: "right" }}>
                  <button type="button" className="danger-link" onClick={() => setRows((x) => x.filter((_, n) => n !== i))}>移除這一列</button>
                </p>
              )}
            </div>
          </div>
        );
      })}
      <p>
        <button type="button" className="ibtn add wide" onClick={() => setRows((r) => [...r, { pid: 0, name: "", choice: "", price: 0, qty: 1 }])}>
          再加一個項目
        </button>
        <span className="sans" style={{ marginLeft: 14, fontSize: 15 }}>
          總計 <b style={{ color: "var(--seal)" }}>NT${total.toLocaleString()}</b>
        </span>
      </p>

      <h3 className="f">設 定</h3>
      <div className="field full">
        <label>要不要填收件地址</label>
        <div className="radio-row">
          <span className={`r${needAddress ? " on" : ""}`} onClick={() => setNeedAddress(true)}>要寄東西，需要地址</span>
          <span className={`r${!needAddress ? " on" : ""}`} onClick={() => setNeedAddress(false)}>不用寄（純收款），不要地址</span>
        </div>
        <input type="hidden" name="need_address" value={needAddress ? "1" : "0"} />
        {!needAddress && anyBound && (
          <p className="msg-err" style={{ marginTop: 8 }}>
            這條連結綁了商品卻設定成不用寄送。綁商品代表有實體貨要做要寄，請確認是不是選錯了。
          </p>
        )}
      </div>

      <div className="field full">
        <label>開放的付款方式（至少一種）</label>
        <div className="chk-list">
          {pays.map((p) => (
            <Check key={p} name="pays" value={p} label={p} defaultChecked />
          ))}
        </div>
        <p className="fine" style={{ marginTop: 6 }}>
          金額大的建議只開 ATM 轉帳：刷卡手續費是按成交金額抽成的，而 ATM 在站上的實測成功率也最高。
        </p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 12 }}>
        <div className="field">
          <label>保留天數</label>
          <input type="number" name="hold_days" min={1} max={365} defaultValue={30} />
          <p className="fine">預扣的庫存保留這麼多天；對方成立訂單後，這也是那張訂單的逾期天數。</p>
        </div>
        <div className="field">
          <label>統一編號（可留空）</label>
          <input type="text" name="inv_tax_id" defaultValue={presets?.taxId || ""} maxLength={8} inputMode="numeric" />
        </div>
        <div className="field">
          <label>公司抬頭（可留空）</label>
          <input type="text" name="inv_company" defaultValue={presets?.company || ""} />
        </div>
      </div>
      <p className="fine">填了統編，對方打開結帳頁時發票會預設是三聯式並且已經填好，他還是可以自己改成二聯式載具。</p>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 12 }}>
        <div className="field">
          <label>聯絡人（預填，可留空）</label>
          <input type="text" name="preset_name" defaultValue={presets?.name || ""} />
        </div>
        <div className="field">
          <label>電話（預填，可留空）</label>
          <input type="text" name="preset_phone" defaultValue={presets?.phone || ""} />
        </div>
        <div className="field">
          <EmailField
            name="preset_email"
            defaultValue={presets?.email || ""}
            required={false}
            label={<label>Email（預填，可留空）</label>}
          />
        </div>
      </div>

      <div className="adm-actions">
        <button className="btn fill" type="submit">建立連結並預扣庫存</button>
      </div>
      <p className="fine">
        按下去的當下就會把綁定商品的庫存扣起來，別人買不到那些量。用不到的連結記得作廢，庫存才會放回去。
      </p>
    </form>
  );
}
