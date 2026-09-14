"use client";
import { useId, useState } from "react";
import { emailTypoSuggestion } from "@/lib/email-typo";

/*
 * 信箱欄位：看起來是一格，`@` 就長在框裡面，網域用選的。
 *
 * 為什麼要這樣做：type="email" 只檢查語法，而 sandycakey@gmail.con
 * 語法上完全合法所以一路過關，結果顧客付了錢卻收不到確認信與發票，
 * 我們只收到一封退信，也沒有別的方式聯絡她。網域改成用選的，
 * 最常見的那幾個就再也不可能打錯。
 *
 * 版面刻意做成單一個外框、內部控制項不帶邊框，讓它讀起來就是一個信箱欄位。
 * 分成兩個獨立的方框時，人會很自然地在第一格就把 @gmail.com 一起打完。
 *
 * 選項依實際名單資料排序（221 筆）：gmail.com 71.9%、yahoo.com.tw 14.0%、
 * hotmail.com 6.8%、icloud.com 1.4%，這四個涵蓋 94.1%。
 * 刻意不放 yahoo.com：名單裡 yahoo.com.tw 有 31 人而 yahoo.com 只有 2 人，
 * 兩個長那麼像的擺在一起，會讓那 31 人有機會選錯，等於製造一個新的錯誤。
 */
export const COMMON_DOMAINS = ["gmail.com", "yahoo.com.tw", "hotmail.com", "icloud.com", "outlook.com"];
const CUSTOM = "__custom__";

/* 把一整串信箱拆成帳號與網域。網域不在選項裡就切到「其他」，
   不能把人家原本填的資料弄丟（例如會員上次用的學校信箱）。 */
export function splitEmail(v: string): { local: string; domain: string; custom: string } {
  const s = String(v || "").trim();
  const at = s.lastIndexOf("@");
  if (at < 1) return { local: s, domain: "", custom: "" };
  const local = s.slice(0, at);
  /* 手機鍵盤常把第一個字母自動變大寫，A@GMAIL.COM 必須對得上 gmail.com */
  const dom = s.slice(at + 1).toLowerCase();
  return COMMON_DOMAINS.includes(dom)
    ? { local, domain: dom, custom: "" }
    : { local, domain: CUSTOM, custom: dom };
}

export default function EmailField({
  name = "email",
  defaultValue = "",
  required = true,
  label,
  onChange,
}: {
  name?: string;
  defaultValue?: string;
  required?: boolean;
  label?: React.ReactNode;
  /* 給用 state 控制的表單（例如訂單查詢）拿到組好的完整信箱 */
  onChange?: (email: string) => void;
}) {
  const id = useId();
  const init = splitEmail(defaultValue);
  const [local, setLocal] = useState(init.local);
  const [domain, setDomain] = useState(init.domain);
  const [custom, setCustom] = useState(init.custom);

  const domainValue = (domain === CUSTOM ? custom : domain).trim().toLowerCase();
  const localValue = local.trim();
  const full = localValue && domainValue ? `${localValue}@${domainValue}` : "";

  const apply = (l: string, d: string, c: string) => {
    setLocal(l);
    setDomain(d);
    setCustom(c);
    const dv = (d === CUSTOM ? c : d).trim().toLowerCase();
    onChange?.(l.trim() && dv ? `${l.trim()}@${dv}` : "");
  };

  /*
   * 就算做成一格，還是有人會把整串貼進來或讓瀏覽器自動填入，
   * 所以帳號欄一出現 @ 就立刻拆開並把網域選好。
   * 沒有這一段的話自動填入會變成 a@gmail.com@gmail.com。
   */
  const onLocal = (raw: string) => {
    const v = raw.replace(/\s/g, "");
    if (v.includes("@")) {
      const p = splitEmail(v);
      apply(p.local, p.domain, p.custom);
      return;
    }
    apply(v, domain, custom);
  };

  /* 只有自行輸入的網域才可能打錯，選單裡那五個不可能 */
  const suggest = domain === CUSTOM && custom.trim() ? emailTypoSuggestion(`x@${custom.trim()}`).slice(2) : "";

  return (
    <>
      {label}
      {/* 外框在這一層，裡面的控制項不帶邊框，整組讀起來就是一個信箱欄位 */}
      <div className="email-box">
        <input
          id={id}
          className="email-local"
          type="text"
          value={local}
          onChange={(e) => onLocal(e.target.value)}
          required={required}
          autoComplete="email"
          inputMode="email"
          placeholder="帳號"
          aria-label="信箱帳號"
        />
        <span className="email-at" aria-hidden>@</span>
        {domain === CUSTOM ? (
          <input
            className="email-domain"
            type="text"
            value={custom}
            onChange={(e) => apply(local, CUSTOM, e.target.value.replace(/\s/g, "").replace(/^@+/, ""))}
            required={required}
            placeholder="輸入網域"
            aria-label="自行輸入信箱網域"
            autoFocus
          />
        ) : (
          <select
            className="email-domain"
            value={domain}
            onChange={(e) => apply(local, e.target.value, "")}
            required={required}
            aria-label="信箱網域"
          >
            <option value="">請選擇</option>
            {COMMON_DOMAINS.map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
            <option value={CUSTOM}>其他（自己打）</option>
          </select>
        )}
      </div>

      {/* 自己打網域時要有路走回選單，否則選錯的人會卡住 */}
      {domain === CUSTOM && (
        <p className="email-hint">
          <button type="button" className="danger-link" style={{ color: "var(--indigo)" }} onClick={() => apply(local, "", "")}>
            ← 改從常見信箱選
          </button>
        </p>
      )}

      {suggest && (
        <p className="field-err" style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <span>你是不是要打 <b>{suggest}</b>？</span>
          <button type="button" className="danger-link" style={{ color: "var(--indigo)" }} onClick={() => apply(local, CUSTOM, suggest)}>
            幫我改成這個
          </button>
        </p>
      )}

      {/* 讓對方自己看一眼完整信箱，這是最後一道人工檢查 */}
      {full && (
        <p className="email-hint">
          確認信與發票會寄到　<b style={{ color: "var(--ink)" }}>{full}</b>
        </p>
      )}

      {/* 後端拿到的還是單一一個 email 欄位，所以所有既有流程完全不用改。
          隱藏欄位不受 HTML 驗證，required 一律掛在看得見的欄位上。 */}
      <input type="hidden" name={name} value={full} />
    </>
  );
}
