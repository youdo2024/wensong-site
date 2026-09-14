/*
 * 常見信箱網域打錯的偵測。
 *
 * 為什麼需要：瀏覽器的 type="email" 只檢查語法，
 * 而 sandycakey@gmail.con 語法上完全合法，所以一路過關。
 * 結果是顧客付了錢卻收不到確認信與發票，而我們也沒有別的方式聯絡她，
 * 只會收到一封退信。實際發生過：一筆 888 的支持、一筆待付款訂單，
 * 兩個信箱都是打錯的，退信一封接一封。
 *
 * 這裡只認「確定是打錯」的網域，用白名單而不是規則推論。
 * 用 TLD 規則去猜（例如「.con 不是合法 TLD」）會誤殺真實存在但冷門的網域，
 * 把顧客擋在門外比讓他收不到信更糟。
 */

/* 打錯的寫法 → 正確的網域。左邊每一個都是實際會看到的手誤。 */
const TYPOS: Record<string, string> = {
  /* gmail */
  "gmail.con": "gmail.com",
  "gmail.co": "gmail.com",
  "gmail.cm": "gmail.com",
  "gmail.om": "gmail.com",
  "gmail.comm": "gmail.com",
  "gmail.copm": "gmail.com",
  "gmial.com": "gmail.com",
  "gmai.com": "gmail.com",
  "gamil.com": "gmail.com",
  "gnail.com": "gmail.com",
  "gmails.com": "gmail.com",
  "gmail.com.tw": "gmail.com",
  "qmail.com": "gmail.com",
  /* yahoo（台灣常用 yahoo.com.tw） */
  "yahoo.con": "yahoo.com",
  "yahoo.co": "yahoo.com",
  "yaho.com": "yahoo.com",
  "yahooo.com": "yahoo.com",
  "yhaoo.com": "yahoo.com",
  "yahoo.com.tw.com": "yahoo.com.tw",
  "yahoo.comtw": "yahoo.com.tw",
  "yahoo.tw": "yahoo.com.tw",
  /* hotmail / outlook / live */
  "hotmail.con": "hotmail.com",
  "hotmail.co": "hotmail.com",
  "hotmial.com": "hotmail.com",
  "hotmil.com": "hotmail.com",
  "hotmali.com": "hotmail.com",
  "homail.com": "hotmail.com",
  "outlook.con": "outlook.com",
  "outlok.com": "outlook.com",
  "outllok.com": "outlook.com",
  /* icloud */
  "icloud.con": "icloud.com",
  "iclould.com": "icloud.com",
  "icloud.co": "icloud.com",
  "icoud.com": "icloud.com",
  /* 台灣本地 */
  "msa.hinet.com": "msa.hinet.net",
  "hinet.com": "hinet.net",
  "seed.net": "seed.net.tw",
  "pchome.com": "pchome.com.tw",
};

/*
 * 回傳建議的正確信箱；沒有問題就回空字串。
 * 大小寫與前後空白先正規化，因為手機鍵盤常常自動把第一個字母變大寫。
 */
export function emailTypoSuggestion(raw: string): string {
  const email = String(raw || "").trim().toLowerCase();
  const at = email.lastIndexOf("@");
  if (at < 1 || at === email.length - 1) return "";
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  const fixed = TYPOS[domain];
  return fixed ? `${local}@${fixed}` : "";
}

/* 後台用：這個信箱看起來就是打錯的（用來標示需要人工聯絡的紀錄） */
export function emailLooksWrong(raw: string): boolean {
  return emailTypoSuggestion(raw) !== "";
}

/*
 * 伺服器端的信箱檢查。前端已經把網域改成用選的，但表單擋不住直接打 API 的請求，
 * 而且「其他」那格還是自由輸入。回傳空字串代表沒問題，否則就是要給對方看的錯誤訊息。
 *
 * 已知手誤的網域這裡直接擋掉。以前不擋是怕誤傷真的用了那些網域的人，
 * 但現在正確的選項就在下拉選單裡一鍵可選，還打得出 gmail.con 的一定是打錯，
 * 擋下來不會讓任何人買不到，卻能救回一筆收不到發票的訂單。
 */
export function checkEmail(raw: string): string {
  const email = String(raw || "").trim();
  if (!email) return "請填寫 Email";
  /* 只做基本結構檢查：有帳號、有網域、網域至少有一個點、沒有空白。
     RFC 完整規則過於寬鬆（連引號與中文都合法），拿來擋錯字沒有意義。 */
  if (!/^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(email)) return "Email 格式不對，請再確認一次";
  const fix = emailTypoSuggestion(email);
  if (fix) return `Email 的網域看起來打錯了，你是不是要打 ${fix}？`;
  return "";
}
