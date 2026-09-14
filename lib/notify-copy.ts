/*
 * 通知文案（docs/notify-spec.md 第七章）。每一則通知＝主旨、第一段、按鈕文字、LINE、簡訊五格，
 * 全部後台可改（設定鍵 ncopy_<事件>_<格>），留空用預設。變數用中文大括號，不出現英文代碼。
 */
import { getSetting } from "./db";

export type CopyEvent =
  | "order_atm" | "order_remind1" | "order_remind2" | "order_remind3" | "order_failed"
  | "sp_atm" | "sp_remind1" | "sp_remind2" | "sp_remind3" | "sp_failed" | "sp_charge_fail" | "sp_charge_pause";
export type CopyField = "subject" | "p1" | "btn" | "btn2" | "line" | "sms";
export type Copy = Record<CopyField, string>;

export const COPY_VARS = ["{姓名}", "{訂單編號}", "{金額}", "{期限}", "{付款方式}", "{帳號}", "{銀行代碼}"] as const;

export const COPY_EVENTS: { key: CopyEvent; label: string; group: "商品訂單" | "贊助"; hasSms: boolean }[] = [
  { key: "order_atm", label: "取號（轉帳帳號）", group: "商品訂單", hasSms: false },
  { key: "order_remind1", label: "提醒第 1 次（下單後 10 分鐘）", group: "商品訂單", hasSms: true },
  { key: "order_remind2", label: "提醒第 2 次（下單後 12 小時）", group: "商品訂單", hasSms: true },
  { key: "order_remind3", label: "提醒第 3 次（下單後 24 小時，最後一次）", group: "商品訂單", hasSms: true },
  { key: "order_failed", label: "付款失敗（下單後 48 小時，或金流回報失敗）", group: "商品訂單", hasSms: true },
  { key: "sp_atm", label: "取號（轉帳帳號）", group: "贊助", hasSms: false },
  { key: "sp_remind1", label: "提醒第 1 次（10 分鐘）", group: "贊助", hasSms: true },
  { key: "sp_remind2", label: "提醒第 2 次（12 小時）", group: "贊助", hasSms: true },
  { key: "sp_remind3", label: "提醒第 3 次（24 小時，最後一次）", group: "贊助", hasSms: true },
  { key: "sp_failed", label: "付款失敗（48 小時，或金流回報失敗）", group: "贊助", hasSms: true },
  { key: "sp_charge_fail", label: "定期定額扣款失敗", group: "贊助", hasSms: false },
  { key: "sp_charge_pause", label: "定期定額連續兩期失敗，已暫停", group: "贊助", hasSms: false },
];

/*
 * 簡訊文案 2026-09-07 全面加長。
 *
 * 以前寫「點連結接續或換方式」是被 268 字上限逼出來的：兩條長網址就吃掉
 * 一半額度。站內短網址上線之後省下七十幾個字，該講的話終於塞得下：
 * 第二次講明是再提醒、最後一次講明會自動取消而且不會扣到錢、失敗那則
 * 講明沒有扣款。這三句都是客人真正在意的事，講清楚比省字重要。
 * 商品訂單與贊助兩邊同一套語氣，只有主詞不同。
 */
