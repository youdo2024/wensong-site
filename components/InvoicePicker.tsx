"use client";
import { useEffect, useRef, useState } from "react";
import { DEFAULT_NPOBAN, npobanFormatOk } from "@/lib/npoban-code";
import { taxIdChecksumOk } from "@/lib/taxid";

/*
 * 電子發票四選項：捐發票 → 存信箱 → 存載具 → 打統編（站長指定的順序與預設）。
 *
 * 這一版是給「原生表單送出」用的（贊助頁），所以值都寫進 hidden input，
 * 欄位名沿用 app/support/actions.ts 早就在讀的那四個：
 * inv_kind / inv_npoban / inv_carrier_no / inv_tax_id / inv_company。
 * 伺服器那邊本來就支援四種，之前只是被一行寫死的 inv_kind=email 蓋住而已。
 *
 * 為什麼沒有跟結帳頁共用同一份：CheckoutForm 是把整包資料組成 JSON 打 API，
 * 這裡是原生 form action，兩邊取值的方式不一樣。硬要共用得先把 CheckoutForm
 * 大改一輪，而那一頁正在收錢。文案與順序有變的話兩邊都要改，記在這裡。
 */

type Kind = "donate" | "email" | "carrier" | "b2b";
const KEY = "yo_inv_choice"; /* 與 CheckoutForm 同一把鑰匙：客人在哪一頁選的都算數 */

