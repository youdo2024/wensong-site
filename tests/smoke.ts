/*
 * 冒煙測試：改壞了會直接虧錢或寄錯貨的純邏輯。
 *
 * 跑法（免安裝任何測試框架，Node 22 內建就夠）：
 *   npm run smoke
 *
 * 範圍刻意只挑「純函式」：不碰資料庫、不寄信、不打金流。
 * 需要環境的測試假起來比省下的時間更貴，那些交給部署前的手動驗證。
 * 這份的價值是：改 lib 的人跑一次十秒內就知道有沒有把別人的路踩壞。
 */
import { normalizePhone, phoneKind, phoneUsable } from "@/lib/phone";
import { parseGiftList } from "@/lib/gift-parse";
import { clampDesc } from "@/lib/seo";
import { isMultiShip, recipientAddress, shipListTotal } from "@/lib/multi-ship";
import { imgSrc, WIDTHS } from "@/lib/img-src";
import { sponsorResumeMailHtml, orderPayLinkMailHtml, htmlToText, orderChooseUrl, sponsorChooseUrl } from "@/lib/mail";
import { verifyLineSignature, composeLine, renderLine, orderNoFromText, LINE_MAX_LEN } from "@/lib/line";
import { taipeiDayStartIso, oaBindDecision, oaBindCountToday, logOaBindAttempt, LINE_OA_BIND_DAILY_CAP, LINE_KINDS, lineTemplate } from "@/lib/line";
import { makeBindCookie, parseBindCookie, makeSponsorCookie, parseSponsorCookie } from "@/lib/line-bind";
import { orderChannels, notifySummary, NOTIFY_KINDS } from "@/lib/notify-order";
import { ECPAY_ATM_BANKS, ecpayAtmBank, buildCheckoutFields } from "@/lib/ecpay";
import { genpayEncrypt, genpayDecrypt, genpayMtnFor, isGenpayMtn, orderNoFromGenpayMtn, genpaySponsorMtn, sponsorIdFromGenpayMtn } from "@/lib/ecpay-genpay";
import { quietUntil, STEP_OFFSETS_MIN, FAIL_AFTER_MIN } from "@/lib/remind";
import { renderCopy, copyDefault, COPY_EVENTS } from "@/lib/notify-copy";
import { parseUtmCode, utmQuery, UTM_CHANNELS, utmLinksFor } from "@/lib/utm-link";
import { createHmac, createCipheriv } from "crypto";
import { deriveZip, zipDisplay } from "@/lib/zip-lookup";
import { createThrottle, isNoise, sanitizeCspUrl, violationKey } from "@/lib/csp-noise";
import { passwordUsable, accountModeEnabled } from "@/lib/admin-password";
import { hashPassword, verifyPassword } from "@/lib/admin-users";
import { activeChoices, choiceActive, parseChoiceExpiry, splitChoices, weekRetired } from "@/lib/choice-split";
import { csvCell } from "@/lib/csv";
import { brandOfMethod, cvsMethodOf, isCvsMethod, normalizeBrand } from "@/lib/cvs";
import { computeFreight, hasCold, multiShipQuote, type OriginInfo } from "@/lib/freight";
import { copyTarget, recipientsLine, MAIL_KINDS, MAIL_KIND_LABEL, logMail, listSent, mailLogFor, mailLogById, type CopyPlan } from "@/lib/mail-log";
import { isUnshipped, ADMIN_MAIL_MAX, parseRecipients } from "@/lib/admin-mail";
import { MULTI_SHIP } from "@/lib/multi-ship";
import db from "@/lib/db";
import { readFileSync } from "fs";
import { relTime, statusTone, orderLast4 } from "@/components/admin/order-fmt";
import { sponsorTone, sponsorModeLabel, remindTone } from "@/components/admin/sponsor-fmt";
import { mailTabFromParams, contactTone, payLinkStatus, newsletterStatus } from "@/components/admin/list-fmt";
import { willWrite, carriesField, SETTING_SOURCES } from "@/components/admin/settings-fields";
import { safeEqual } from "@/lib/safe-equal";
import { taipeiDateExpired, taipeiYMDAt } from "@/lib/month";
import { DEFAULT_EPOCH, packSession, parseEpoch, sessionUser, verifySession } from "@/lib/admin-session";
import {
  SHORT_ALPHABET, SHORT_CODE_LEN, newShortCode, internalPath, shortSiteUrl,
  ensureShortLink, shortUrl, resolveShortPath, shortLinkByCode, shortClickSummary,
} from "@/lib/short-link";
import { linksFor, type Target } from "@/lib/remind";
import { shortBindUrl } from "@/lib/line";
import { renderSms, smsTemplateDefault, SMS_LIMIT, pendingTplKey, composeSms } from "@/lib/sms";
import { orderNotifyRecipients, logOrderNotifySkip } from "@/lib/notify";
import { rememberSponsorTradeNo, sponsorByTradeNo, sponsorTradeNoHistory, staleSponsorPaymentAction } from "@/lib/sponsor-trade-no";
import { syncSummary, type SyncState } from "@/lib/subscriber-import";
import { shouldSyncNow, SYNC_HOUR } from "@/lib/sheet-sync";
import { fmtDateTimeDash } from "@/lib/format";

let pass = 0, fail = 0;
function eq(label: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++;
  else { fail++; console.error(`  ✗ ${label}\n    得到 ${JSON.stringify(got)}\n    預期 ${JSON.stringify(want)}`); }
}
function ok(label: string, cond: boolean) {
  if (cond) pass++;
  else { fail++; console.error(`  ✗ ${label}`); }
}

/* ── 電話：贈品名單什麼格式都會出現 ── */
eq("市話清洗", normalizePhone("04 2235 1691"), "0422351691");
eq("+886 換回 0", normalizePhone("+886 912 345 678"), "0912345678");
eq("全形數字", normalizePhone("０９１２３４５６７８"), "0912345678");
eq("分機保留", normalizePhone("04-22351691 分機 12"), "0422351691#12");
eq("手機判定", phoneKind("0912-345-678"), "mobile");
eq("市話判定", phoneKind("02-27001234"), "landline");
eq("亂碼擋下", phoneKind("abc"), "bad");
ok("太短擋下", !phoneUsable("123"));

/* ── 贈品名單解析：拆錯的代價是貨寄到別人家 ── */
const rows = parseGiftList(`2盒：

王小明
0912345678
台北市中正區重慶南路一段122號

姓名：陳小美
電話：0223456789
虎爺門市 店號:210133`);
eq("拆出兩位", rows.length, 2);
eq("盒數套用到整段", rows.map((r) => r.qty), ["2", "2"]);
eq("宅配那位的地址", rows[0].address, "台北市中正區重慶南路一段122號");
eq("超商那位的店號", rows[1].storeNo, "210133");
eq("超商門市名去掉「門市」", rows[1].storeName, "虎爺");
eq("超商判定", rows[1].shipMethod, "7-11店到店");

/* ── 摘要截斷 ──
   實際行為：能切在句號就切在句號；句號切完剩太短則硬切補省略號
   （太短的摘要比斷句更糟）。測的是這份契約，不是想像中的。 */
eq("切在完整句號", clampDesc("第一句話。第二句比較長一點的話。第三句絕對放不下的話。", 20), "第一句話。第二句比較長一點的話。");
ok("句號太前面時硬切補省略號", clampDesc("第一句話。第二句比較長一點的話。", 15).endsWith("…"));
eq("短文不動", clampDesc("很短。", 110), "很短。");

/* ── 多地址出貨：字串旗標已經出過三次事 ── */
ok("旗標認得", isMultiShip("多地址配送"));
ok("別的字不認", !isMultiShip("宅配"));
eq("超商地址組合", recipientAddress({ name: "x", phone: "y", shipMethod: "7-11店到店", address: "", storeName: "虎爺", storeNo: "210133", qty: 1 }),
   "7-11「虎爺」門市（店號 210133）取貨");
eq("總盒數", shipListTotal([{ name: "a", phone: "p", address: "z", qty: 2 }, { name: "b", phone: "p", address: "z", qty: 3 }]), 5);

/* ── 圖片 srcset：只對站內上傳圖動手 ── */
const g = imgSrc("/api/images/a.jpg", "100vw");
ok("srcset 含全部寬度", WIDTHS.every((w) => (g.srcSet || "").includes(`w=${w} ${w}w`)));
eq("src 指向 1200", g.src, "/api/images/a.jpg?w=1200");
eq("外部網址不動", imgSrc("https://example.com/x.jpg"), { src: "https://example.com/x.jpg" });
eq("品牌素材不動", imgSrc("/brand/logo.png"), { src: "/brand/logo.png" });

/* ── 信件跳脫：惡意姓名一個標籤都不准插進去 ── */
const base = { id: 1, mode: "single", amount: 500, email: "a@b.c", provider: "ecpay", pay_method: "credit", pay_token: "t", atm_bank: "", atm_vaccount: "", atm_expire: "" };
const evil = sponsorResumeMailHtml({ ...base, display_name: '陳<img src=x onerror=alert(1)>' } as never).html;
const safe = sponsorResumeMailHtml({ ...base, display_name: "陳則佑" } as never).html;
const tags = (h: string) => (h.match(/<[a-zA-Z][^>]*>/g) || []).length;
eq("惡意輸入插不進任何標籤", tags(evil), tags(safe));
ok("原始 <img 沒有出現", !evil.includes("<img src=x"));
ok("字仍看得到（跳脫成文字）", evil.includes("&lt;img"));

/* ── 郵遞區號反查：紅線是「寧可查無，不可猜錯」 ── */
eq("一般地址", deriveZip("台中市南屯區南屯路二段290號15樓"), "408");
eq("臺字寫法", deriveZip("110臺北市信義區三張里莊敬路391巷5號"), "110");
eq("縣轄市當區", deriveZip("302新竹縣竹北市泰和里泰和一街75號5樓"), "302");
eq("多縣市同名區（新竹）", deriveZip("新竹市東區光復路一段1號"), "300");
eq("多縣市同名區（台南）", deriveZip("台南市東區崇學路100號"), "701");
eq("沒寫區必須查無", deriveZip("台中市忠明南路817號六樓之二"), null);
eq("只有區沒縣市必須查無", deriveZip("新店區北新路一段1號"), null);
eq("路名含台字", deriveZip("新北市汐止區新台五路一段95號33樓"), "221");
eq("顯示：自動前綴", zipDisplay("台中市大里區新明路59號").text, "412 台中市大里區新明路59號");
eq("顯示：客寫一致不重複", zipDisplay("24160新北市三重區重新路五段321號").text, "24160新北市三重區重新路五段321號");
eq("顯示：客寫衝突標原寫", zipDisplay("999 新北市三重區重新路五段321號").note, "⚠ 原寫 999");
eq("顯示：查無要標", zipDisplay("台中市忠明南路817號").note, "⚠ 查無郵遞區號");
eq("顯示：手動最大", zipDisplay("999 新北市三重區重新路五段321號", "241").text, "241 新北市三重區重新路五段321號");
eq("顯示：手動蓋查無", zipDisplay("台中市忠明南路817號", "403").text.slice(0, 3), "403");

/* ── CSP 回報降噪：雜訊要濾掉，真的違規一條都不能濾掉 ── */
ok("注入的 Cloud Run 追蹤算雜訊", isNoise("https://mpc2-prod-28-is5qnl632q-ue.a.run.app/events?cee=no"));
ok("擴充功能協定算雜訊", isNoise("chrome-extension://abcdef/inject.js"));
ok("我們自己漏掉的網域不可當雜訊", !isNoise("https://cdn.jsdelivr.net/npm/x.js"));
ok("inline 不可當雜訊", !isNoise("inline"));
ok("空字串不可當雜訊", !isNoise(""));
ok("結尾比對不可誤傷同名前綴", !isNoise("https://evil-a.run.app.example.com/x"));
eq("同網域不同路徑歸同一鍵", violationKey("connect-src", "https://a.example.com/1?x=1"), violationKey("connect-src", "https://a.example.com/2?y=2"));
ok("不同指令不歸同一鍵", violationKey("script-src", "https://a.example.com/1") !== violationKey("connect-src", "https://a.example.com/1"));
eq("非網址用原字串當鍵", violationKey("script-src", "inline"), "script-src|inline");

const th = createThrottle(1000, 10);
eq("同種違規第一次要記", th.check("k", 0), { log: true, suppressed: 0 });
eq("視窗內第二次不記", th.check("k", 100), { log: false, suppressed: 1 });
eq("視窗內第三次不記且累計", th.check("k", 200), { log: false, suppressed: 2 });
eq("新種類立刻現形", th.check("k2", 200), { log: true, suppressed: 0 });
eq("過了視窗再記並回報壓下幾次", th.check("k", 1200), { log: true, suppressed: 2 });
eq("重記之後計數歸零", th.check("k", 1300), { log: false, suppressed: 1 });

const cap = createThrottle(60_000, 3);
for (let i = 0; i < 10; i++) cap.check(`host${i}`, 0);
ok("鍵數超過上限會倒掉重來，不會無限長大", cap.size() <= 3);


/* ── 額滿規格收合：收錯了會讓客人以為東西賣光，或讓頁面剩一片空白 ── */
const WK = ["8/24", "8/31", "9/7", "9/21", "9/28", "10/5"];
const full4 = ["8/24", "8/31", "9/7", "9/21"];
eq("開關關著就不收合", splitChoices(WK, full4, false).collapse, false);
eq("開關開＋額滿四個要收合", splitChoices(WK, full4, true).collapse, true);
eq("收合後上面只剩可選的", splitChoices(WK, full4, true).open, ["9/28", "10/5"]);
eq("額滿的照後台原順序", splitChoices(WK, full4, true).full, full4);
eq("只額滿一個不收合", splitChoices(WK, ["8/24"], true).collapse, false);
eq("額滿兩個就收合", splitChoices(WK, ["8/24", "8/31"], true).collapse, true);
eq("全部額滿強制不收合", splitChoices(WK, WK, true).collapse, false);
eq("全部額滿要標記出來", splitChoices(WK, WK, true).allFull, true);
eq("還有得選就不算全滿", splitChoices(WK, full4, true).allFull, false);
eq("沒有規格的商品不算全滿", splitChoices([], [], true).allFull, false);
eq("一個都沒額滿不收合", splitChoices(WK, [], true).collapse, false);
eq("額滿名單有不存在的值也不影響", splitChoices(WK, ["不存在", "8/24"], true).collapse, false);


