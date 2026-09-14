/*
 * 電子報引擎的檢查（不連外網，只驗佇列邏輯與退訂）。
 *
 *   DATA_DIR=/tmp/nl NEWSLEOPARD_API_KEY=k NEWSLEOPARD_FROM=a@b.com \
 *     node --experimental-strip-types --import ./tests/reg.mjs tests/newsletter.ts
 *
 * 一定要用全新的 DATA_DIR：這支會造測試訂閱者與測試電子報。
 * 最重要的兩項是「重複按開始寄送不會重排」與「退訂的人不進佇列」——
 * 前者防重寄，後者是法遵。
 */
/* 電子報引擎的檢查：不連外網，只驗佇列與不重寄 */
import db from "@/lib/db";
import { startNewsletter, newsletterProgress, unsubUrl, unsubscribeByToken, audienceCount, retryFailed } from "@/lib/newsletter";
const r: boolean[] = [];
const t = (l: string, g: unknown, w: unknown) => { const p = JSON.stringify(g) === JSON.stringify(w); r.push(p); console.log(`${p ? "✓" : "✗"} ${l}${p ? "" : `　得 ${JSON.stringify(g)} 期 ${JSON.stringify(w)}`}`); };

/* 造 5 位訂閱者 */
const now = new Date().toISOString();
for (let i = 1; i <= 5; i++)
  db.prepare("INSERT INTO subscribers (email,name,source,created_at) VALUES (?,?,?,?) ON CONFLICT(email) DO NOTHING")
    .run(`u${i}@example.com`, `讀者${i}`, "test", now);
t("可寄人數 5", audienceCount(), 5);

console.log("\n── 退訂 ──");
const url = unsubUrl("u2@example.com");
const tok = url.split("t=")[1];
t("退訂連結是 32 位十六進位", /^[a-f0-9]{32}$/.test(tok), true);
t("同一個人拿到同一個權杖", unsubUrl("u2@example.com").split("t=")[1], tok);
t("退訂成功", unsubscribeByToken(tok), true);
t("退訂後可寄人數剩 4", audienceCount(), 4);
t("亂填的權杖無效", unsubscribeByToken("x".repeat(32)), false);

console.log("\n── 建立與排入佇列 ──");
const nid = Number(db.prepare("INSERT INTO newsletters (subject,title,body,status,created_at) VALUES ('測試','標題','內文','draft',?)").run(now).lastInsertRowid);
const s1 = startNewsletter(nid);
t("排入 4 位（退訂的不算）", s1.queued, 4);
t("狀態 sending", (db.prepare("SELECT status FROM newsletters WHERE id=?").get(nid) as any).status, "sending");
t("進度 0/4", newsletterProgress(nid), { total: 4, sent: 0, failed: 0, pending: 4 });

console.log("\n── 重複按「開始寄送」不會重排 ──");
const s2 = startNewsletter(nid);
t("第二次被擋", s2.ok, false);
t("佇列還是 4 筆", newsletterProgress(nid).total, 4);

console.log("\n── 失敗重試 ──");
db.prepare("UPDATE newsletter_sends SET status='failed', error='測試' WHERE newsletter_id=? AND id IN (SELECT id FROM newsletter_sends WHERE newsletter_id=? LIMIT 2)").run(nid, nid);
t("2 筆失敗", newsletterProgress(nid).failed, 2);
t("重試放回 2 筆", retryFailed(nid), 2);
t("失敗歸零、待寄 4", newsletterProgress(nid), { total: 4, sent: 0, failed: 0, pending: 4 });

console.log(`\n${r.filter(Boolean).length} / ${r.length} 通過`);
process.exit(r.some((x) => !x) ? 1 : 0);
