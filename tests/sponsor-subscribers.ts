/*
 * 贊助者同步進電子報名單的檢查（不連外網）。
 *   DATA_DIR=/tmp/sp node --experimental-strip-types --import ./tests/reg.mjs tests/sponsor-subscribers.ts
 *
 * 四個重點：只收已付款的、尊重客人自己取消的勾選、冪等、退訂過的不會被復活。
 */
import db from "@/lib/db";
import { syncSponsorSubscribers } from "@/lib/newsletter";
const r: boolean[] = [];
const t=(l:string,g:unknown,w:unknown)=>{const p=JSON.stringify(g)===JSON.stringify(w);r.push(p);console.log(`${p?"✓":"✗"} ${l}${p?"":`　得 ${JSON.stringify(g)}`}`);};
const now=new Date().toISOString();
const add=(email:string,status:string,nl=1)=>db.prepare("INSERT INTO sponsorships (mode,amount,display_name,message,email,phone,pay_method,invoice_type,invoice_data,status,created_at,newsletter) VALUES ('once',888,?, '',?,'0912345678','信用卡','b2c','{}',?,?,?)").run("支持者"+email[0],email,status,now,nl);

add("a@example.com","paid");
add("b@example.com","active");
add("c@example.com","pending");        // 還沒付款
add("d@example.com","paid",0);         // 自己取消訂閱
t("同步進 2 位（paid + active）", syncSponsorSubscribers(), 2);
t("pending 沒進來", db.prepare("SELECT COUNT(*) c FROM subscribers WHERE email='c@example.com'").get(), {c:0});
t("取消勾選的沒進來", db.prepare("SELECT COUNT(*) c FROM subscribers WHERE email='d@example.com'").get(), {c:0});
t("來源標記是「贊助」", (db.prepare("SELECT source FROM subscribers WHERE email='a@example.com'").get() as any).source, "贊助");

console.log("\n── 冪等：再跑一次不應該重複新增 ──");
t("第二次新增 0", syncSponsorSubscribers(), 0);

console.log("\n── 退訂過的不會被復活 ──");
db.prepare("UPDATE subscribers SET unsubscribed_at=? WHERE email='a@example.com'").run(now);
t("同步後仍是退訂狀態", (db.prepare("SELECT unsubscribed_at FROM subscribers WHERE email='a@example.com'").get() as any).unsubscribed_at !== "" && syncSponsorSubscribers()===0, true);

console.log(`\n${r.filter(Boolean).length} / ${r.length} 通過`);
process.exit(r.some(x=>!x)?1:0);
