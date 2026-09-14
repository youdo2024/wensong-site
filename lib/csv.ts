/*
 * CSV 儲存格逸出，含公式注入防護（OWASP CSV Injection）。
 *
 * 顧客可以把姓名、地址填成 `=HYPERLINK(...)`、`=cmd|...`、`@SUM(...)` 這種東西，
 * 原樣寫進 CSV 後，站長或夥伴用 Excel／Google Sheets 一開，那格就被當公式執行——
 * 輕則外連竊資料，重則觸發本機命令。我們自己收顧客資料、又自己匯出給夥伴，
 * 剛好是這個攻擊的完整路徑。
 *
 * 防法（業界標準）：值若以 = + - @ 或 Tab／換行 開頭，前面補一個單引號，
 * 試算表就當它是純文字。再照 RFC4180 用雙引號包、內部雙引號變兩個。
 */
export function csvCell(v: unknown): string {
  let s = String(v ?? "");
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return `"${s.replaceAll('"', '""')}"`;
}