/* ── 運費引擎（四格費率：溫層×取貨方式）：算錯直接反映在每一張訂單的錢上 ── */
const ORIGINS: Record<number, OriginInfo> = {
  1: { origin: 1, originName: "蛋捲工坊", temp: "ambient" },
  2: { origin: 2, originName: "梅子工坊", temp: "ambient" },
  3: { origin: 2, originName: "梅子工坊", temp: "cold" },
  4: { origin: 0, originName: "問爽的本店", temp: "ambient" },
};
const oi = (id: number) => ORIGINS[id];
/* 站長 2026-08-30 給的實際費率 */
const RATES = {
  charge: { "ambient-home": 125, "ambient-cvs": 65, "cold-home": 280, "cold-cvs": 145 },
  cost: { "ambient-home": 120, "ambient-cvs": 60, "cold-home": 250, "cold-cvs": 140 },
  free: { "ambient-home": 1440, "ambient-cvs": 1440, "cold-home": 3000, "cold-cvs": 3000 },
};
const OPT = { mode: "origin" as const, isCvs: false, rates: RATES, allFree: false };

eq("兩個出貨地各收一次", computeFreight([{ id: 1, price: 500, qty: 1 }, { id: 2, price: 500, qty: 1 }], oi, OPT).total, 250);
eq("同出貨地同溫層只收一次", computeFreight([{ id: 2, price: 500, qty: 1 }, { id: 2, price: 300, qty: 2 }], oi, OPT).total, 125);
eq("同夥伴常溫＋冷凍拆兩包", computeFreight([{ id: 2, price: 500, qty: 1 }, { id: 3, price: 500, qty: 1 }], oi, OPT).total, 125 + 280);
eq("免運各組各自算", computeFreight([{ id: 1, price: 1500, qty: 1 }, { id: 2, price: 500, qty: 1 }], oi, OPT).total, 125);
eq("全車合併不會誤免", computeFreight([{ id: 1, price: 800, qty: 1 }, { id: 2, price: 800, qty: 1 }], oi, OPT).total, 250);
eq("超商費率(常溫)", computeFreight([{ id: 1, price: 500, qty: 1 }], oi, { ...OPT, isCvs: true }).total, 65);
eq("冷凍店到店已解禁且用自己的費率", computeFreight([{ id: 3, price: 500, qty: 1 }], oi, { ...OPT, isCvs: true }).total, 145);
eq("冷凍宅配 280", computeFreight([{ id: 3, price: 500, qty: 1 }], oi, OPT).total, 280);
eq("冷凍門檻 3000：買 2000 仍要運費", computeFreight([{ id: 3, price: 2000, qty: 1 }], oi, OPT).total, 280);
eq("冷凍滿 3000 免運", computeFreight([{ id: 3, price: 3000, qty: 1 }], oi, OPT).total, 0);
eq("本店也是一個出貨地", computeFreight([{ id: 1, price: 500, qty: 1 }, { id: 4, price: 500, qty: 1 }], oi, OPT).total, 250);
eq("空車零運費", computeFreight([], oi, OPT).total, 0);

/* 成本：免運照樣要付，這是站長要看的「我要多付多少」 */
eq("成本不受免運影響", computeFreight([{ id: 1, price: 5000, qty: 1 }], oi, OPT).costTotal, 120);
eq("免運時收 0 但成本 120", computeFreight([{ id: 1, price: 5000, qty: 1 }], oi, OPT).total, 0);
eq("兩包成本相加", computeFreight([{ id: 1, price: 100, qty: 1 }, { id: 3, price: 100, qty: 1 }], oi, OPT).costTotal, 120 + 250);
eq("冷凍店到店成本 140", computeFreight([{ id: 3, price: 100, qty: 1 }], oi, { ...OPT, isCvs: true }).costTotal, 140);
eq("折扣碼免運：收 0 成本照算", computeFreight([{ id: 1, price: 100, qty: 1 }], oi, { ...OPT, allFree: true }), { groups: computeFreight([{ id: 1, price: 100, qty: 1 }], oi, { ...OPT, allFree: true }).groups, total: 0, costTotal: 120 });

eq("flat 舊制整單一費", computeFreight([{ id: 1, price: 500, qty: 1 }, { id: 2, price: 500, qty: 1 }], oi, { ...OPT, mode: "flat" }).total, 125);
eq("flat 有冷鏈用冷鏈費率", computeFreight([{ id: 1, price: 500, qty: 1 }, { id: 3, price: 500, qty: 1 }], oi, { ...OPT, mode: "flat" }).total, 280);
ok("hasCold 抓得到冷鏈品", hasCold([{ id: 1, price: 1, qty: 1 }, { id: 3, price: 1, qty: 1 }], oi));
ok("全常溫不誤報", !hasCold([{ id: 1, price: 1, qty: 1 }, { id: 4, price: 1, qty: 1 }], oi));

/* 多地址企業單：無條件免第一位，其餘照收 */
const R20 = Array.from({ length: 20 }, (_, i) => ({ shipMethod: i < 18 ? "宅配" : "7-11店到店" }));
eq("20 位：18 宅配 2 超商，首位免運", multiShipQuote(R20, "ambient", RATES).total, 18 * 125 + 2 * 65 - 125);
eq("多地址統計宅配數", multiShipQuote(R20, "ambient", RATES).home, 18);
eq("多地址統計超商數", multiShipQuote(R20, "ambient", RATES).cvs, 2);
eq("只有一位＝全免", multiShipQuote([{ shipMethod: "宅配" }], "ambient", RATES).total, 0);
eq("空名單不炸", multiShipQuote([], "ambient", RATES).total, 0);

/* ── 規格下架日：藏錯了會賣出過期週或把要出的貨藏起來 ── */
const EXP = { "8/24 週": "2026-08-28", "9/28 週": "2026-10-02" };
ok("下架日當天仍可買", choiceActive("8/24 週", EXP, "2026-08-28"));
ok("下架日隔天消失", !choiceActive("8/24 週", EXP, "2026-08-29"));
ok("沒填日期永遠有效", choiceActive("10/5 週", EXP, "2027-01-01"));
eq("前台清單只留有效", activeChoices(["8/24 週", "9/28 週", "10/5 週"], EXP, "2026-08-29"), ["9/28 週", "10/5 週"]);
ok("壞日期格式當沒設定", choiceActive("x", parseChoiceExpiry('{"x":"八月底"}'), "2027-01-01"));
ok("還有待出貨的週不收", !weekRetired({ open: true }, "8/24 週", EXP, "2026-12-31"));
ok("保留期內不收(過期13天)", !weekRetired({ open: false }, "8/24 週", EXP, "2026-09-10"));
ok("過期15天且全出完才收", weekRetired({ open: false }, "8/24 週", EXP, "2026-09-12"));
ok("沒填下架日永遠不收", !weekRetired({ open: false }, "10/5 週", EXP, "2027-12-31"));


/* ── CSV 公式注入：顧客把姓名填成 =HYPERLINK 之類，Excel 開匯出檔會執行 ── */
ok("等號開頭補單引號", csvCell("=HYPERLINK(x)").startsWith("\"'="));
ok("加號開頭補單引號", csvCell("+1").startsWith("\"'+"));
ok("減號開頭補單引號", csvCell("-2").startsWith("\"'-"));
ok("at 開頭補單引號", csvCell("@SUM").startsWith("\"'@"));
eq("正常字串不動", csvCell("陳先生"), '"陳先生"');
eq("電話不誤傷（0 開頭）", csvCell("09-1234"), '"09-1234"');
eq("內部雙引號變兩個", csvCell('a"b'), '"a""b"');


/* ── 超商通路：判斷錯就是把全家當宅配算運費、或抓錯出貨清單 ── */
ok("7-11店到店 算超商", isCvsMethod("7-11店到店"));
ok("全家店到店 算超商", isCvsMethod("全家店到店"));
ok("宅配 不算超商", !isCvsMethod("宅配"));
ok("多地址 不算超商", !isCvsMethod("多地址配送"));
ok("空值 不算超商", !isCvsMethod(""));
ok("無需寄送 不算超商", !isCvsMethod("無需寄送"));
eq("組出 7-11 字串", cvsMethodOf("7-11"), "7-11店到店");
eq("組出全家字串", cvsMethodOf("全家"), "全家店到店");
eq("從字串認出全家", brandOfMethod("全家店到店"), "全家");
eq("從字串認出 7-11", brandOfMethod("7-11店到店"), "7-11");
eq("舊訂單認不出就當 7-11", brandOfMethod("宅配"), "7-11");
eq("亂填的品牌收斂成 7-11", normalizeBrand("萊爾富"), "7-11");
eq("全家保留", normalizeBrand("全家"), "全家");

/* ── 後台換付款方式的連結信：網址組錯，顧客點開就是「查無此單」 ── */
{
  const o = {
    order_no: "YD-2026 0901", name: "王小明", email: "a@b.tw", address: "台中市", items: "[]",
    subtotal: 720, shipping: 0, total: 720, token: "ab/cd&ef", pay_method: "ATM 轉帳",
  };
  const m = orderPayLinkMailHtml(o);
  const href = /href="([^"]+\/api\/orders\/pay[^"]*)"/.exec(m.html)?.[1] || "";
  ok("連結指向 /api/orders/pay", href.includes("/api/orders/pay?"));
  ok("訂單編號有編碼（空白）", href.includes("no=YD-2026%200901"));
  ok("權杖有編碼（/ 與 &）", href.includes("t=ab%2Fcd%26ef"));
  ok("m= 帶顧客要的方式", href.includes("m=ATM%20%E8%BD%89%E5%B8%B3"));
  ok("主旨寫明方式與編號", m.subject.includes("ATM 轉帳") && m.subject.includes("YD-2026 0901"));
  const evilPay = orderPayLinkMailHtml({ ...o, pay_method: '信用卡<img src=x onerror=alert(1)>' }).html;
  ok("付款方式名稱有跳脫", !evilPay.includes("<img src=x") && evilPay.includes("&lt;img"));
}

/* ── 信件純文字版：沒有純文字對照的 HTML 信垃圾分數較高，這層壞了信會直接進垃圾桶 ── */
{
  const t = htmlToText('<style>p{color:red}</style><p>你好，<b>問爽的</b></p><p>按這裡：<a href="https://www.wensong.tw/x?a=1&amp;b=2">前往付款</a></p><table><tr><td>A</td><td>B</td></tr></table>');
  ok("樣式表整段拿掉", !t.includes("color"));
  ok("標籤拿掉、文字留著", t.includes("你好，問爽的"));
  ok("連結展開成文字加網址且實體解回", t.includes("前往付款（https://www.wensong.tw/x?a=1&b=2）"));
  ok("表格儲存格之間有分隔", /A\s+B/.test(t));
  ok("純文字版本不含任何標籤", !/<[a-z]/i.test(t));
}

/* ── 贊助 cookie 與贊助綁定：簽不對或過期就要當沒有，否則任何人能把別人的贊助綁到自己的 LINE ── */
{
  const c = makeSponsorCookie(42, "tok-abc");
  eq("贊助 cookie 解回同一筆", JSON.stringify(parseSponsorCookie(c)), JSON.stringify({ id: 42, token: "tok-abc" }));
  ok("贊助 cookie 改一個字就失效", parseSponsorCookie(c.slice(0, -1) + (c.endsWith("a") ? "b" : "a")) === null);
  ok("贊助綁定的 orderNo 用 SP: 前綴走同一條 cookie", parseBindCookie(makeBindCookie("SP:42", "tok", "sponsor"))?.orderNo === "SP:42");
}

/* ── 綠界幕後取號的 AES 封包：對不上官方範例，正式站一發就是「解密失敗」 ── */
{
  const K = "pwFHCqoQZGmho4w6", V = "EkRm7iFT261dpevs";
  const enc = genpayEncrypt({ Name: "Test", ID: "A123456789" }, K, V);
  eq("加密結果對上綠界文件範例", enc, "o4TJSHkQBM1bogbn5BNFRofCVTfsQjoqv/TX8DKn757fe5AoYzoalYmrMsGXTiwxGpI8NsE2vu4tScAwISx8kw==");
  eq("解密還原", JSON.stringify(genpayDecrypt(enc, K, V)), JSON.stringify({ Name: "Test", ID: "A123456789" }));
}

/* ── 幕後取號的交易編號：剝不回訂單編號，付款通知就對不到單 ── */
{
  const no = "YD260903000123";
  const a = genpayMtnFor(no), b = genpayMtnFor(no, true);
  ok("首次取號是訂單編號加 B", a === `${no}B` && a.length <= 20);
  ok("重取號有時間碼且不超過 20 字", b.startsWith(`${no}B`) && b.length > a.length && b.length <= 20);
  ok("兩種都認得是幕後取號單", isGenpayMtn(a) && isGenpayMtn(b) && !isGenpayMtn(no) && !isGenpayMtn(`${no}R1X`));
  eq("剝回訂單編號", orderNoFromGenpayMtn(b), no);
  const sm = genpaySponsorMtn(57);
  ok("贊助交易編號 YO＋編號＋B，且認得", sm.startsWith("YO57B") && isGenpayMtn(sm) && sm.length <= 20);
  eq("贊助編號剝回", sponsorIdFromGenpayMtn(sm), 57);
  eq("商店單不會被當成贊助", sponsorIdFromGenpayMtn(a), 0);
}

