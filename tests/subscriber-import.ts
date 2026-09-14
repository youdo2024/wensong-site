/*
 * 訂閱名單匯入的檢查（不連外網）。
 *   DATA_DIR=/tmp/imp node --experimental-strip-types --import ./tests/reg.mjs tests/subscriber-import.ts
 *
 * 最重要的一項是「退訂的人不會被加回來」。ManyChat 那張表是累積的，
 * 退訂的人還留在裡面；每次同步都復活他，他會一直收信一直退訂，
 * 最後按「檢舉為垃圾郵件」，那一下傷的是整個網域的信譽。
 */
import db from "@/lib/db";
import { extractEmails, importEmails } from "@/lib/subscriber-import";
const r: boolean[] = [];
const t = (l: string, g: unknown, w: unknown) => { const p=JSON.stringify(g)===JSON.stringify(w); r.push(p); console.log(`${p?"✓":"✗"} ${l}${p?"":`　得 ${JSON.stringify(g)} 期 ${JSON.stringify(w)}`}`); };

console.log("── 從各種格式撈 email ──");
t("CSV 一列", extractEmails("姓名,Email\n小明,a@example.com\n小華,b@example.com"), ["a@example.com","b@example.com"]);
t("一行一個", extractEmails("a@example.com\nb@example.com"), ["a@example.com","b@example.com"]);
t("重複只留一個", extractEmails("a@example.com, A@Example.com"), ["a@example.com"]);
t("沒有 email 回空", extractEmails("小明,0912345678"), []);

console.log("\n── 匯入 ──");
const r1 = importEmails("a@example.com\nb@example.com\nc@example.com");
t("新增 3", r1.added, 3);
const r2 = importEmails("a@example.com\nd@example.com");
t("已存在 1、新增 1", [r2.existed, r2.added], [1,1]);

console.log("\n── 退訂的人不會被加回來（這是重點）──");
db.prepare("UPDATE subscribers SET unsubscribed_at=? WHERE email='a@example.com'").run(new Date().toISOString());
const r3 = importEmails("a@example.com\ne@example.com");
t("退訂的被跳過", r3.skippedUnsub, 1);
t("沒有被復活", (db.prepare("SELECT unsubscribed_at FROM subscribers WHERE email='a@example.com'").get() as any).unsubscribed_at !== "", true);
t("新的還是進得來", r3.added, 1);

console.log("\n── 明顯打錯的網域擋下來 ──");
const r4 = importEmails("typo@gamil.com");
t("被歸類為格式有問題", r4.invalid.length >= 1, true);
t("沒有寫進資料庫", db.prepare("SELECT COUNT(*) c FROM subscribers WHERE email='typo@gamil.com'").get(), {c:0});

console.log(`\n${r.filter(Boolean).length} / ${r.length} 通過`);
process.exit(r.some(x=>!x)?1:0);