const R1 = "{姓名} 你好，你的訂單還沒完成付款，商品先幫你留著。按「繼續付款」接續，或「重選付款方式」換一種。";
const S1 = "{姓名} 你好，你的支持 NT${金額} 還沒完成付款。按「繼續付款」接續，或「重選付款方式」換一種。";
const DEFAULTS: Record<CopyEvent, Copy> = {
  order_atm: { subject: "你的轉帳帳號 {訂單編號}｜問爽的 WenSong", p1: "{姓名} 你好，這是你的轉帳帳號，期限前完成就好。已經轉帳的話就不用理會下面的按鈕。想改成刷卡或 LINE Pay 的話按「改用其他付款方式」，換完之後就不要再轉到這組帳號了。", btn: "查看訂單", btn2: "改用其他付款方式",
    line: "{姓名} 你好，訂單 {訂單編號} 的轉帳帳號：\n銀行代碼 {銀行代碼}　帳號 {帳號}\n應付 NT${金額}，請於 {期限} 前完成。完成轉帳後訂單會自動變成已付款。", sms: "" },
  order_remind1: { subject: "還差一步：訂單 {訂單編號} 還沒完成付款｜問爽的 WenSong", p1: R1, btn: "繼續付款", btn2: "重選付款方式",
    line: "{姓名} 你好，訂單 {訂單編號}（NT${金額}）還沒完成付款。", sms: "{姓名} 你好，你的訂單還差一步，{訂單編號}（NT${金額}）還沒完成付款，商品先幫你留著。點下面的連結可以直接接續處理，資料不用重填。" },
  order_remind2: { subject: "再提醒一次：訂單 {訂單編號} 還沒完成付款｜問爽的 WenSong", p1: R1, btn: "繼續付款", btn2: "重選付款方式",
    line: "{姓名} 你好，再提醒一次，訂單 {訂單編號}（NT${金額}）還沒完成付款。", sms: "{姓名} 你好，再提醒一次，你的訂單 {訂單編號}（NT${金額}）還沒完成付款。點下面的連結可以接續，或是換一種付款方式，資料都不用重填。" },
  order_remind3: { subject: "最後一次提醒：訂單 {訂單編號} 還沒完成付款｜問爽的 WenSong", p1: R1 + "\n這是最後一次提醒，之後這筆訂單會自動取消，不會有任何費用。", btn: "繼續付款", btn2: "重選付款方式",
    line: "最後一次提醒。{姓名} 你好，訂單 {訂單編號}（NT${金額}）還沒完成付款，之後會自動取消，不會有任何費用。", sms: "最後一次提醒：{姓名} 你好，訂單 {訂單編號}（NT${金額}）還沒完成付款，再過一陣子會自動取消，不會有任何費用。想完成的話點下面的連結，資料不用重填。" },
  order_failed: { subject: "付款沒有完成（沒有扣款）{訂單編號}｜問爽的 WenSong", p1: "{姓名} 你好，這筆訂單的付款沒有完成，也沒有扣款。想再試的話，按下面任一種方式，資料不用重填。", btn: "繼續付款", btn2: "重選付款方式",
    line: "{姓名} 你好，訂單 {訂單編號} 的付款沒有完成，沒有扣款。想再試按這裡，資料不用重填。", sms: "{姓名} 你好，訂單 {訂單編號} 的付款沒有完成，這筆沒有扣款。點下面的連結可以換一種方式再試一次，資料不用重填。" },
  sp_atm: { subject: "轉帳帳號：{帳號}｜問爽的 WenSong", p1: "{姓名} 你好，這是你的轉帳帳號，期限前完成就好。已經轉帳的話就不用理會下面的按鈕。想改成刷卡或 LINE Pay 的話按下面那顆，換完之後就不要再轉到這組帳號了。", btn: "", btn2: "改用其他付款方式",
    line: "{姓名} 你好，你的支持 NT${金額} 的轉帳帳號：\n銀行代碼 {銀行代碼}　帳號 {帳號}\n請於 {期限} 前完成。入帳後會在這裡通知你。", sms: "" },
  sp_remind1: { subject: "還差一步：你的支持還沒完成付款｜問爽的 WenSong", p1: S1, btn: "繼續付款", btn2: "重選付款方式",
    line: "{姓名} 你好，你的支持 NT${金額} 還沒完成付款。", sms: "{姓名} 你好，你的支持還差一步，NT${金額} 還沒完成付款。點下面的連結可以直接接續處理，資料不用重填。" },
  sp_remind2: { subject: "再提醒一次：你的支持還沒完成付款｜問爽的 WenSong", p1: S1, btn: "繼續付款", btn2: "重選付款方式",
    line: "{姓名} 你好，再提醒一次，你的支持 NT${金額} 還沒完成付款。", sms: "{姓名} 你好，再提醒一次，你的支持 NT${金額} 還沒完成付款。點下面的連結可以接續，或是換一種付款方式，資料都不用重填。" },
  sp_remind3: { subject: "最後一次提醒：你的支持還沒完成付款｜問爽的 WenSong", p1: S1 + "\n這是最後一次提醒，之後這筆支持會自動取消，不會有任何費用。", btn: "繼續付款", btn2: "重選付款方式",
    line: "最後一次提醒。{姓名} 你好，你的支持 NT${金額} 還沒完成付款，之後會自動取消，不會有任何費用。", sms: "最後一次提醒：{姓名} 你好，你的支持 NT${金額} 還沒完成付款，再過一陣子會自動取消，不會有任何費用。想完成的話點下面的連結，資料不用重填。" },
  sp_failed: { subject: "付款沒有完成（沒有扣款）｜問爽的 WenSong", p1: "{姓名} 你好，這筆支持的付款沒有完成，也沒有扣款。想再試的話，按下面任一種方式，資料不用重填。", btn: "繼續付款", btn2: "重選付款方式",
    line: "{姓名} 你好，你的支持 NT${金額} 付款沒有完成，沒有扣款。想再試按這裡，資料不用重填。", sms: "{姓名} 你好，你的支持 NT${金額} 付款沒有完成，這筆沒有扣款。點下面的連結可以換一種方式再試一次，資料不用重填。" },
  sp_charge_fail: { subject: "這一期沒有扣款成功｜問爽的 WenSong", p1: "{姓名} 你好，這個月的支持沒有扣到，綠界接下來幾天會再試。如果卡片換了，按這裡重新設定，舊的會自動停掉。", btn: "重新設定每月支持", btn2: "",
    line: "{姓名} 你好，這個月的支持沒有扣到，綠界接下來幾天會再試。卡片換了就按下面的連結重新設定，舊的會自動停掉。", sms: "" },
  sp_charge_pause: { subject: "每月支持已暫停｜問爽的 WenSong", p1: "{姓名} 你好，連續兩期都沒扣到，我先把它停下來，不會再嘗試。想繼續的話按這裡重新設定一次。謝謝你一路的支持。", btn: "重新設定每月支持", btn2: "",
    line: "{姓名} 你好，連續兩期都沒扣到，每月支持先停下來了，不會再嘗試。想繼續就按下面的連結重新設定一次。謝謝你一路的支持。", sms: "" },
};