/* ── 通知整合：節奏與深夜規則、中文變數 ── */
{
  eq("三次提醒：10 分、12 時、24 時", STEP_OFFSETS_MIN.join(","), "10,720,1440");
  eq("48 小時判失敗", FAIL_AFTER_MIN, 2880);
  const at = (h: number) => new Date(Date.UTC(2026, 8, 4, (h - 8 + 24) % 24, 30)); /* 台北 h 點半 */
  ok("白天不延後", quietUntil(at(14)) === "");
  ok("晚上 11 點延到隔天早上 8 點", quietUntil(at(23)).endsWith("T00:00:00.000Z") && quietUntil(at(23)).startsWith("2026-09-05"));
  /* at(3) 是台北 9/5 凌晨 3 點半（UTC 9/4 19:30），要延到 9/5 早上 8 點 */
  ok("凌晨 3 點延到當天早上 8 點", quietUntil(at(3)) === "2026-09-05T00:00:00.000Z");
  ok("早上 8 點整不延後", quietUntil(at(8)) === "");
  eq("中文變數代入", renderCopy("{姓名} 你好，訂單 {訂單編號}（NT${金額}）", { 姓名: "王小明", 訂單編號: "YD1", 金額: 1600 }), "王小明 你好，訂單 YD1（NT$1,600）");
  ok("找不到的變數變空字串、開頭的空白清掉", renderCopy("{姓名} 你好", {}) === "你好");
  ok("每一則通知都有預設主旨與第一段", COPY_EVENTS.every((e) => copyDefault(e.key).subject && copyDefault(e.key).p1));
}

/* ── 綠界 ATM 指定銀行：代號拼錯綠界會整筆拒收 ── */
{
  ok("ATM 銀行代號都是綠界一覽表上的大寫英文", ECPAY_ATM_BANKS.every((b) => /^[A-Z]+$/.test(b.key)));
  const f = buildCheckoutFields({ merchantTradeNo: "YD260903000001", amount: 100, method: "atm", itemName: "測試", clientBackUrl: "https://www.wensong.tw/" });
  ok("ATM 帶 PaymentInfoURL 與 ExpireDate", f.fields.PaymentInfoURL.endsWith("/api/ecpay/atm") && f.fields.ExpireDate === "2");
  ok("沒設定銀行就不帶 ChooseSubPayment", ecpayAtmBank() !== "" || !("ChooseSubPayment" in f.fields));
}

/* ── 訂單通知單一入口：管道判斷錯了，客人會收不到或站長按了以為送了 ── */
{
  const none = orderChannels({ email: "", phone: "" });
  ok("沒信箱：Email 走不通且說明是沒留信箱", !none.mail.ok && none.mail.why === "沒留信箱");
  ok("沒電話：簡訊走不通且說明是沒留電話", !none.sms.ok && none.sms.why === "沒留電話");
  ok("市話：簡訊走不通", !orderChannels({ email: "", phone: "0223456789" }).sms.ok);
  ok("沒綁定：LINE 走不通", !orderChannels({ email: "nobody@example.com", phone: "0912345678" }).line.ok);
  eq("摘要：三管道各自的結果", notifySummary({ mail: { ok: true, error: "" }, line: { ok: false, error: "沒綁 LINE" }, sms: { ok: true, error: "" } }), "Email 已寄・LINE 未推（沒綁 LINE）・簡訊 已送");
  eq("摘要：沒勾的管道不出現", notifySummary({ mail: { ok: false, error: "寄信失敗" } }), "Email 未寄（寄信失敗）");
  ok("通知種類含自訂內容", NOTIFY_KINDS.some((k) => k.key === "custom"));
}

/* ── LINE 推播：簽章驗錯會讓任何人假造綁定；訊息組錯客人看到 {name} ── */
{
  const secret = "test-secret";
  const body = JSON.stringify({ events: [{ type: "follow", source: { type: "user", userId: "U1" } }] });
  const good = createHmac("sha256", secret).update(body).digest("base64");
  ok("正確簽章通過", verifyLineSignature(body, good, secret));
  ok("錯的簽章擋下", !verifyLineSignature(body, good.slice(0, -2) + "==", secret));
  ok("改過的 body 擋下", !verifyLineSignature(body + " ", good, secret));
  ok("沒有 secret 一律擋", !verifyLineSignature(body, good, ""));
  eq("變數代入、缺的變空字串", renderLine("{name} 的訂單 {order}{nope}", { name: "王小明", order: "YD1" }), "王小明 的訂單 YD1");
  const long = composeLine("字".repeat(LINE_MAX_LEN + 50), "https://x.tw/a");
  ok("超長只截內文，網址完整在最後一行", long.endsWith("\nhttps://x.tw/a") && long.length <= LINE_MAX_LEN);
  eq("沒有網址就不加換行", composeLine("你好"), "你好");
  eq("從訊息裡撈訂單編號", orderNoFromText("我的單 yd2609030003 謝謝"), "YD2609030003");
  eq("贈品單也認", orderNoFromText("YG2609010002"), "YG2609010002");
  eq("沒有編號回空字串", orderNoFromText("哈囉"), "");
  const ck = makeBindCookie("YD2609030003", "abc", "thanks");
  eq("綁定 cookie 來回", parseBindCookie(ck)?.orderNo, "YD2609030003");
  ok("竄改的 cookie 擋下", parseBindCookie(ck.replace("YD2609030003", "YD2609030004")) === null);
  ok("空 cookie 回 null", parseBindCookie(undefined) === null);
}

/* ── 寄件紀錄與副本（2026-09-05）── */
{
  const plan: CopyPlan = { to: "me@wensong.tw", kinds: { manual: true, remind: true, routine: false, owner: false, test: false } };
  eq("手寫信副本", copyTarget(plan, "manual", "a@b.tw"), "me@wensong.tw");
  eq("提醒信副本", copyTarget(plan, "remind", "a@b.tw"), "me@wensong.tw");
  eq("例行信預設不副本", copyTarget(plan, "routine", "a@b.tw"), "");
  eq("測試信永遠不副本", copyTarget(plan, "test", "a@b.tw"), "");
  eq("收件人就是副本信箱時不副本", copyTarget(plan, "manual", "ME@wensong.tw"), "");
  eq("副本信箱留空整個不副本", copyTarget({ ...plan, to: "" }, "manual", "a@b.tw"), "");
  eq("副本信箱格式壞掉不副本", copyTarget({ ...plan, to: "not-an-email" }, "manual", "a@b.tw"), "");
  ok("每個種類都有中文標籤", MAIL_KINDS.every((k) => MAIL_KIND_LABEL[k].length > 0));
  const line = recipientsLine(["a@b.tw", "c<d>@e.tw"]);
  ok("總副本那行列出收件人並逃脫", line.includes("a@b.tw") && line.includes("c&lt;d&gt;@e.tw") && line.includes("共 2 人"));
  eq("非多地址的已付款單算未出貨", isUnshipped({ ship_method: "home", ship_list: "" }), true);
  eq("多地址名單還沒補算未出貨", isUnshipped({ ship_method: MULTI_SHIP, ship_list: "" }), true);
  eq("多地址還有人沒出算未出貨", isUnshipped({ ship_method: MULTI_SHIP, ship_list: JSON.stringify([{ shipped: 1 }, { shipped: 0 }]) }), true);
  eq("多地址全出完不算", isUnshipped({ ship_method: MULTI_SHIP, ship_list: JSON.stringify([{ shipped: 1 }, { shipped: 1 }]) }), false);
  eq("手寫信上限 60", ADMIN_MAIL_MAX, 60);
  eq("收件人去重不分大小寫", parseRecipients("A@b.tw\na@B.tw, c@d.tw"), ["A@b.tw", "c@d.tw"]);

  /* 真的寫一筆進本機資料庫再刪掉：驗 SQL 與欄位對得上。中途炸掉也要清乾淨 */
  const tag = `smoke-${Date.now()}@example.invalid`;
  try {
  const id = logMail({ kind: "manual", route: "smtp", to: tag, subject: "冒煙測試主旨", status: "failed", detail: "SMTP 失敗：測試", refNo: "YD0000000000", body: "<p>hi</p>" });
  ok("寫入寄件紀錄拿到 id", id > 0);
  const got = mailLogById(id);
  eq("讀回內容", got?.body, "<p>hi</p>");
  eq("依信箱找得到（不分大小寫）", mailLogFor({ email: tag.toUpperCase() }, 5).map((r) => r.id), [id]);
  const id2 = logMail({ kind: "manual", route: "smtp", to: "other-" + tag, subject: "同一封寄第二人", status: "sent", body: "<p>hi</p>" });
  eq("同樣內容只存一份", (db.prepare("SELECT COUNT(*) n FROM mail_body WHERE html='<p>hi</p>'").get() as { n: number }).n, 1);
  eq("第二筆也讀得到內容", mailLogById(id2)?.body, "<p>hi</p>");
  db.prepare("DELETE FROM mail_log WHERE id=?").run(id2);
  eq("依訂單編號找得到", mailLogFor({ refNo: "YD0000000000" }, 5).some((r) => r.id === id), true);
  eq("列表搜尋對得上", listSent({ q: tag }).rows.map((r) => r.key), [`m${id}`]);
  eq("列表搜主旨也對得上", listSent({ q: "冒煙測試主旨" }).rows.some((r) => r.key === `m${id}`), true);
  const testId = logMail({ kind: "test", to: tag, subject: "測試信", status: "sent" });
  eq("測試信預設藏起來", listSent({ q: tag }).rows.length, 1);
  eq("勾了才顯示", listSent({ q: tag, showTest: true }).rows.length, 2);
  } finally {
    db.prepare("DELETE FROM mail_log WHERE to_addr=?").run(tag);
    db.prepare("DELETE FROM mail_body WHERE NOT EXISTS (SELECT 1 FROM mail_log WHERE mail_log.body_hash = mail_body.hash)").run();
  }
}

/* ── LINE 打編號綁定的三道保險（2026-09-05）── */
{
  /* 台北換日：台灣時間 09/05 07:00 還算 09/05，UTC 那時是 09/04 23:00 */
  eq("台北當日起點換算成 UTC", taipeiDayStartIso(Date.UTC(2026, 8, 4, 23, 0, 0)), "2026-09-04T16:00:00.000Z");
  eq("台北隔天 00:30 換到新的一天", taipeiDayStartIso(Date.UTC(2026, 8, 5, 16, 30, 0)), "2026-09-05T16:00:00.000Z");

  eq("沒人綁過就綁", oaBindDecision(undefined, "U1"), "bind");
  eq("本人重打自己的編號是冪等", oaBindDecision({ line_user_id: "U1", status: "bound" }, "U1"), "already");
  eq("別人已經綁走就不覆蓋", oaBindDecision({ line_user_id: "U1", status: "bound" }, "U2"), "taken");
  eq("對方封鎖過的舊列不算佔用", oaBindDecision({ line_user_id: "U1", status: "blocked" }, "U2"), "bind");
  eq("自己被封鎖過可以重綁", oaBindDecision({ line_user_id: "U1", status: "blocked" }, "U1"), "bind");
  eq("每日上限是 5", LINE_OA_BIND_DAILY_CAP, 5);
  ok("兩則新回覆有預設文案", lineTemplate("bind_cap").length > 0 && lineTemplate("bind_taken").length > 0);
  ok("兩則新回覆在後台編得到", LINE_KINDS.some((k) => k.key === "bind_cap") && LINE_KINDS.some((k) => k.key === "bind_taken"));

  /* 真的寫進 line_log 再數一次：SQL 與欄位對得上才算數。中途炸掉也要清乾淨 */
  const smokeUid = `Usmoke${Date.now()}`;
  try {
    eq("還沒綁過是 0", oaBindCountToday(smokeUid), 0);
    logOaBindAttempt(smokeUid, "YD0000000001", "bound");
    logOaBindAttempt(smokeUid, "YD0000000002", "taken");
    eq("被擋下的那次也算進上限", oaBindCountToday(smokeUid), 2);
    eq("別人的次數不會算到我頭上", oaBindCountToday(smokeUid + "x"), 0);
  } finally {
    db.prepare("DELETE FROM line_log WHERE line_user_id=?").run(smokeUid);
  }
}

/* ── 限流取 IP 與備份附件編碼（2026-09-05）── */
{
  const { pickClientIp } = await import("@/lib/ratelimit");
  /* 反代把真實來源附加在 XFF 最右邊，用戶端只能污染左邊，所以只認最右的公網位址 */
  eq("只有一個位址就用它", pickClientIp("1.1.1.1"), "1.1.1.1");
  eq("取最右邊的公網位址，偽造的最左值不算", pickClientIp("9.9.9.9, 203.0.113.5"), "203.0.113.5");
  eq("最右邊是內網就往左找", pickClientIp("203.0.113.5, 10.0.0.2"), "203.0.113.5");
  eq("整條都是內網就回 local", pickClientIp("10.0.0.1, 192.168.1.1"), "local");
  eq("沒有 XFF 回 local", pickClientIp(null), "local");
  eq("CGNAT 與 loopback 也一併跳過", pickClientIp("203.0.113.5, 100.64.0.1, 127.0.0.1"), "203.0.113.5");
  eq("有指名可信 header 就用它", pickClientIp("9.9.9.9, 203.0.113.5", "198.51.100.7"), "198.51.100.7");
  eq("公網 IPv6 收得到", pickClientIp("2001:db8::1, 2606:4700::1111"), "2606:4700::1111");
  eq("fe80 連結本地要跳過", pickClientIp("2606:4700::1111, fe80::1"), "2606:4700::1111");
  eq("IPv4-mapped 收斂成 IPv4，同一人不要拿到兩個桶", pickClientIp("::ffff:203.0.113.5"), "203.0.113.5");
  eq("IPv4-mapped 的內網一樣算內網", pickClientIp("::ffff:10.0.0.1"), "local");

  /*
   * 備份附件不可以被 base64 編兩次。
   * 用 nodemailer 自己的 mail-composer 組一封信（純本機、不連網），照 backup.ts 現在的附件形狀，
   * 把附件那段解一次 base64，第一、二個位元組必須是 gzip 的 1f 8b。
   * 舊版傳 base64 字串時這裡解出來會是 "H4sIA..." 這串 ASCII 文字，測試就會紅。
   */
  const zlib = await import("zlib");
  const { createRequire } = await import("module");
  const req = createRequire(process.cwd() + "/tests/smoke.ts");
  const MailComposer = req("nodemailer/lib/mail-composer");
  const payload = zlib.gzipSync(Buffer.from("備份測試內容".repeat(20)));
  const mime: string = (
    await new MailComposer({
      from: "a@b.tw", to: "c@d.tw", subject: "備份", html: "<p>hi</p>",
      attachments: [{ filename: "wensong-db.db.gz", content: payload, contentType: "application/gzip" }],
    }).compile().build()
  ).toString("utf8");
  const at = mime.indexOf("application/gzip");
  ok("信裡真的有那個 gzip 附件", at > 0);
  const part = mime.slice(at).split(/\r?\n\r?\n/)[1] || "";
  const b64 = part.split(/\r?\n--/)[0].replace(/\s+/g, "");
  const decoded = Buffer.from(b64, "base64");
  ok("附件解一次 base64 就是 gzip（1f 8b），沒有被編兩次", decoded[0] === 0x1f && decoded[1] === 0x8b);
  ok("解出來能 gunzip 回原文", zlib.gunzipSync(decoded).toString("utf8").startsWith("備份測試內容"));
}

