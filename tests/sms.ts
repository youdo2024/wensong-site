/*
 * 簡訊的檢查（不連外網，也不會真的寄出去）。
 *   DATA_DIR=/tmp/sms node --experimental-strip-types --import ./tests/reg.mjs tests/sms.ts
 *
 * 重點在兩件事：
 *   白名單沒過時不送出但要留紀錄——靜靜地失敗等於客人沒收到而你不知道。
 *   超長時截內文不截網址也不截署名——半條網址等於整則簡訊白寄，而且照樣扣錢；
 *   少了署名則是整則被電信商擋下（NCC 實名制標示）。
 *   站長改過模板之後，這兩件事都還要成立。
 */
import db, { setSetting } from "@/lib/db";
import { composeSms, sendSms, smsReady, SMS_LIMIT, pendingSms, failedSms, payUrlFor, smsSignature } from "@/lib/sms";
const r: boolean[] = [];
const t = (l: string, g: unknown, w: unknown) => { const p=JSON.stringify(g)===JSON.stringify(w); r.push(p); console.log(`${p?"✓":"✗"} ${l}${p?"":`　得 ${JSON.stringify(g)}`}`); };

console.log("── 白名單沒過就不送出，但要留紀錄 ──");
t("尚未就緒", smsReady().ok, false);
const a = await sendSms({ phone: "0912345678", body: "測試", kind: "manual" });
t("回失敗", a.ok, false);
console.log("   原因:", a.error);
t("有留紀錄且狀態是 blocked", (db.prepare("SELECT status FROM sms_log ORDER BY id DESC LIMIT 1").get() as any).status, "blocked");

console.log("\n── 號碼格式 ──");
const b = await sendSms({ phone: "12345", body: "x" });
t("擋下錯的號碼", b.ok, false);
t("也留了紀錄", (db.prepare("SELECT COUNT(*) c FROM sms_log").get() as any).c, 2);

console.log("\n── 組裝：開頭是對方名字，結尾是署名 ──");
setSetting("sms_brand", "問爽的");
setSetting("sms_signature", "問爽的 WenSong");
const url = payUrlFor("YD2609010001", "abc123def456");
const s1 = composeSms(pendingSms({ order_no: "YD2609010001", total: 1360, name: "王小明" }), url);
console.log("   實際內容：\n" + s1.split("\n").map(x=>"     "+x).join("\n"));
t("開頭是對方名字", s1.startsWith("王小明"), true);
t("最後一行是署名", s1.split("\n").pop(), "問爽的 WenSong");
t("長度在上限內", s1.length <= SMS_LIMIT, true);
t("網址完整保留", s1.includes(url), true);

console.log("\n── 沒填姓名時不要留下空格或 {name} ──");
const s1b = composeSms(pendingSms({ order_no: "YD2609010001", total: 1360 }), url);
t("不會漏出變數", s1b.includes("{"), false);
t("不是空白開頭", s1b.startsWith(" "), false);

console.log("\n── 站長自己改模板 ──");
setSetting("sms_tpl_pending", "哈囉 {name}，訂單 {order} 還沒付款，金額 {total} 元。");
const s1c = composeSms(pendingSms({ order_no: "YD9", total: 800, name: "陳小華" }), url);
t("用了新模板", s1c.startsWith("哈囉 陳小華，訂單 YD9"), true);
t("金額有代入", s1c.includes("800 元"), true);
t("署名照樣在最後", s1c.endsWith("問爽的 WenSong"), true);

console.log("\n── 清空模板等於還原預設，不是寄出空白簡訊 ──");
setSetting("sms_tpl_pending", "");
t("退回預設文案", pendingSms({ order_no: "YD9", total: 800, name: "陳小華" }).startsWith("陳小華 你好"), true);

console.log("\n── 署名留空要退回實名制身份，不能真的沒有標示 ──");
setSetting("sms_signature", "");
t("退回品牌名", smsSignature(), "問爽的");
setSetting("sms_signature", "問爽的 WenSong");

console.log("\n── 超長內文：截內文，不截網址也不截署名 ──");
const s2 = composeSms("字".repeat(400), url);
t("總長不超過上限", s2.length <= SMS_LIMIT, true);
t("網址仍然完整", s2.includes(url), true);
t("署名仍然完整", s2.endsWith("問爽的 WenSong"), true);
t("內文被截斷有省略號", s2.includes("…"), true);

console.log("\n── 失敗救援的文案 ──");
const s3 = composeSms(failedSms({ order_no: "YD2609010002", name: "王小明" }), url);
console.log("   " + s3.replace(/\n/g, " / "));
t("也在上限內", s3.length <= SMS_LIMIT, true);
t("開頭是名字", s3.startsWith("王小明"), true);

console.log(`\n${r.filter(Boolean).length} / ${r.length} 通過`);
process.exit(r.some(x=>!x)?1:0);