export function copyDefault(ev: CopyEvent): Copy { return DEFAULTS[ev]; }
export function copyOf(ev: CopyEvent): Copy {
  const d = DEFAULTS[ev];
  const g = (f: CopyField) => getSetting(`ncopy_${ev}_${f}`, "").trim() || d[f];
  return { subject: g("subject"), p1: g("p1"), btn: g("btn"), btn2: g("btn2"), line: g("line"), sms: g("sms") };
}
export function copyIsCustom(ev: CopyEvent, f: CopyField): boolean { return Boolean(getSetting(`ncopy_${ev}_${f}`, "").trim()); }

export type CopyVars = { 姓名?: string; 訂單編號?: string; 金額?: string | number; 期限?: string; 付款方式?: string; 帳號?: string; 銀行代碼?: string };
/* 代入中文變數；找不到的換成空字串，別把 {姓名} 寄出去 */
export function renderCopy(text: string, v: CopyVars): string {
  const m: Record<string, string> = {
    "姓名": (v.姓名 || "").trim(), "訂單編號": v.訂單編號 || "", "金額": v.金額 === undefined ? "" : Number(v.金額).toLocaleString(),
    "期限": v.期限 || "", "付款方式": v.付款方式 || "", "帳號": v.帳號 || "", "銀行代碼": v.銀行代碼 || "",
  };
  return text.replace(/\{(姓名|訂單編號|金額|期限|付款方式|帳號|銀行代碼)\}/g, (_, k) => m[k] ?? "").replace(/^\s*你好/, "你好");
}