/* ── 後台密碼、CSP 記錄、CSV（2026-09-05 第二批 A）── */

/* 正式環境沒設 ADMIN_PASSWORD 就不能用原始碼裡的預設密碼登入 */
ok("正式環境沒設密碼＝不給登入", passwordUsable({ NODE_ENV: "production" }) === false);
/* 2026-09-05 規格改成「有設就好」：不知道站長現用密碼長度，設長度門檻會把他鎖在外面 */
ok("正式環境密碼短但有設＝照常", passwordUsable({ NODE_ENV: "production", ADMIN_PASSWORD: "1234567" }) === true);
ok("正式環境密碼夠長＝照常", passwordUsable({ NODE_ENV: "production", ADMIN_PASSWORD: "12345678" }) === true);
ok("開發環境沒設密碼仍可用後備密碼", passwordUsable({ NODE_ENV: "development" }) === true);

/* CSP 記錄不可以把訂單金鑰、付款 token 寫進 Runtime Logs */
eq("感謝頁的查詢字串整段丟掉", sanitizeCspUrl("https://www.wensong.tw/shop/thanks?no=YD2607070099&k=SECRETTOKEN"), "https://www.wensong.tw/shop/thanks");
eq("贊助感謝頁同理", sanitizeCspUrl("https://www.wensong.tw/support/thanks?sid=12&t=SECRET"), "https://www.wensong.tw/support/thanks");
eq("付款頁的 token 換成刪節號", sanitizeCspUrl("https://www.wensong.tw/pay/abc123def"), "https://www.wensong.tw/pay/…");
eq("短網址代碼也換掉", sanitizeCspUrl("https://www.wensong.tw/l/XYZ789"), "https://www.wensong.tw/l/…");
eq("井字號後面也丟掉", sanitizeCspUrl("https://www.wensong.tw/pay/abc#top"), "https://www.wensong.tw/pay/…");
eq("一般頁面原樣不動", sanitizeCspUrl("https://www.wensong.tw/articles/tofu-guide"), "https://www.wensong.tw/articles/tofu-guide");
eq("第三方的 blocked-uri 原樣不動", sanitizeCspUrl("https://xxx.a.run.app/events"), "https://xxx.a.run.app/events");
eq("非網址的值原樣不動", sanitizeCspUrl("inline"), "inline");

/* 名單匯出改用 csvCell：顧客自填的欄位不能變成 Excel 公式 */
const leadRow = ["=HYPERLINK(\"http://evil\",\"點我\")@gmail.com", "王小明, 敬上", '他說"好"'].map(csvCell).join(",");
ok("等號開頭的名單值被加上單引號中和", leadRow.startsWith("\"'=HYPERLINK"));
ok("逗號值照樣被雙引號包住", leadRow.includes('"王小明, 敬上"'));
ok("值裡的雙引號變成兩個", leadRow.endsWith('"他說""好"""'));
eq("一般值的輸出跟舊逸出完全一樣", csvCell("a@b.tw"), '"a@b.tw"');

/* ── 信件逃脫與電子報排程（2026-09-05 第二批 B）── */
import { orderResumeMailHtml } from "@/lib/mail";
import { staleClaimCutoff, CLAIM_STALE_MS } from "@/lib/newsletter";

/* 顧客自己在結帳表單打的姓名會被原樣塞進信裡：帶標籤的名字要變成字面文字，
   不然一個 <a href="https://evil"> 就能把品牌信變成釣魚信 */
{
  const hostile = "<b>x</b>";
  const r = orderResumeMailHtml({
    order_no: "YD2609050001", name: hostile, email: "c@d.tw", address: "台中市西區某路 1 號",
    items: '[{"name":"蛋捲","choice":null,"price":720,"qty":1}]',
    subtotal: 720, shipping: 0, total: 720, token: "tok123", pay_method: "信用卡",
  });
  ok("訂單提醒信：姓名裡的標籤被逃脫", r.html.includes("&lt;b&gt;x&lt;/b&gt;"));
  ok("訂單提醒信：沒有活的標籤留下來", !r.html.includes(hostile));

  const sp = sponsorResumeMailHtml({
    id: 1, mode: "monthly", amount: 300, display_name: hostile, email: "c@d.tw",
    provider: "ecpay", pay_method: "信用卡", pay_token: "tok",
    atm_bank: "", atm_vaccount: "", atm_expire: "",
  });
  ok("支持提醒信：名稱裡的標籤被逃脫", sp.html.includes("&lt;b&gt;x&lt;/b&gt;"));
  ok("支持提醒信：沒有活的標籤留下來", !sp.html.includes(hostile));
}

/* 電子報認領逾時的分界線：卡在 sending 超過 10 分鐘才放回待寄，
   正在寄的那一批（幾秒到幾十秒）不能被別輪撿走，不然同一個人會收到兩封 */
{
  const now = Date.parse("2026-09-05T12:00:00.000Z");
  eq("逾時分界線是十分鐘前", staleClaimCutoff(now), "2026-09-05T11:50:00.000Z");
  eq("十分鐘就是十分鐘", CLAIM_STALE_MS, 600000);
  const cutoff = staleClaimCutoff(now);
  ok("一分鐘前認領的還算在寄，不重撿", new Date(now - 60_000).toISOString() > cutoff);
  ok("半小時前認領的算掛了，放回待寄", new Date(now - 30 * 60_000).toISOString() < cutoff);
  ok("沒有時間戳的孤兒列也放回待寄", "" < cutoff);
}

/* ── 對帳、續扣、提醒引擎（2026-09-05 第二批 C）── */
{
  const { allSkipped, anySent, isStaleAt, FAIL_AFTER_MIN: FAIL_MIN } = await import("@/lib/remind");
  const { isSponsorAutoFailed, SPONSOR_AUTO_FAIL_MARK, SPONSOR_SUPERSEDED_MARK } = await import("@/lib/sponsor-settle");
  const { SPONSOR_STATUS } = await import("@/lib/format");

  /*
   * 全部管道都 skipped 時不能退回序號重試。
   * skipped 是結構性的（信箱被標記寄不到、沒留手機），下一輪一定還是 skipped；
   * 退回去等於每 5 分鐘替同一筆寫三列 notify_log，48 小時上千列。
   */
  const skipped = (why: string) => ({ ok: false, why, status: "skipped" as const });
  eq("信與簡訊都 skipped：算全部略過", allSkipped({ mail: skipped("信箱已標記寄不到"), sms: skipped("沒留電話") }), true);
  eq("有一個是真的寄失敗：不算全部略過，要重試", allSkipped({ mail: { ok: false, why: "寄信失敗", status: "failed" }, sms: skipped("沒留電話") }), false);
  eq("有一個寄成功：不算全部略過", allSkipped({ mail: { ok: true, why: "", status: "sent" }, sms: skipped("沒留電話") }), false);
  eq("空結果不算全部略過（沒送過就不該推進序號）", allSkipped({}), false);
  eq("排進深夜佇列算送出去了", anySent({ line: { ok: true, why: "延到早上 8 點" } }), true);
  eq("一個都沒成功", anySent({ mail: { ok: false, why: "寄信失敗" }, sms: { ok: false, why: "沒留電話" } }), false);

  /*
   * 逾期只有一個時鐘：從「這一輪的起算點」算，不是從下單那一刻。
   * 顧客第 30 小時換付款方式（resetRound 重設 round_started_at），
   * 第 48 小時時新的一輪才走 18 小時、新的 ATM 帳號還活著，不可以被取消。
   */
  const H = 3600_000;
  const now = Date.UTC(2026, 8, 5, 12, 0, 0);
  eq("同一輪滿 48 小時：逾期", isStaleAt(now - 48 * H, FAIL_MIN, now), true);
  eq("同一輪才 47 小時：還沒逾期", isStaleAt(now - 47 * H, FAIL_MIN, now), false);
  eq("第 30 小時換過方式，下單後第 48 小時不算逾期", isStaleAt(now - 18 * H, FAIL_MIN, now), false);
  eq("換方式那一輪自己滿 48 小時才逾期", isStaleAt(now - 48 * H, FAIL_MIN, now), true);
  eq("連結型訂單照保留天數（3 天）", isStaleAt(now - 60 * H, 3 * 24 * 60, now), false);

  /*
   * 系統自動判的失敗才可以被晚到的款項翻回待付款。
   * ATM 帳號效期是取號後兩天 23:59，比我們判失敗的 48 小時長，
   * 顧客隔天才去轉帳的話錢是真的收到了，不能因為狀態是 failed 就默默吃掉。
   */
  eq("48 小時自動判的失敗：可以救回", isSponsorAutoFailed(`對帳結果：綠界顯示尚未付款，48 小時內未完成（${SPONSOR_AUTO_FAIL_MARK}）`), true);
  eq("被後續成功的贊助取代：也是系統判的，可以救回", isSponsorAutoFailed(`同一位支持者後續已由 SP12 付款成功，${SPONSOR_SUPERSEDED_MARK}`), true);
  eq("金流明確回報的失敗：不是系統判的，不自動翻回", isSponsorAutoFailed("付款未完成（10100058 授權失敗）"), false);
  eq("站長手動處理的：不自動翻回", isSponsorAutoFailed("後台取消"), false);
  eq("沒有備註：不自動翻回", isSponsorAutoFailed(""), false);

  /* 連續兩期扣款失敗會被標成 paused，後台那一格不能是空白 */
  eq("後台看得到已暫停扣款", SPONSOR_STATUS.paused, "已暫停扣款");
  ok("五種贊助狀態都有中文", ["pending", "paid", "active", "failed", "cancelled", "paused"].every((k) => Boolean(SPONSOR_STATUS[k])));
}

/* ── 訂單列表與總覽（重設計第二批）── */
{
  /*
   * 相對時間：手機一行一單只有兩層，時間那格只放得下「10:12／昨天／9/3」。
   * 這裡的雷是台北 +8：資料庫存 UTC，忘了位移的話台灣時間凌晨 0 到 8 點的單
   * 會被算成昨天，站長會以為早上那筆單沒進來。
   */
  const now = new Date("2026-09-05T04:00:00.000Z"); /* 台北 2026-09-05 12:00 */
  eq("今天的單顯示時分（台北）", relTime("2026-09-05T02:12:00.000Z", now), "10:12");
  eq("台北凌晨 0:30 的單，中午看還是今天", relTime("2026-09-04T16:30:00.000Z", now), "00:30");
  eq("昨天的單寫昨天", relTime("2026-09-04T02:12:00.000Z", now), "昨天");
  eq("再往前給月/日", relTime("2026-09-03T02:12:00.000Z", now), "9/3");
  eq("跨年補年份", relTime("2025-12-31T02:12:00.000Z", now), "2025/12/31");
  eq("沒有時間就給破折號", relTime("", now), "—");
  eq("壞掉的時間不要印 Invalid Date", relTime("不是時間", now), "—");

  /* 狀態語意色：四個顏色沒有第五個，跟訂單詳情頁同一把尺 */
  eq("待付款是琥珀", statusTone("pending"), "pending");
  eq("已付款是綠", statusTone("paid"), "ok");
  eq("已出貨是綠", statusTone("shipped"), "ok");
  eq("已完成是綠", statusTone("done"), "ok");
  eq("已取消是朱紅", statusTone("cancelled"), "fail");
  eq("已退款是朱紅", statusTone("refunded"), "fail");
  eq("沒見過的狀態是灰", statusTone("whatever"), "muted");

  eq("編號取末四碼", orderLast4("YD2609050007"), "0007");
  eq("編號比四碼短就整個給", orderLast4("YG1"), "YG1");
  eq("沒有編號不要爆炸", orderLast4(""), "");
}

