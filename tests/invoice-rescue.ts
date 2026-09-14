/*
 * 發票降級補開的檢查（手動執行，會真的打光貿的「測試環境」開出測試發票）。
 *
 *   DATA_DIR=/tmp/invtest AMEGO_TAX_ID= AMEGO_APP_KEY= \
 *     node --experimental-strip-types --import ./tests/reg.mjs tests/invoice-rescue.ts
 *
 * 沒有放進 npm run smoke 的原因：它要連外網、會產生真的測試發票號碼，
 * 而冒煙測試必須離線、可以無限次重跑。
 *
 * 開頭那道閘門不可以拿掉：抓到正式金鑰就中止，否則會對真的發票帳號開票。
 *
 * 2026-08-31 對光貿測試環境實測的結論（前一版的註解寫錯了，這是更正後的）：
 *   載具　　光貿會驗，未註冊的號碼回「3040132 載具號碼不存在」
 *   捐贈碼　光貿會驗，不在財政部清單的碼回「3040137 NPOBAN 不存在」
 *   統編　　光貿【只驗檢查碼】，不驗存不存在。12345670 檢查碼過得了、
 *           經濟部查是「不存在」，光貿照樣開出一張 B2B 發票。
 *
 *   所以三個欄位裡，只有統編的錯誤是「靜靜地開出一張錯的發票」，
 *   另外兩個至少會被拒收、被下面的降級補開接住。
 *
 *   第一版的註解寫「光貿連捐贈碼也不驗」，那是錯的：當時拿 9999999 當反例，
 *   而 9999999 其實是桃園市立迴龍國民中小學的真捐贈碼。樣本挑錯，結論就錯。
 */
import { issueSponsorInvoice, amegoConfig } from "@/lib/amego";

const cfg = amegoConfig();
if (cfg.live) {
  console.error("！偵測到正式光貿金鑰，測試中止（這支只能對測試環境跑）");
  process.exit(1);
}
console.log("環境：光貿測試環境 統編", cfg.taxId, "\n");

const stamp = Date.now();
let n = 0;
const base = { amount: 680, email: "test@example.com", displayName: "測試", itemDesc: "測試品項" };
const seen = new Set<string>();
const results: boolean[] = [];

async function t(label: string, invoiceType: string, invoiceData: Record<string, string>, expect: "ok" | "degraded" | "fail") {
  const res = await issueSponsorInvoice({ ...base, orderId: `U${stamp}${++n}`, invoiceType, invoiceData });
  const got = res.no ? (res.degraded ? "degraded" : "ok") : "fail";
  const pass = got === expect;
  results.push(pass);
  console.log(`${pass ? "✓" : "✗"} ${label}　→ ${got}${res.no ? `　${res.no}` : ""}${res.dropped ? `　（拿掉：${res.dropped}）` : ""}`);
  if (res.no) {
    if (seen.has(res.no)) console.log("    ！同一號碼出現兩次，可能重複開立");
    seen.add(res.no);
  }
}

console.log("── 被光貿拒收就降級補開，客人一定拿得到發票 ──");
await t("載具號碼不存在", "b2c", { carrierType: "手機條碼", carrierNo: "/ZZZZZZZ" }, "degraded");
await t("載具格式對但未註冊", "b2c", { carrierType: "手機條碼", carrierNo: "/ABC1234" }, "degraded");

console.log("\n── 光貿接受，不該降級 ──");
await t("乾淨的 B2C，寄 Email", "b2c", {}, "ok");
await t("捐贈碼 8585（家扶基金會）", "b2c", { npoban: "8585" }, "ok");
await t("捐贈碼 9999999（桃園市立迴龍國中小，是真的）", "b2c", { npoban: "9999999" }, "ok");
await t("統編 53212539", "b2b", { taxId: "53212539", company: "測試公司" }, "ok");

await t("捐贈碼 105（不在財政部清單）", "b2c", { npoban: "105" }, "degraded");

console.log("\n── 光貿「不」幫我們擋的，所以本站必須自己驗 ──");
/* 12345670 檢查碼過得了，但經濟部查是「不存在」。光貿照開一張 B2B 發票，
   沒有任何錯誤——這是三個欄位裡唯一「靜靜地開出一張錯的」的失敗模式 */
await t("統編 12345670 不存在，光貿照開", "b2b", { taxId: "12345670", company: "亂打的" }, "ok");

console.log(`\n發票號碼 ${seen.size} 個，全部不重複：${seen.size === n ? "是" : "否（有重複開立）"}`);
console.log(`${results.filter(Boolean).length} / ${results.length} 符合預期`);
if (results.some((x) => !x) || seen.size !== n) process.exit(1);
