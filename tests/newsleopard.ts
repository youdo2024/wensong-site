/*
 * 電子豹 API 客戶端的檢查（手動執行，會真的連到電子豹）。
 *
 *   DATA_DIR=/tmp/nl NEWSLEOPARD_API_KEY=... NEWSLEOPARD_FROM=... \
 *     node --experimental-strip-types --import ./tests/reg.mjs tests/newsleopard.ts
 *
 * 金鑰不寫在這裡，執行時從環境變數帶進來。
 * 這裡只用「一定會失敗」的收件人，不會真的寄信給任何人。
 *
 * 最重要的那一項是第一個：電子豹對「整批收下但個別收件人有問題」一樣回 HTTP 200，
 * 錯誤放在 body 的 failure 裡。只看狀態碼的話，寄不出去會被當成寄成功。
 */
import { sendEmail, sendSms, newsleopardEnabled, newsleopardFrom, SMS_MAX_LEN } from "@/lib/newsleopard";
console.log("啟用:", newsleopardEnabled(), "｜寄件人:", JSON.stringify(newsleopardFrom()));
console.log();
console.log("── 郵件：格式錯誤的收件人（對方會回 200＋failure，我們要判定成失敗）──");
const a = await sendEmail({ to: "not-an-email", subject: "測試", html: "<p>x</p>" });
console.log("  ", a.ok ? "✗ 誤判成功" : "✓ 正確判定失敗", "｜", a.error);
console.log();
console.log("── 簡訊：超過 268 字，應該在送出前就擋下（不浪費一次請求）──");
const b = await sendSms({ to: "0912345678", content: "字".repeat(300) });
console.log("  ", b.ok ? "✗ 沒擋到" : "✓ 擋下", "｜", b.error);
console.log();
console.log("── 簡訊：電話格式不符 ──");
const c = await sendSms({ to: "abc", content: "測試" });
console.log("  ", c.ok ? "✗" : "✓", "｜", c.error);
console.log();
console.log("SMS 上限常數:", SMS_MAX_LEN);