/* ── 設定拆六頁（重設計第三批）── */
{
  /*
   * 這一段測的是「按了商店頁的儲存，會不會順手把通知頁的設定清空」。
   *
   * 拆頁之前 saveSettings 讀全部欄位、寫全部鍵，因為表單一定帶著全部欄位所以沒事。
   * 拆成六頁之後每次只送一頁的欄位，同一支 action 如果照舊無條件寫，
   * 通知信箱、LINE 額度、條款內文會在站長什麼都沒做的情況下被寫成空字串，
   * 而且要等到客人收不到信才會發現。這種錯誤看不到，所以只能靠測試盯。
   */

  /* 設定・商店那一頁真的會送出來的欄位（照 app/admin/(panel)/settings/shop/page.tsx 逐一列出） */
  const shopForm = new FormData();
  for (const f of [
    "_back", "shop_enabled", "product_categories", "free_ship_threshold", "ship_fee", "ship_fee_cvs",
    "rate_charge_ambient_home", "rate_charge_ambient_cvs", "rate_charge_cold_home", "rate_charge_cold_cvs",
    "rate_cost_ambient_home", "rate_cost_ambient_cvs", "rate_cost_cold_home", "rate_cost_cold_cvs",
    "rate_free_ambient_home", "rate_free_ambient_cvs", "rate_free_cold_home", "rate_free_cold_cvs",
    "cold_enabled", "partner_late_days", "cvs_brand_own", "freight_mode", "notify_all_products",
    "notify_emails", "owner_notify_emails", "pm_form", "pm_shop_credit", "pm_support_credit",
    "ecpay_atm_bank", "ecpay_atm_backstage", "article_shop_cta", "article_shop_href",
    "home_who_img", "pillar_img_1", "pillar_img_2", "pillar_img_3", "pillar_img_4", "pillar_img_5",
  ]) shopForm.append(f, "1");
  const shopWrites = willWrite(shopForm.keys());

  /* 商店頁自己的鍵當然要寫得到，不然變成「安全但存不了」 */
  ok("商店頁存得到商店開關", shopWrites.includes("shop_enabled"));
  ok("商店頁存得到費率表", shopWrites.includes("rate_charge_cold_cvs"));
  ok("商店頁存得到付款方式", shopWrites.includes("pay_methods_off_shop"));
  ok("商店頁存得到首頁圖片", shopWrites.includes("pillar_img_5"));

  /* 別頁的鍵一個都不能碰。這五個各代表一頁，任何一個被寫到就是災情 */
  for (const k of [
    "notify_pause", "notify_dry_run", "mail_copy_to", "mail_copy_manual",
    "line_notify_on", "line_quota_monthly", "line_test_user_ids",
    "privacy_md", "terms_md", "returns_md", "submit_terms_md",
    "social_fb", "social_ig", "social_yt",
    "sponsor_tiers", "sponsor_lead", "addon_tiers", "support_mode", "support_enabled", "support_url",
    "shop_gateway",
  ]) ok(`商店頁的儲存不會動到 ${k}`, !shopWrites.includes(k));

  /* 通知頁反過來也要成立：不能因為在通知頁按儲存就把商店的付款方式全部關掉 */
  const notifyForm = new FormData();
  for (const f of [
    "_back", "notify_pause", "notify_dry_run", "mail_copy_to", "mail_copy_manual", "mail_copy_remind",
    "mail_copy_routine", "mail_copy_owner", "line_notify_on", "line_collect_email",
    "line_quota_monthly", "line_test_user_ids", "ncopy_order_pending_1_subject",
  ]) notifyForm.append(f, "1");
  const notifyWrites = willWrite(notifyForm.keys());
  ok("通知頁存得到暫停提醒", notifyWrites.includes("notify_pause"));
  ok("通知頁存得到通知文案", notifyWrites.includes("ncopy_order_pending_1_subject"));
  for (const k of ["pay_methods_off_shop", "pay_methods_off_support", "pay_methods_off", "notify_emails", "shop_enabled", "privacy_md"])
    ok(`通知頁的儲存不會動到 ${k}`, !notifyWrites.includes(k));

  /* 內容頁的文案信件：copy_ 前綴照欄位名一對一，沒送的那些一格都不動 */
  const contentWrites = willWrite(["_back", "social_fb", "privacy_md", "copy_hero_title"]);
  ok("內容頁存得到文案", contentWrites.includes("copy_hero_title"));
  ok("內容頁沒送的文案不動", !contentWrites.includes("copy_hero_sub"));
  ok("內容頁不會動到通知文案", !contentWrites.some((k) => k.startsWith("ncopy_")));

  /* 空表單（例如舊分頁、或被截斷的請求）什麼都不該寫 */
  eq("空表單一個鍵都不寫", willWrite([]), []);

  /*
   * 付款方式那兩排是「沒勾就不送」的 checkbox，全部關掉時送上來的東西跟
   * 「這頁沒有付款方式那一區」一模一樣。靠同區的隱藏標記 pm_form 分辨，
   * 沒有標記就一格都不動——這是拆頁之後最容易靜靜壞掉的一格。
   */
  ok("付款方式全部關掉仍存得到（有 pm_form）", willWrite(["pm_form"]).includes("pay_methods_off_shop"));
  ok("沒有 pm_form 就不動付款方式", !willWrite(["pm_shop_credit"]).includes("pay_methods_off_shop"));

  /* 舊鍵 support_enabled 跟著 support_mode 走，不能自己有一套來源 */
  ok("關閉贊助會同時寫舊鍵", willWrite(["support_mode"]).includes("support_enabled"));
  eq("support_enabled 的來源就是 support_mode", SETTING_SOURCES.support_enabled, ["support_mode"]);

  /* carriesField 是 actions.ts 每一個寫入前面問的那一句，跟 willWrite 必須同一把尺 */
  ok("carriesField 對得上 willWrite", carriesField(shopForm.keys(), "shop_enabled") && !carriesField(shopForm.keys(), "notify_pause"));
}

/* ── 贊助列表與提醒中心（重設計第四批）── */
{
  /*
   * 贊助的狀態字跟訂單不一樣：多了 active（扣款中）、paused（連兩期扣失敗被停扣），
   * 沒有 shipped。硬套訂單那把尺（order-fmt 的 statusTone）會讓「扣款中」變成灰色，
   * 站長掃過去會以為那筆訂閱停了，然後去按一顆其實不該按的取消。
   * 顏色錯了畫面不會壞，只會讓人判斷錯，所以只有這裡盯得住。
   */
  eq("贊助待付款是琥珀", sponsorTone("pending"), "pending");
  eq("贊助已付款是綠", sponsorTone("paid"), "ok");
  eq("扣款中是綠不是灰", sponsorTone("active"), "ok");
  eq("付款失敗是朱紅", sponsorTone("failed"), "fail");
  eq("已取消是朱紅", sponsorTone("cancelled"), "fail");
  /* 2026-09-06 規格改：已暫停扣款是要聯絡的人，算待處理 */
  eq("已暫停扣款是待處理（琥珀）", sponsorTone("paused"), "pending");
  eq("沒見過的贊助狀態是灰", sponsorTone("whatever"), "muted");

  /* 一行一筆的姓名後面那個小字，只有兩種 */
  eq("monthly 顯示每月定額", sponsorModeLabel("monthly"), "每月定額");
  eq("其餘一律單筆", sponsorModeLabel("once"), "單筆");
  eq("空字串也當單筆，不要留白", sponsorModeLabel(""), "單筆");

  /* 提醒中心一列的顏色：停掉的優先，因為系統已經不會再動它，不該再用琥珀喊人 */
  eq("待催是琥珀", remindTone({ failed: false, stopped: false }), "pending");
  eq("已失敗是朱紅", remindTone({ failed: true, stopped: false }), "fail");
  eq("停掉的就算失敗也是灰", remindTone({ failed: true, stopped: true }), "muted");
  eq("停掉的待催也是灰", remindTone({ failed: false, stopped: true }), "muted");
}


/* ── 發送與名單頁（重設計第五批）── */
{
  /*
   * 發送頁一進來停在哪一個分頁。
   *
   * 這裡最怕的不是分頁挑錯，是深層連結靜靜失效：訂單詳情、待聯絡、還有這頁自己的
   * 「再看 100 筆」都連到 /admin/mail?...#log。改版之前紀錄是頁面最下面的一段，
   * 錨點自己會捲到；改版之後它躲在分頁裡，判斷寫錯的話那幾條連結會全部把人丟到
   * 手寫信表單前面，而且畫面完全正常，沒有任何地方會報錯。
   */
  eq("沒有任何參數就停在信", mailTabFromParams({}), "mail");
  eq("網址明講 tab=sms 就聽它的", mailTabFromParams({ tab: "sms" }), "sms");
  eq("tab=line 也認得", mailTabFromParams({ tab: "line" }), "line");
  eq("看不懂的 tab 退回信，不要留白畫面", mailTabFromParams({ tab: "nonsense" }), "mail");
  eq("錨點 #log 要停在紀錄", mailTabFromParams({}, "#log"), "log");
  eq("錨點沒有井字號也算", mailTabFromParams({}, "log"), "log");
  eq("帶著搜尋字進來的要的是紀錄", mailTabFromParams({ q: "someone@gmail.com" }), "log");
  eq("帶著筆數 n 進來的也是紀錄", mailTabFromParams({ n: "150" }), "log");
  eq("顯示營運通知的開關也是紀錄", mailTabFromParams({ owner: "1" }), "log");
  eq("Check 送上來的陣列一樣認得", mailTabFromParams({ test: ["0", "1"] }), "log");
  /* 空字串不算「帶著參數」：清空搜尋框送出時 q 是空的，那時候人還在紀錄，靠 tab 帶 */
  eq("空的 q 不算條件", mailTabFromParams({ q: "" }), "mail");
  eq("tab 比錨點強：站長自己切過分頁就聽他的", mailTabFromParams({ tab: "mail" }, "#log"), "mail");

  /*
   * 待聯絡的語意色。靛藍已經從後台拿掉（admin-ui-spec 第二節），
   * pending_long 原本就是靛藍那一格，改版時最容易被漏掉。
   * 顏色錯了畫面不會壞，只會讓站長把該打電話的那一筆看成沒事的。
   */
  eq("退信是朱紅", contactTone("bad_email"), "fail");
  eq("刷卡失敗是朱紅", contactTone("card_failed"), "fail");
  eq("ATM 快到期是琥珀", contactTone("atm_due"), "pending");
  eq("拖太久是琥珀，不是靛藍", contactTone("pending_long"), "pending");

}

/* ── 內容與銷售頁（重設計第六批）── */
{
  /*
   * 付款連結與電子報的狀態色。
   *
   * 這兩個對照表挑錯了畫面完全正常，只有人會判斷錯，所以只有測試盯得住。
   * 最貴的一格是付款連結的「可用」：那條連結是「已經配好、對方還沒付錢」，
   * 屬於待處理的琥珀。挑成綠的話站長掃過一整頁會以為那幾條都收到錢了，
   * 於是不再追對方付款，貨也就一直不會出。
   */
  eq("付款連結可用是琥珀，不是綠", payLinkStatus("open")[1], "pending");
  eq("可用的字是可用", payLinkStatus("open")[0], "可用");
  eq("已成立訂單是綠", payLinkStatus("used")[1], "ok");
  eq("已作廢是灰", payLinkStatus("released")[1], "muted");
  eq("沒見過的付款連結狀態退成灰，不要留白", payLinkStatus("")[1], "muted");
  eq("沒見過的付款連結狀態顯示破折號", payLinkStatus("weird")[0], "—");

  /* 電子報：草稿與寄送中都還沒完成，一律琥珀；只有寄完才是綠 */
  eq("草稿是琥珀", newsletterStatus("draft")[1], "pending");
  eq("寄送中是琥珀，不是綠", newsletterStatus("sending")[1], "pending");
  eq("已寄完是綠", newsletterStatus("sent")[1], "ok");
  eq("草稿顯示草稿", newsletterStatus("draft")[0], "草稿");
  eq("已寄完顯示已寄完", newsletterStatus("sent")[0], "已寄完");
  /* 看不懂的狀態原字照印：編一個好看的字出來只會讓人以為系統知道發生什麼事 */
  eq("沒見過的電子報狀態原字照印", newsletterStatus("queued")[0], "queued");
  eq("沒見過的電子報狀態是灰", newsletterStatus("queued")[1], "muted");
}