export default function InvoicePicker() {
  const [kind, setKind] = useState<Kind>("donate");
  const [npoban, setNpoban] = useState(DEFAULT_NPOBAN);
  const [carrierNo, setCarrierNo] = useState("");
  const [taxId, setTaxId] = useState("");
  const [company, setCompany] = useState("");
  const [npoInfo, setNpoInfo] = useState<{ state: "idle" | "loading" | "ok" | "bad"; name: string; msg: string }>({ state: "idle", name: "", msg: "" });
  const [taxInfo, setTaxInfo] = useState<{ state: "idle" | "loading" | "ok" | "warn" | "bad"; name: string; msg: string }>({ state: "idle", name: "", msg: "" });

  /* 記住上次選的（同 CheckoutForm）：預設捐發票只該套用在第一次來的人身上 */
  useEffect(() => {
    try {
      const v = localStorage.getItem(KEY);
      if (v === "donate" || v === "email" || v === "carrier" || v === "b2b") setKind(v);
      const c = localStorage.getItem(KEY + "_npoban");
      if (c && npobanFormatOk(c)) setNpoban(c);
    } catch { /* 隱私模式讀不到就用預設 */ }
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(KEY, kind);
      if (kind === "donate" && npobanFormatOk(npoban)) localStorage.setItem(KEY + "_npoban", npoban.trim());
    } catch { /* 寫不進去不影響付款 */ }
  }, [kind, npoban]);

  /* 捐贈碼即時查名稱。捐贈不可逆，客人要在按下付款之前看到捐給誰 */
  useEffect(() => {
    if (kind !== "donate") return;
    const code = npoban.trim();
    if (!npobanFormatOk(code)) {
      setNpoInfo({ state: "bad", name: "", msg: code ? "捐贈碼是 3 到 7 位數字" : "請填捐贈碼" });
      return;
    }
    setNpoInfo({ state: "loading", name: "", msg: "" });
    const id = setTimeout(async () => {
      try {
        const d = await (await fetch(`/api/npoban?code=${encodeURIComponent(code)}`)).json();
        if (d.ok) setNpoInfo({ state: "ok", name: d.name, msg: "" });
        else setNpoInfo({ state: "bad", name: "", msg: d.msg || "查不到這個捐贈碼" });
      } catch {
        /* 查不動就放行，伺服器建單時還會再驗一次 */
        setNpoInfo({ state: "idle", name: "", msg: "" });
      }
    }, 400);
    return () => clearTimeout(id);
  }, [kind, npoban]);

  /*
   * 統編查經濟部。三個欄位裡只有這個光貿不會擋（它只驗檢查碼、不驗存不存在），
   * 打錯的下場是靜靜開出一張抬頭是空氣的發票。
   * 但查不到【不擋】：財團法人、學校、機關、協會都有統編卻不在商工登記裡。
   */
  useEffect(() => {
    if (kind !== "b2b") return;
    const no = taxId.trim();
    if (!/^\d{8}$/.test(no)) {
      setTaxInfo({ state: no ? "bad" : "idle", name: "", msg: no ? "統一編號是 8 位數字" : "" });
      return;
    }
    if (!taxIdChecksumOk(no)) {
      setTaxInfo({ state: "bad", name: "", msg: "這組統一編號的檢查碼不對，請再確認一次" });
      return;
    }
    setTaxInfo({ state: "loading", name: "", msg: "" });
    const id = setTimeout(async () => {
      try {
        const d = await (await fetch(`/api/taxid?no=${encodeURIComponent(no)}`)).json();
        if (d.ok) setTaxInfo({ state: "ok", name: d.name, msg: d.kind });
        else if (d.reason === "checksum") setTaxInfo({ state: "bad", name: "", msg: "這組統一編號的檢查碼不對，請再確認一次" });
        else setTaxInfo({ state: "warn", name: "", msg: "經濟部商工登記查不到這組統編。財團法人、學校、機關、協會本來就不在這個資料庫裡，是的話可以直接送出；如果是公司行號，請再確認號碼。" });
      } catch {
        setTaxInfo({ state: "idle", name: "", msg: "" });
      }
    }, 500);
    return () => clearTimeout(id);
  }, [kind, taxId]);

  /* 查到登記名稱就帶進抬頭，但客人自己改過就不要再蓋掉他 */
  const touched = useRef(false);
  useEffect(() => {
    if (kind === "b2b" && taxInfo.state === "ok" && taxInfo.name && !touched.current) setCompany(taxInfo.name);
  }, [kind, taxInfo]);

  return (
    <>
      <h3 className="f">電 子 發 票</h3>
      {/* 送給伺服器的值。inv_kind 用 mobile 是因為 actions.ts 讀的就是這個字 */}
      <input type="hidden" name="inv_kind" value={kind === "carrier" ? "mobile" : kind} />
      <input type="hidden" name="inv_npoban" value={kind === "donate" ? npoban.trim() : ""} />
      <input type="hidden" name="inv_carrier_no" value={kind === "carrier" ? carrierNo.trim().toUpperCase() : ""} />
      <input type="hidden" name="inv_tax_id" value={kind === "b2b" ? taxId.trim() : ""} />
      <input type="hidden" name="inv_company" value={kind === "b2b" ? company.trim() : ""} />

      <div className="radio-row inv-row">
        <span className={`r${kind === "donate" ? " on" : ""}`} onClick={() => setKind("donate")}>捐發票</span>
        <span className={`r${kind === "email" ? " on" : ""}`} onClick={() => setKind("email")}>存信箱</span>
        <span className={`r${kind === "carrier" ? " on" : ""}`} onClick={() => setKind("carrier")}>存載具</span>
        <span className={`r${kind === "b2b" ? " on" : ""}`} onClick={() => setKind("b2b")}>打統編</span>
      </div>

      {kind === "donate" && (
        <>
          <p className="fine" style={{ margin: "10px 0 0", lineHeight: 1.95 }}>
            捐贈發票，可以捐給家扶基金會，我從小受家扶照顧。或者填入你想捐的單位
          </p>
          <div className="field" style={{ marginTop: 10, maxWidth: 340 }}>
            <label>捐贈碼 <em>＊</em></label>
            <input className="sans" value={npoban} onChange={(e) => setNpoban(e.target.value.replace(/\D/g, "").slice(0, 7))} inputMode="numeric" placeholder="8585" maxLength={7} />
          </div>
          <p className={npoInfo.state === "bad" ? "field-err" : "fine"} style={{ margin: "6px 0 0", lineHeight: 1.9 }}>
            {npoInfo.state === "ok" ? <>將捐給 <b>{npoInfo.name}</b></>
              : npoInfo.state === "loading" ? "查詢中…"
              : npoInfo.state === "bad" ? npoInfo.msg
              : " "}
          </p>
        </>
      )}

      {kind === "carrier" && (
        <div className="field" style={{ marginTop: 12, maxWidth: 340 }}>
          <label>手機條碼 <em>＊</em>（斜線開頭共 8 碼）</label>
          <input className="sans" value={carrierNo} onChange={(e) => setCarrierNo(e.target.value)} placeholder="/AB12CD3" maxLength={8} />
        </div>
      )}

      {kind === "b2b" && (
        <>
          <div className="form-grid" style={{ marginTop: 12 }}>
            <div className="field">
              <label>統一編號 <em>＊</em>（8 碼）</label>
              <input className="sans" value={taxId} onChange={(e) => setTaxId(e.target.value.replace(/\D/g, "").slice(0, 8))} placeholder="88528295" inputMode="numeric" maxLength={8} />
            </div>
            <div className="field">
              <label>公司抬頭（選填，未填以統編開立）</label>
              <input value={company} onChange={(e) => { touched.current = true; setCompany(e.target.value); }} placeholder="例如：於悅商行" />
            </div>
          </div>
          <p className={taxInfo.state === "bad" ? "field-err" : "fine"} style={{ margin: "6px 0 0", lineHeight: 1.9 }}>
            {taxInfo.state === "ok" ? <>經濟部登記名稱：<b>{taxInfo.name}</b>（{taxInfo.msg}）　抬頭已幫你帶入，<b>請確認是否正確</b>，可以自己改。</>
              : taxInfo.state === "loading" ? "查詢中…"
              : taxInfo.state === "warn" ? <span style={{ color: "var(--seal)" }}>{taxInfo.msg}</span>
              : taxInfo.state === "bad" ? taxInfo.msg
              : " "}
          </p>
        </>
      )}

      <p className="fine" style={{ marginTop: 10 }}>
        {kind === "donate"
          ? "發票由本站依法開立，並填入你指定的捐贈碼。"
          : "發票由本站依法開立，寄至你填寫的 Email，中獎會另行通知。"}
      </p>
    </>
  );
}