/* ── 資安低風險批（2026-09-06）── */
{
  /*
   * 權杖的定時比較。
   *
   * 這幾條測的不是「快不快」，而是「該相等的相等、該不等的不等」：
   * safeEqual 為了不丟例外，長度不同會提早回 false，寫錯很容易變成
   * 「只要長度一樣就通過」或「空的對上空的就通過」，那兩種都是直接開門。
   */
  ok("一樣的權杖相等", safeEqual("a1b2c3", "a1b2c3"));
  ok("差一個字元就不等", !safeEqual("a1b2c3", "a1b2c4"));
  ok("長度不同不等（不能丟例外）", !safeEqual("a1b2c3", "a1b2c3d"));
  /* 資料庫沒發過權杖的舊資料那一欄是空的，網址不帶權杖時也是空的，
     這兩個空字串不可以剛好對上而放行 */
  ok("空對空不算相等", !safeEqual("", ""));
  ok("undefined 不算相等", !safeEqual(undefined, "abc"));
  ok("null 不算相等", !safeEqual("abc", null));
  ok("中文也不會誤判（比的是位元組）", safeEqual("權杖", "權杖"));

  /*
   * 折扣碼過期要用台北的日曆判斷。
   *
   * 站長在後台填的 2026-09-05 意思是「9 月 5 日那天還能用」。
   * 原本拿 UTC 的今天去比，台灣凌晨 0 到 8 點 UTC 還停在昨天，
   * 於是檔期結束後的那八小時（正好是搶購最兇的時候）折扣照樣生效，錢是實打實少收的。
   */
  const t0900 = Date.parse("2026-09-06T01:00:00Z"); /* 台北 2026-09-06 09:00 */
  eq("台北時間換算正確（早上九點）", taipeiYMDAt(t0900).iso, "2026-09-06");
  ok("9/5 到期的碼在 9/6 早上已失效", taipeiDateExpired("2026-09-05", t0900));
  ok("9/6 到期的碼在 9/6 早上還能用", !taipeiDateExpired("2026-09-06", t0900));

  /* 真正會出事的那一刻：台北 9/6 凌晨一點，UTC 還是 9/5。舊寫法在這裡會放行 */
  const t0100 = Date.parse("2026-09-05T17:00:00Z"); /* 台北 2026-09-06 01:00 */
  eq("台北時間換算正確（凌晨一點）", taipeiYMDAt(t0100).iso, "2026-09-06");
  ok("9/5 到期的碼在台北 9/6 凌晨就失效", taipeiDateExpired("2026-09-05", t0100));

  /* 檔期最後一天的深夜還在期限內，不可以提早關掉 */
  const t2300 = Date.parse("2026-09-05T15:00:00Z"); /* 台北 2026-09-05 23:00 */
  ok("9/5 到期的碼在 9/5 深夜仍有效", !taipeiDateExpired("2026-09-05", t2300));
  ok("沒填到期日就是不過期", !taipeiDateExpired("", t0900));
  ok("null 到期日也是不過期", !taipeiDateExpired(null, t0900));

  /*
   * 後台 session 的世代（epoch）。
   *
   * 原本 cookie 是「到期時間.簽章」，裡面沒有任何識別碼，
   * 等於簽出去就收不回來：按了登出只是刪掉自己瀏覽器裡那張，
   * 被側錄走的那張照樣進得了後台，而且要等七天才過期。
   * 加一段 epoch 之後，登出把資料庫裡的數字加一，全部作廢。
   */
  const sign = (p: string) => createHmac("sha256", "測試用金鑰").update(p).digest("hex");
  const now = Date.parse("2026-09-06T01:00:00Z");
  const exp = now + 60_000;
  const cookie = packSession(exp, 3, sign, { id: 2, name: "阿明" });
  eq("cookie 是四段：到期時間.epoch.使用者.簽章", cookie.split(".").length, 4);
  ok("同一代的 cookie 驗得過", verifySession(cookie, sign, 3, now));
  eq("解得回登入者的 id 與名字", sessionUser(cookie, sign, 3, now), { id: 2, name: "阿明" });
  ok("登出後 epoch 加一，舊 cookie 立刻失效", !verifySession(cookie, sign, 4, now));
  eq("失效的 cookie 解不出登入者", sessionUser(cookie, sign, 4, now), null);
  ok("過期的 cookie 不算數", !verifySession(cookie, sign, 3, exp + 1));
  ok("簽章被改過就不算數", !verifySession(cookie.slice(0, -1) + "0", sign, 3, now));
  ok("換一把金鑰簽的不算數", !verifySession(cookie, (p) => createHmac("sha256", "別把金鑰").update(p).digest("hex"), 3, now));
  /* 舊格式（兩段或三段）自然驗不過，站長重登一次就好，不必寫相容分支 */
  ok("舊格式 cookie 一律驗不過", !verifySession(`${exp}.${sign(String(exp))}`, sign, 3, now));
  ok("沒有 cookie 不算登入", !verifySession(undefined, sign, 3, now));
  ok("亂填的 cookie 不算登入", !verifySession("隨便打的東西", sign, 3, now));
  /* 沒帶登入者（舊的單一密碼制）：預設記成「站長」 */
  const defaultCookie = packSession(exp, 3, sign);
  eq("沒帶使用者時預設記成「站長」", sessionUser(defaultCookie, sign, 3, now), { id: 0, name: "站長" });
  /* epoch 讀壞了寧可退回第一代，也不能變成 NaN 讓站長自己都登不進去 */
  eq("epoch 讀不到退回 1", parseEpoch(""), DEFAULT_EPOCH);
  eq("epoch 是亂碼退回 1", parseEpoch("abc"), 1);
  eq("epoch 是 0 退回 1", parseEpoch("0"), 1);
  eq("正常的 epoch 照讀", parseEpoch("7"), 7);
}

/* ── 後台帳號制（第 2 段，2026-09-14）：密碼雜湊與帳號制判斷 ── */
{
  const h = hashPassword("correct horse battery staple");
  ok("雜湊格式是 scrypt$salt$hash（十六進位）", /^scrypt\$[0-9a-f]+\$[0-9a-f]+$/.test(h));
  ok("正確密碼驗得過", verifyPassword("correct horse battery staple", h));
  ok("錯誤密碼被擋下", !verifyPassword("wrong password", h));
  ok("同一組密碼每次雜湊出不同的 salt", hashPassword("same") !== hashPassword("same"));
  ok("壞格式的雜湊值一律當驗證失敗，不丟例外", !verifyPassword("x", "not-a-real-hash"));
  ok("空字串雜湊值不丟例外", !verifyPassword("x", ""));

  ok("三個 ADMIN_USER_N 都沒設＝單一密碼制", !accountModeEnabled({}));
  ok("設了任何一個就算帳號制", accountModeEnabled({ ADMIN_USER_2: "a|b|c" }));
  ok("帳號制時只看 ADMIN_USER_1 有沒有設", passwordUsable({ ADMIN_USER_1: "a|b|c" }));
  ok("帳號制但 ADMIN_USER_1 沒設＝不給登入", !passwordUsable({ ADMIN_USER_2: "a|b|c" }));
}

/* ── 站內短網址（2026-09-07）── */
{
  /*
   * 為什麼這一段值得測：短網址是一條「客人手機裡的公開入口」。
   * 產碼有偏差、擋不住站外網址、或是同一個人每次收到不同的碼，
   * 三件事在畫面上都看不出來，只有在事後看數字或收到詐騙投訴時才會發現。
   */

  /* 一、字母表與碼 */
  eq("字母表 56 個字元", SHORT_ALPHABET.length, 56);
  ok("看起來像的六個字都不在裡面（0 O o 1 l I）", !/[0Oo1lI]/.test(SHORT_ALPHABET));
  ok("字母表沒有重複字元", new Set(SHORT_ALPHABET).size === SHORT_ALPHABET.length);
  ok("字母表只有英數", /^[0-9a-zA-Z]+$/.test(SHORT_ALPHABET));
  eq("碼長 8", SHORT_CODE_LEN, 8);
  eq("產出來的碼就是 8 碼", newShortCode().length, 8);
  ok("產出來的每個字元都在字母表裡", [...newShortCode(200)].every((c) => SHORT_ALPHABET.includes(c)));

  /*
   * 分佈。用 % 56 直接取模的話，字母表前 32 個字元會比後 24 個多出 25% 的機率，
   * 8 碼的猜中難度就不是 56^8 了。拒絕取樣要讓每一格差不多平。
   * 五十萬個字元，每格期望 8929，抽樣誤差三個標準差約 ±280；
   * 有模除偏差的話最小／最大會掉到 0.8，所以 0.9 這條線兩邊都分得開。
   */
  {
    const sample = newShortCode(500_000);
    const count = new Map<string, number>();
    for (const c of SHORT_ALPHABET) count.set(c, 0);
    for (const c of sample) count.set(c, (count.get(c) || 0) + 1);
    const ns = [...count.values()];
    ok("拒絕取樣：分佈平均，沒有模除偏差", Math.min(...ns) / Math.max(...ns) > 0.9);
  }

  /* 二、只縮站內網址 */
  eq("路徑照收", internalPath("/api/orders/pay?no=YD1&t=abc"), "/api/orders/pay?no=YD1&t=abc");
  eq("本站絕對網址只留路徑", internalPath("https://www.wensong.tw/shop/thanks?no=YD1"), "/shop/thanks?no=YD1");
  eq("apex 也算本站", internalPath("https://wensong.tw/shop"), "/shop");
  eq("站外網址拒絕", internalPath("https://evil.example/phish"), "");
  eq("像本站的騙人網域也拒絕", internalPath("https://wensong.tw.evil.example/x"), "");
  eq("協定相對網址拒絕（看起來像路徑，其實是別的網域）", internalPath("//evil.example/x"), "");
  eq("javascript: 拒絕", internalPath("javascript:alert(1)"), "");
  eq("夾換行拒絕", internalPath("/shop\nLocation: https://evil.example"), "");
  eq("短網址不能指向短網址", internalPath("/l/abcdefgh"), "");
  eq("空字串拒絕", internalPath(""), "");
  ok("短網址網域跟全站一致，帶 www，不多一次轉址", shortSiteUrl() === "https://www.wensong.tw");

  /* 三、同目標同管道回同一組碼；換管道就換一組。真的寫進本機資料庫再刪掉 */
  const stamp = Date.now();
  const smokeTarget = `/api/orders/pay?no=YDSMOKE${stamp}&t=smoketoken`;
  try {
    const a = ensureShortLink(smokeTarget, "sms");
    const b = ensureShortLink(smokeTarget, "sms");
    eq("同一個目標＋同一個管道回同一組碼（催三次要是同一條連結）", a, b);
    eq("回的碼是 8 碼", a.length, 8);
    const line = ensureShortLink(smokeTarget, "line");
    ok("換一個管道就是另一組碼（點擊數才歸得了管道）", line !== a);
    eq("短網址長成這樣", shortUrl(smokeTarget, "sms"), `${shortSiteUrl()}/l/${a}`);
    eq("整條短網址 33 個字元", shortUrl(smokeTarget, "sms").length, 33);

    /* 站外網址不會讓寄信失敗：縮不成就原封不動退回長網址 */
    eq("縮不了就退回原網址，不丟例外", shortUrl("https://evil.example/x", "sms"), "https://evil.example/x");

    eq("8 碼解析得到目的地", resolveShortPath(a).path, smokeTarget);
    eq("8 碼解析的種類", resolveShortPath(a).kind, "short");
    ok("亂猜的碼查不到", shortLinkByCode("aaaaaaaa") === undefined);
    eq("查無此碼送去訂單查詢頁", resolveShortPath("zzzzzzzz").path, "/orders");
    eq("還沒被點過就這樣講，不寫 0 次", shortClickSummary("催款連結", smokeTarget), "催款連結還沒被點過");
  } finally {
    db.prepare("DELETE FROM short_links WHERE target=?").run(smokeTarget);
  }

  /*
   * 四、舊連結不能斷。
   * 客人手機裡的簡訊還躺著 /l/<24 碼訂單權杖>，而且沒有有效期。
   * 新表查不到時要照舊轉到 /line/bind，行為與 2026-09-07 之前一模一樣。
   */
  const legacyToken = "0123456789abcdef01234567";  /* randomBytes(12).toString("hex") 就是 24 碼 */
  const legacyNo = `YDSMOKE${stamp}`;
  try {
    db.prepare(
      `INSERT INTO orders (order_no,name,phone,email,address,pay_method,invoice_type,items,subtotal,shipping,total,status,created_at,token)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run(legacyNo, "冒煙測試", "0912345678", "smoke@example.invalid", "測試", "credit", "cloud", "[]", 0, 0, 0, "pending", new Date().toISOString(), legacyToken);
    const r = resolveShortPath(legacyToken);
    eq("舊的 24 碼權杖還是走綁定入口", r.kind, "legacy");
    eq("舊連結轉到的地方一字沒變", r.path, `/line/bind?no=${legacyNo}&t=${legacyToken}&src=sms`);
    eq("權杖差一個字就不放行", resolveShortPath(legacyToken.slice(0, 23) + "8").kind, "miss");
  } finally {
    db.prepare("DELETE FROM orders WHERE order_no=?").run(legacyNo);
  }

  /*
   * 五、催款簡訊真的塞得下了。
   *
   * 這一則帶兩條連結：接續付款、用 LINE 收通知。
   * 上限 268 字元，網址與署名都算，超過就截內文——
   * 「還沒完成付」這種半句話寄出去，客人只會覺得這家公司怪怪的。
   *
   * 模板與署名用寫死的預設值，不讀後台設定：這條測試要驗的是網址省了多少，
   * 不是站長今天把文案改成幾個字。
   */
  {
    const no = "YD2609070001";
    const token = "0123456789abcdef01234567";
    const t = {
      kind: "order", id: 0, no, name: "王小明", email: "", phone: "0912345678", total: 1600,
      created_at: "", round_started_at: "", remind_seq: 0, remind_round: 0, remind_stop: 0,
      pay_method: "信用卡", pay_note: "", token, status: "pending", items: "[]", address: "",
    } as Target;

    const contLong = linksFor(t).cont;
    const bindLong = shortBindUrl(token);              /* 舊制：/l/<24 碼權杖> */
    let contShort = "", bindShort = "";
    try {
      contShort = linksFor(t, "sms").cont;
      bindShort = shortBindUrl(token, no);
      eq("接續付款：長網址 80 字元", contLong.length, 80);
      eq("綁 LINE：舊短網址 49 字元", bindLong.length, 49);
      eq("兩條長網址合計 129 字元", contLong.length + bindLong.length, 129);
      eq("接續付款：新短網址 33 字元", contShort.length, 33);
      eq("綁 LINE：新短網址 33 字元", bindShort.length, 33);
      eq("兩條新短網址合計 66 字元", contShort.length + bindShort.length, 66);

      /* 整則。內文用預設模板，署名用預設值 */
      const body = renderSms(smsTemplateDefault("pending"), { name: "王小明", order: no, total: "1600" });
      const whole = (cont: string, bind: string) => `${body}\n用LINE收通知 ${bind}\n${cont}\n問爽的 WenSong`.length;
      const before = whole(contLong, bindLong);
      const after = whole(contShort, bindShort);
      eq("催款簡訊：換短網址前 212 字元", before, 212);
      eq("催款簡訊：換短網址後 149 字元", after, 149);
      ok("換短網址前就已經吃掉七成以上的額度", before / SMS_LIMIT > 0.7);
      ok("換完之後兩條連結都完整塞得下，不必截內文", after <= SMS_LIMIT);
    } finally {
      /* linksFor 一次會生兩條（接續付款、重選付款方式），加上綁定那條，全部照訂單編號清掉 */
      db.prepare("DELETE FROM short_links WHERE target LIKE ?").run(`%${no}%`);
    }
  }
}

/* ── 三輪催款簡訊文案（2026-09-07）── */
{
  /*
   * 為什麼要測：語氣分輪是站長要的，但真正會出事的是長度。
   * 最後一次的文案最長，如果它加上兩條連結與署名超過 268 字，
   * composeSms 會把內文截掉，客人收到的就是半句話，而且照樣扣錢。
   */
  eq("第一次用第一輪文案", pendingTplKey(0), "pending");
  eq("提醒過一次用第二輪", pendingTplKey(1), "pending2");
  eq("提醒過兩次用最後一次", pendingTplKey(2), "pending3");
  eq("提醒過五次還是用最後一次的語氣", pendingTplKey(5), "pending3");

  ok("第二輪會說再提醒一次", smsTemplateDefault("pending2").includes("再提醒一次"));
  ok("最後一次講明會自動取消", smsTemplateDefault("pending3").includes("自動取消"));
  ok("最後一次講明不會有費用", smsTemplateDefault("pending3").includes("不會有任何費用"));
  ok("付款失敗要講沒有扣款", smsTemplateDefault("failed").includes("沒有扣款"));

  const vars = { name: "王小明", order: "YD2609070001", total: "1600" };
  for (const k of ["pending", "pending2", "pending3", "failed"] as const) {
    const body = renderSms(smsTemplateDefault(k), vars) + "\n用LINE收通知 https://www.wensong.tw/l/Ab3xK9mQ";
    const whole = composeSms(body, "https://www.wensong.tw/l/Zq7WnR2t");
    ok(`${k} 整則塞得下（${whole.length} 字）`, whole.length <= SMS_LIMIT);
    ok(`${k} 沒有被截掉`, !whole.includes("…"));
  }
}

/* ── 提醒中心的簡訊文案：訂單與贊助（2026-09-07）── */
{
  /*
   * 為什麼這一段跟上面那段不一樣：真正在跑的催款簡訊走 notify-copy，
   * 不是 lib/sms.ts 的模板（那組只有訂單頁手動勾簡訊時會用到）。
   * 只測上面那組會得到一個「文案改好了」的假象。
   */
  const v: Record<string, string> = { 姓名: "王小明", 訂單編號: "YD2609070001", 金額: "1600" };
  const LINE_INVITE = "\n用LINE收通知 https://www.wensong.tw/l/Ab3xK9mQ";
  const URL = "https://www.wensong.tw/l/Zq7WnR2t";

  for (const side of ["order", "sp"] as const) {
    const g = (n: string) => copyDefault(`${side}_${n}` as never).sms;
    ok(`${side} 第二次會說再提醒一次`, g("remind2").includes("再提醒一次"));
    ok(`${side} 最後一次講明會自動取消`, g("remind3").includes("自動取消"));
    ok(`${side} 最後一次講明不會有費用`, g("remind3").includes("不會有任何費用"));
    ok(`${side} 付款失敗要講沒有扣款`, g("failed").includes("沒有扣款"));
    ok(`${side} 每一則都講資料不用重填`, ["remind1", "remind2", "remind3", "failed"].every((n) => g(n).includes("不用重填")));

    for (const n of ["remind1", "remind2", "remind3", "failed"]) {
      /* 訂單那邊還會多黏一行邀請綁 LINE，長度要一起算 */
      const body = renderCopy(g(n), v) + (side === "order" ? LINE_INVITE : "");
      const whole = composeSms(body, URL);
      ok(`${side}_${n} 整則塞得下（${whole.length} 字）`, whole.length <= SMS_LIMIT);
      ok(`${side}_${n} 沒有被截掉`, !whole.includes("…"));
      ok(`${side}_${n} 變數都代進去了`, !/[{}]/.test(whole));
    }
  }
}

/* ── 每一封未完成付款的信都要能改付款方式（2026-09-07）── */
{
  /*
   * 站長 2026-09-07 指示。以前收到 ATM 帳號之後想改刷卡的人，在信裡完全找不到路。
   *
   * 這裡也守一條紅線：不可以在信裡寫「舊帳號會自動失效」。換方式並不會讓
   * 綠界那組虛擬帳號停用，而贊助是拿 trade_no 直接比對、換方式時會被覆寫，
   * 舊帳號的入帳會對不到任何一筆。措辭錯了就是收了錢卻查無此單。
   */
  const oUrl = orderChooseUrl("YD2609070001", "abc123def456");
  ok("訂單換方式連到感謝頁的重選狀態", oUrl.includes("/shop/thanks?") && oUrl.includes("pay=choose"));
  ok("訂單換方式帶得了單號與權杖", oUrl.includes("no=YD2609070001") && oUrl.includes("k=abc123def456"));
  const sUrl = sponsorChooseUrl(12, "tok123", "monthly");
  ok("贊助換方式連到支持感謝頁的重選狀態", sUrl.includes("/support/thanks?") && sUrl.includes("pay=choose"));
  ok("贊助換方式帶得了編號、權杖與模式", sUrl.includes("sid=12") && sUrl.includes("t=tok123") && sUrl.includes("mode=monthly"));
  eq("贊助沒給模式時當單筆", sponsorChooseUrl(12, "tok123").includes("mode=once"), true);

  /* 已取號的提醒信：要有換方式的按鈕，而且不可以說舊帳號會失效 */
  const atmMail = orderResumeMailHtml({
    order_no: "YD2609070002", name: "王小明", email: "a@b.c", address: "台北市", items: "[]",
    subtotal: 1600, shipping: 0, total: 1600, token: "tok9876543210", pay_method: "ATM 轉帳",
    atmInfo: "ATM 轉帳：822 1234567890123（2026/09/10 前完成）",
  });
  ok("已取號的提醒信有換付款方式的按鈕", atmMail.html.includes("改用其他付款方式"));
  ok("已取號的提醒信按鈕連得到重選頁", atmMail.html.includes("pay=choose"));
  ok("不可以說舊帳號會自動失效", !atmMail.html.includes("自動失效"));
  ok("要提醒換完別再轉舊帳號", atmMail.html.includes("不要再轉到這組帳號"));

  const spAtm = sponsorResumeMailHtml({
    id: 12, mode: "once", amount: 500, display_name: "王小明", email: "a@b.c",
    provider: "ecpay", pay_method: "ATM 轉帳", pay_token: "tok123",
    atm_bank: "822", atm_vaccount: "1234567890123", atm_expire: "2026/09/10",
  });
  ok("贊助已取號的提醒信有換付款方式的按鈕", spAtm.html.includes("改用其他付款方式"));
  ok("贊助那封也不可以說會自動失效", !spAtm.html.includes("自動失效"));

  /* 提醒中心的兩則取號通知也要有第二顆按鈕 */
  eq("訂單取號通知有換方式按鈕", copyDefault("order_atm").btn2, "改用其他付款方式");
  eq("贊助取號通知有換方式按鈕", copyDefault("sp_atm").btn2, "改用其他付款方式");
  for (const k of ["order_atm", "sp_atm"] as const) {
    ok(`${k} 的說明不可以說會自動失效`, !copyDefault(k).p1.includes("自動失效"));
  }
}

/* ── 站長通知與名單匯入（2026-09-07）── */
{
  /*
   * 三件事：訂單通知的收件人是兩格聯集、沒人可寄要留痕、每日同步的判斷。
   * 前兩件是站長真的漏掉一張單才發現的，後一件是新的排程，都值得有測試盯著。
   */

  /* 一、收件人聯集，不分大小寫去重 */
  eq("兩格都有就兩個都收", orderNotifyRecipients("shop@x.com", "owner@x.com"), ["shop@x.com", "owner@x.com"]);
  eq("只填站長那格也收得到訂單通知", orderNotifyRecipients("", "owner@x.com"), ["owner@x.com"]);
  eq("只填商品那格照舊", orderNotifyRecipients("shop@x.com", ""), ["shop@x.com"]);
  eq("同一個信箱填兩格只寄一封", orderNotifyRecipients("Hi@Wensong.tw", "hi@wensong.tw"), ["Hi@Wensong.tw"]);
  eq("同一格內重複也只留一個", orderNotifyRecipients("a@x.com, A@X.com", ""), ["a@x.com"]);
  eq("不是信箱的字丟掉", orderNotifyRecipients("我的信箱, a@x.com", "，"), ["a@x.com"]);
  eq("兩格都空就沒有收件人", orderNotifyRecipients("", ""), []);

  /* 二、沒有人可寄的時候要留一筆「沒寄」，不是安靜地什麼都不做 */
  const refNo = "SMOKE-NOTIFY-0001";
  const logId = logOrderNotifySkip(refNo, "有人訂購 NT.1,600｜測試");
  ok("沒人可寄時有寫進寄件紀錄", logId > 0);
  const skipRow = mailLogById(logId);
  eq("那一筆是「沒寄」", skipRow?.status, "skipped");
  eq("歸類在營運通知", skipRow?.kind, "owner");
  ok("原因寫的是沒設定通知信箱", (skipRow?.detail || "").includes("沒有設定任何通知信箱"));
  eq("查得到是哪一張單", skipRow?.ref_no, refNo);
  ok("用訂單編號找得到它", mailLogFor({ refNo }).some((m) => m.id === logId));
  db.prepare("DELETE FROM mail_log WHERE id=?").run(logId);
  eq("測試資料清乾淨", db.prepare("SELECT COUNT(*) c FROM mail_log WHERE ref_no=?").get(refNo), { c: 0 });

  /* 三、每日自動同步的判斷（純函式，不用等時間） */
  const base = { hour: SYNC_HOUR, today: "2026-09-07", lastDay: "2026-09-06", hasUrl: true };
  ok("時間到、今天還沒成功過就跑", shouldSyncNow(base));
  ok("沒設試算表網址就什麼都不做", !shouldSyncNow({ ...base, hasUrl: false }));
  ok("今天已經成功過就不再跑", !shouldSyncNow({ ...base, lastDay: "2026-09-07" }));
  ok("不在時間窗內不跑", !shouldSyncNow({ ...base, hour: 2 }) && !shouldSyncNow({ ...base, hour: 4 }));
  ok("時間窗避開凌晨 4 到 6 點的備份", SYNC_HOUR < 4 || SYNC_HOUR > 6);
  /* 失敗不寫 lastDay，所以下一個 tick 條件不變、還會再試一次 */
  ok("失敗之後同一天還會再試", shouldSyncNow({ ...base, lastDay: "2026-09-06" }));

  /* 四、上次同步那一行：站長要一眼看到「誰跑的、進了幾筆、或錯在哪」 */
  const okState: SyncState = {
    at: "2026-09-07T19:05:00.000Z", mode: "auto",
    result: { added: 3, existed: 12, skippedUnsub: 1, invalid: ["typo@gamil.com"] }, error: "",
  };
  const line = syncSummary(okState, fmtDateTimeDash);
  ok("寫得出台北時間", line.includes("2026-09-08 03:05"));
  ok("說得出是自動跑的", line.includes("（自動）"));
  ok("三個數字都在", line.includes("新增 3") && line.includes("已存在 12") && line.includes("退訂過所以跳過 1"));
  ok("格式有問題的也算給他看", line.includes("格式有問題 1"));
  const manual = syncSummary({ ...okState, mode: "manual" }, fmtDateTimeDash);
  ok("手動按的要標手動", manual.includes("（手動）"));
  const failLine = syncSummary({ at: okState.at, mode: "auto", result: null, error: "抓到的是網頁不是 CSV" }, fmtDateTimeDash);
  ok("失敗要把原因原封不動印出來", failLine.includes("失敗：抓到的是網頁不是 CSV"));
  ok("沒跑過也要有一句話", syncSummary({ at: "", mode: "manual", result: null, error: "" }, fmtDateTimeDash).length > 0);
}

/* ── 贊助的舊繳費帳號（2026-09-07）── */
{
  /*
   * 這一段盯的是「錢收了卻對不到任何一筆贊助」。
   * trade_no 只有一欄，換付款方式或重試就被覆寫，但綠界的虛擬帳號不會跟著失效，
   * 所以舊帳號晚幾天入帳是真的會發生。要用真的資料庫，因為壞掉的地方就在 SQL 比對。
   */
  const ins = db.prepare(
    `INSERT INTO sponsorships (mode,amount,display_name,message,email,pay_method,invoice_type,invoice_data,status,created_at,trade_no,provider)
     VALUES ('once',500,'冒煙測試','','smoke-trade@example.com','ATM 轉帳','donate','{}','pending',?,?,'ecpay')`
  );
  const oldNo = "SMOKE-YO-OLD-0001";
  const newNo = "SMOKE-YO-NEW-0001";
  const spId = Number(ins.run(new Date().toISOString(), newNo).lastInsertRowid);

  /* 一、每一次寫 trade_no 都要留下歷史（舊的那組先取號、新的那組是改方式之後重生的） */
  rememberSponsorTradeNo(spId, oldNo);
  rememberSponsorTradeNo(spId, newNo);
  eq("用過的單號都記下來了", sponsorTradeNoHistory(spId), [newNo, oldNo]);
  rememberSponsorTradeNo(spId, newNo);
  eq("同一組寫兩次不會多一列", sponsorTradeNoHistory(spId).length, 2);

  /* 二、現行單號照舊精準比對，而且要贏過歷史（不能被判成舊帳號入帳） */
  eq("現行單號比對得到，且不算舊帳號", sponsorByTradeNo(newNo), { id: spId, stale: false });

  /* 三、被換掉的舊單號也要找得回這筆贊助，並標成 stale */
  eq("舊繳費帳號的入帳對得回贊助", sponsorByTradeNo(oldNo), { id: spId, stale: true });

  /* 四、不認得的單號還是什麼都不給（不可以亂認人，那會把錢記到別人頭上） */
  eq("沒見過的單號比對不到", sponsorByTradeNo("SMOKE-YO-UNKNOWN-9999"), undefined);
  /* 單筆贊助的單號不該被定期定額的回呼撿走 */
  eq("定期定額的回呼撿不到單筆贊助", sponsorByTradeNo(oldNo, { monthly: true }), undefined);

  /* 五、已經付過款的那一筆：舊帳號又進一筆＝重複付款，狀態一個字都不能改 */
  eq("待付款＝晚到的轉帳，照常入帳", staleSponsorPaymentAction("pending"), "settle");
  eq("已付款＝重複付款", staleSponsorPaymentAction("paid"), "duplicate");
  eq("扣款中＝重複付款", staleSponsorPaymentAction("active"), "duplicate");
  db.prepare("UPDATE sponsorships SET status='paid' WHERE id=?").run(spId);
  /* 入帳的守門條件本來就寫在 SQL 的 WHERE，這裡驗它真的擋得住第二次 */
  const second = db
    .prepare("UPDATE sponsorships SET status='paid', last_charge_note='不該被寫進去' WHERE id=? AND status='pending'")
    .run(spId);
  eq("已付款的不會被再入帳一次", second.changes, 0);
  eq(
    "重複付款沒有動到那筆贊助",
    db.prepare("SELECT status,COALESCE(last_charge_note,'') note FROM sponsorships WHERE id=?").get(spId),
    { status: "paid", note: "" }
  );

  /* 測試資料清乾淨 */
  db.prepare("DELETE FROM sponsor_trade_nos WHERE sponsorship_id=?").run(spId);
  db.prepare("DELETE FROM sponsorships WHERE id=?").run(spId);
  eq("單號歷史清乾淨", db.prepare("SELECT COUNT(*) c FROM sponsor_trade_nos WHERE sponsorship_id=?").get(spId), { c: 0 });
  eq("贊助測試資料清乾淨", db.prepare("SELECT COUNT(*) c FROM sponsorships WHERE id=?").get(spId), { c: 0 });
}


/* ── 文章 UTM 短碼 /s/（2026-09-13）── */
{
  eq("八個管道", Object.keys(UTM_CHANNELS).length, 8);
  eq("slug 有連字號也拆得對", JSON.stringify(parseUtmCode("mingjian-incinerator-igs")), JSON.stringify({ slug: "mingjian-incinerator", channel: "igs" }));
  eq("大小寫不分", parseUtmCode("Box-Turtle-FB")?.channel, "fb");
  eq("不認識的管道不收", parseUtmCode("box-turtle-xx"), null);
  eq("沒有管道不收", parseUtmCode("box-turtle"), null);
  eq("亂七八糟的不收", parseUtmCode("../etc-fb"), null);
  eq("參數順序固定 source、medium、campaign", utmQuery("box-turtle", "igs"), "utm_source=instagram&utm_medium=story&utm_campaign=box-turtle");
  eq("原本帶的參數接在 UTM 後面", utmQuery("box-turtle", "fb", new URLSearchParams("ref=abc")), "utm_source=facebook&utm_medium=organic&utm_campaign=box-turtle&ref=abc");
  eq("原本帶的 UTM 不能蓋掉規則", utmQuery("box-turtle", "fb", new URLSearchParams("utm_source=evil")), "utm_source=facebook&utm_medium=organic&utm_campaign=box-turtle");
  const list = utmLinksFor("https://www.wensong.tw", "wensong.tw", "box-turtle");
  eq("清單八行", list.length, 8);
  eq("短版格式", list[0].short, "wensong.tw/s/box-turtle-fb");
  eq("長版格式", list[0].long, "https://www.wensong.tw/articles/box-turtle?utm_source=facebook&utm_medium=organic&utm_campaign=box-turtle");
}



/* ── 集數解析（問爽的 2026-09-14）：RSS 標題與簡介的拆法，拆錯整站的網址與來賓都會錯 ── */
{
  const { parseTitle, parseDuration, cleanDescription, guestNamesFromTitle, summaryFrom, parseRss, epLabel } = await import("@/lib/episodes");
  eq("正篇：系列、集數、key", (({ series, epNo, key }) => ({ series, epNo, key }))(parseTitle("問爽的23 - 坪林女王的餐桌美學 feat.坪感覺 嫻嫻《問爽的 WenSong》", "g1")), { series: "main", epNo: "23", key: "23" });
  eq("正篇：精簡標題剝掉 feat. 與後綴", parseTitle("問爽的23 - 坪林女王的餐桌美學 feat.坪感覺 嫻嫻《問爽的 WenSong》", "g1").shortTitle, "坪林女王的餐桌美學");
  eq("正篇：01 的 key 是 1 不是 01", parseTitle("問爽的01 - 主持問爽的 ft. 禾豐田食 安妮《問爽的 WenSong》", "g2").key, "1");
  eq("投稿：key 補零", parseTitle("投稿03 - 餐廳裡面無法忍受的行為 《問爽的 WenSong》 ", "g3"), { series: "submit", epNo: "03", key: "submit-03", shortTitle: "餐廳裡面無法忍受的行為" });
  eq("試播集", parseTitle("EP0｜問爽的 試播集", "g4"), { series: "pilot", epNo: "0", key: "0", shortTitle: "試播集" });
  eq("認不得的標題：key 用 guid 雜湊，不會是空的", parseTitle("特別企劃：年終回顧", "abc-123").key.startsWith("x-"), true);
  eq("來賓：feat.", guestNamesFromTitle("問爽的21 - 野菜 feat.三玉號 立蘇 《問爽的 WenSong》"), ["三玉號 立蘇"]);
  eq("來賓：ft. 與冒號整串當一位", guestNamesFromTitle("問爽的18 - 米其林 ft. 好嶼：Ian、MIki《問爽的 WenSong》"), ["好嶼：Ian、MIki"]);
  eq("來賓：沒有就空陣列", guestNamesFromTitle("問爽的19 - 生活中的小廢物《問爽的 WenSong》"), []);
  eq("時長：純秒數", parseDuration("2708"), 2708);
  eq("時長：時分秒", parseDuration("1:02:03"), 3723);
  eq("時長：分秒", parseDuration("45:10"), 2710);
  eq("時長：亂碼是 0", parseDuration("abc"), 0);
  const desc = "・坪林女王的生活 <br>・花藝分享 <br> <br>還有更多有趣的內容等著你們來聽哦～ <br>🎧 現在就來聽聽吧 <br>🔴馬上收聽 ➟ <a href=\"https://solink.soundon.fm/wensong\">x</a><br>--<br>Hosting provided by SoundOn";
  eq("簡介：尾巴整段剝掉、項目符號改清單", cleanDescription(desc), "- 坪林女王的生活\n- 花藝分享");
  eq("簡介：摘要去掉清單符號", summaryFrom(cleanDescription(desc)), "坪林女王的生活 花藝分享");
  const xml = `<rss><channel><title>問爽的 WenSong</title><itunes:image href="https://files.soundon.fm/c.jpeg"/><item><title><![CDATA[問爽的23 - 甲 feat.乙《問爽的 WenSong》]]></title><guid isPermaLink="false">id-1</guid><pubDate>Sun, 28 Jul 2024 04:00:00 GMT</pubDate><itunes:duration>2708</itunes:duration><enclosure url="https://rss.soundon.fm/a.mp3" length="123" type="audio/mpeg"/><description><![CDATA[<p>hi &amp; bye</p>]]></description></item><item><title>投稿01 - 丙</title><guid>id-2</guid><enclosure url="https://rss.soundon.fm/b.mp3" type="audio/mpeg"/></item></channel></rss>`;
  const feed = parseRss(xml);
  eq("RSS：頻道封面", feed.channel.image, "https://files.soundon.fm/c.jpeg");
  eq("RSS：兩集", feed.items.length, 2);
  eq("RSS：CDATA 標題原樣", feed.items[0].title, "問爽的23 - 甲 feat.乙《問爽的 WenSong》");
  eq("RSS：guid、音檔、大小、時長", [feed.items[0].guid, feed.items[0].audioUrl, feed.items[0].audioBytes, feed.items[0].duration], ["id-1", "https://rss.soundon.fm/a.mp3", 123, 2708]);
  eq("RSS：日期轉 ISO", feed.items[0].pubDate, "2024-07-28T04:00:00.000Z");
  eq("RSS：沒有日期是空字串，不是 Invalid Date", feed.items[1].pubDate, "");
  eq("集數標籤", [epLabel("main", "07"), epLabel("submit", "03"), epLabel("pilot", "0"), epLabel("other", "")], ["第 7 集", "投稿 03", "試播集", "特別篇"]);
}

/* ── 藍新金流 NewebPay（問爽的第 3 段）：加密／簽章／編號的來回測試 ──
   沒有真的測試金鑰，這裡自己造一組合法長度（32／16 碼）的假金鑰做來回測試，
   驗證的是「我們自己的加解密邏輯自洽」，不是對上藍新真實環境（那要等站長拿到金鑰後手動測）。 */
{
  const {
    encryptTradeInfo, decryptTradeInfo, tradeSha, verifyTradeSha, parseNotify,
    newebpayOrderMtn, orderNoFromNewebpayMtn, isNewebpayOrderMtn,
    newebpaySponsorMtn, sponsorIdFromNewebpayMtn, isNewebpaySponsorMtn,
  } = await import("@/lib/newebpay");

  const K = "01234567890123456789012345678901"; // 32 碼
  const V = "0123456789012345"; // 16 碼

  /* 加密解密來回一致：TradeInfo 是「參數組成 query string 後加密」，解密要能還原同一份 query string */
  const params = { MerchantID: "TEST001", Amt: 100, MerchantOrderNo: "WOYD260914000700", ItemDesc: "測試商品 A#B" };
  const enc = encryptTradeInfo(params, K, V);
  ok("TradeInfo 是小寫 hex", /^[0-9a-f]+$/.test(enc));
  const dec = decryptTradeInfo(enc, K, V);
  const qsExpected = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) qsExpected.set(k, String(v));
  eq("解密還原成同一份 query string", dec, qsExpected.toString());

  /* TradeSha 大寫、驗簽通過；改一個字元就要被拒絕 */
  const sha = tradeSha(enc, K, V);
  ok("TradeSha 是大寫 hex（64 碼）", /^[0-9A-F]{64}$/.test(sha));
  ok("驗簽通過", verifyTradeSha(enc, sha, K, V));
  ok("改過的簽章擋下", !verifyTradeSha(enc, sha.slice(0, -1) + (sha.endsWith("A") ? "B" : "A"), K, V));
  ok("換一把假的 HashKey 也擋下", !verifyTradeSha(enc, sha, K.slice(0, -1) + "9", V));

  /* MerchantOrderNo：訂單編號的產生與還原（WO 前綴＋重試加碼） */
  const orderNo = "YD2609140007";
  const mtn1 = newebpayOrderMtn(orderNo);
  eq("首次取號沒有 R 尾碼", mtn1, `WO${orderNo}`);
  ok("30 碼以內", mtn1.length <= 30);
  ok("認得是訂單編號", isNewebpayOrderMtn(mtn1));
  eq("還原回原始訂單編號", orderNoFromNewebpayMtn(mtn1), orderNo);
  const mtn2 = newebpayOrderMtn(orderNo, true);
  ok("重試會加上 R 與時間碼，跟首次不同", mtn2 !== mtn1 && mtn2.startsWith(`WO${orderNo}R`));
  ok("重試編號一樣 30 碼以內", mtn2.length <= 30);
  eq("重試編號也能還原回同一個訂單編號", orderNoFromNewebpayMtn(mtn2), orderNo);

  /* MerchantOrderNo：贊助 id 的產生與還原（WS 前綴＋時間戳尾 6 碼），不需要查資料庫就能剝回身分 */
  const spMtn = newebpaySponsorMtn(57);
  ok("贊助編號 WS 開頭帶 id", spMtn.startsWith("WS57"));
  ok("贊助編號 30 碼以內", spMtn.length <= 30);
  ok("認得是贊助編號", isNewebpaySponsorMtn(spMtn));
  eq("還原回贊助 id", sponsorIdFromNewebpayMtn(spMtn), 57);
  eq("訂單編號不會被誤判成贊助 id", sponsorIdFromNewebpayMtn(mtn1), 0);
  ok("訂單編號不會被誤判成贊助編號", !isNewebpaySponsorMtn(mtn1));
  ok("贊助編號不會被誤判成訂單編號", !isNewebpayOrderMtn(spMtn));

  /* parseNotify：沒設金鑰時 newebpayEnabled() 是 false，一律回 null，安靜不動 */
  const bodyGood = { Status: "SUCCESS", MerchantID: "TEST001", TradeInfo: enc, TradeSha: sha, Version: "2.0" };
  eq("環境變數空著時 parseNotify 一律回 null（newebpayEnabled 為 false）", parseNotify(bodyGood), null);

  /* 設好假金鑰之後，錯的簽章要被拒絕；沒有 TradeSha／TradeInfo 也要被拒絕 */
  process.env.NEWEBPAY_MERCHANT_ID = "TEST001";
  process.env.NEWEBPAY_HASH_KEY = K;
  process.env.NEWEBPAY_HASH_IV = V;
  try {
    /* parseNotify 解的是「JSON 字串」而不是 query string，這裡自己組一份藍新格式的回應內容 */
    const notifyRaw = JSON.stringify({
      Status: "SUCCESS", Message: "授權成功",
      Result: { MerchantID: "TEST001", Amt: 720, TradeNo: "24091400000001", MerchantOrderNo: mtn1, PaymentType: "CREDIT", PayTime: "2026-09-14 12:00:00" },
    });
    const notifyCipher = createCipheriv("aes-256-cbc", Buffer.from(K, "utf8"), Buffer.from(V, "utf8"));
    const notifyJsonHex = Buffer.concat([notifyCipher.update(notifyRaw, "utf8"), notifyCipher.final()]).toString("hex");
    const okSha = tradeSha(notifyJsonHex, K, V);
    const parsed = parseNotify({ Status: "SUCCESS", MerchantID: "TEST001", TradeInfo: notifyJsonHex, TradeSha: okSha, Version: "2.0" });
    ok("正確簽章解得出結果", parsed !== null && parsed.ok && parsed.merchantOrderNo === mtn1 && parsed.paymentType === "CREDIT" && parsed.payTime !== "");
    const badParsed = parseNotify({ Status: "SUCCESS", MerchantID: "TEST001", TradeInfo: notifyJsonHex, TradeSha: okSha.slice(0, -1) + (okSha.endsWith("A") ? "B" : "A"), Version: "2.0" });
    eq("錯簽章一律拒絕（回 null）", badParsed, null);
    eq("缺 TradeSha 也拒絕", parseNotify({ Status: "SUCCESS", MerchantID: "TEST001", TradeInfo: notifyJsonHex, TradeSha: "", Version: "2.0" }), null);
  } finally {
    delete process.env.NEWEBPAY_MERCHANT_ID;
    delete process.env.NEWEBPAY_HASH_KEY;
    delete process.env.NEWEBPAY_HASH_IV;
  }
}

console.log(`\n${fail === 0 ? "✓" : "✗"} 冒煙測試：${pass} 過 ${fail} 敗`);
process.exit(fail === 0 ? 0 : 1);
