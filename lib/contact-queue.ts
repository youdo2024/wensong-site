import db, { json } from "./db";
import { orderSupersededBy, SUPERSEDED_MARK } from "./order-superseded";
import { emailTypoSuggestion } from "./email-typo";
import { money } from "./format";

/*
 * 待聯絡清單：把「系統已經盡力但沒成功」的訂單整理成一份可以直接用手機傳出去的簡訊。
 *
 * 為什麼不自動發簡訊：三竹要先登記固定 IP、要申請網域才能在簡訊裡放連結、
 * 還要處理發送規範。而站長自己的手機傳出去是對方認得的號碼，回覆率更高，
 * 成本是零，今天就能用。等到量大到手動撐不住，這份清單的判斷邏輯
 * 正好就是自動化要用的那一套，不會白做。
 *
 * 商店訂單一定有電話（結帳必填），贊助則要滿 2,000 元才問，
 * 舊的贊助紀錄一律沒有。沒有電話的照樣列出來，只是傳不了簡訊：
 * 那種只能從後台寄一封手寫信。看得到才處理得到，
 * 原本把沒電話的濾掉，等於贊助那一半永遠是空的。
 */

export type ContactReason = "atm_due" | "card_failed" | "bad_email" | "pending_long";

/*
 * 每一則的結尾。系統的提醒信照樣會寄，所以對方會同時收到信與簡訊，
 * 不講清楚的話有人會以為是兩筆、或是擔心付兩次。
 */
const BOTH = "\n（提醒信也會寄到你的 Email，兩邊擇一處理就可以，不會重複計算。）";

export type ContactItem = {
  kind: "order" | "sponsor";
  id: number;
  orderNo: string;
  name: string;
  phone: string;
  email: string;
  total: number;
  reason: ContactReason;
  /* 排序用：數字越小越急 */
  rank: number;
  headline: string;   // 後台顯示的一句話
  detail: string;     // 補充說明
  sms: string;        // 可以直接傳出去的簡訊內容
  related: RelatedRow[];   // 這個人的其他紀錄
  /* 沒有電話的傳不了簡訊，畫面要改成「從後台寄信」那條路 */
  canSms: boolean;
};

/* 同一個人的其他訂單／贊助。傳簡訊之前先看這個，免得催到已經付過錢的人 */
export type RelatedRow = {
  orderNo: string;
  status: string;
  total: number;
  /* 是靠哪個欄位認出來的：姓名、電話、信箱，可能同時成立 */
  matchedBy: string;
  createdAt: string;
  paid: boolean;
};

const LABEL: Record<ContactReason, string> = {
  atm_due: "ATM 快到期還沒入帳",
  card_failed: "刷卡失敗，沒有再回來",
  bad_email: "信箱寄不到",
  pending_long: "待付款很久，提醒信寄過了",
};

export function reasonLabel(r: ContactReason): string {
  return LABEL[r];
}

type Row = {
  id: number; order_no: string; name: string; phone: string; email: string;
  total: number; status: string; pay_method: string; pay_note: string; token: string;
  created_at: string; remind_count: number; contacted_at: string;
};

function site(): string {
  return (process.env.SITE_URL || "https://www.wensong.tw").replace(/\/$/, "");
}

/* 繳費資訊裡的帳號與期限，簡訊要原樣附上，對方最需要的就是這一段 */
function atmInfo(payNote: string): { text: string; due: string } {
  const text = /(?:ATM 轉帳：|繳費帳號)[^。]*/.exec(payNote || "")?.[0] || "";
  const due = /(\d{4}\/\d{2}\/\d{2})/.exec(text)?.[1] || "";
  return { text: text.replace(/^ATM 轉帳：/, "").trim(), due };
}

function daysUntil(ymd: string): number {
  if (!ymd) return 99;
  const t = new Date(`${ymd.replace(/\//g, "-")}T23:59:59+08:00`).getTime();
  if (!Number.isFinite(t)) return 99;
  return (t - Date.now()) / 86400000;
}

function hoursSince(iso: string): number {
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? (Date.now() - t) / 3600000 : 0;
}

/* 不到一天就講小時。「待付款 0 天」讀起來像壞掉了 */
function waited(hours: number): string {
  return hours < 24 ? `已過 ${Math.max(1, Math.round(hours))} 小時` : `已過 ${Math.floor(hours / 24)} 天`;
}

function itemsText(itemsJson: string): string {
  const items = json<{ name: string; choice: string | null; qty: number }[]>(itemsJson, []);
  return items.map((i) => `${i.name}${i.choice ? `（${i.choice}）` : ""} × ${i.qty}`).join("、");
}

const ORDER_STATUS_ZH: Record<string, string> = {
  pending: "待付款", paid: "已付款", shipped: "已出貨", done: "已完成", cancelled: "已取消",
};
const SPONSOR_STATUS_ZH: Record<string, string> = {
  pending: "待付款", paid: "已付款", active: "扣款中", failed: "付款失敗", cancelled: "已取消",
};

const norm = (s: string) => String(s || "").replace(/\s+/g, "");
const normPhone = (s: string) => String(s || "").replace(/[\s-]/g, "");

/*
 * 這個人的其他紀錄：姓名、電話、信箱只要有一項對得上就列出來。
 *
 * 為什麼要三個條件都收：判斷「是不是同一個人」時我們要嚴格（三選一還要加上
 * 姓名相符才算重複，否則會誤取消別人的訂單），但**給人看**的時候要寬鬆。
 * 戴與見那次就是兩個信箱、同名同電話，系統認不出來，而站長只要看到
 * 「這個人另外有一筆已付款」就不會傳那則催款簡訊了。
 * 寬鬆的代價只是多看一行，嚴格的代價是催到已經付過錢的人。
 *
 * 同時標出是靠哪個欄位對上的。三項全中幾乎確定是同一個人，
 * 只有信箱相同就要小心，可能是一個人幫兩個人各訂一份。
 */
type PoolRow = { order_no: string; status: string; total: number; name: string; phone: string; email: string; created_at: string };

/*
 * 比對用的資料池。整份撈一次，不要每個人各查一次資料庫：
 * 清單上有幾十個人，每人一次 500 列的查詢就是幾萬列的重複讀取。
 */
function loadPool(kind: "order" | "sponsor"): PoolRow[] {
  return kind === "order"
    ? (db
        .prepare(
          `SELECT order_no,status,total,name,COALESCE(phone,'') phone,email,created_at
           FROM orders WHERE COALESCE(gift,0)=0 ORDER BY id DESC LIMIT 800`
        )
        .all() as PoolRow[])
    : (db
        .prepare(
          `SELECT ('支持 #' || id) order_no,status,amount total,COALESCE(display_name,'') name,
                  COALESCE(phone,'') phone,email,created_at
           FROM sponsorships ORDER BY id DESC LIMIT 800`
        )
        .all() as PoolRow[]);
}

function relatedOf(
  pool: PoolRow[],
  kind: "order" | "sponsor",
  selfNo: string,
  name: string,
  phone: string,
  email: string
): RelatedRow[] {
  const nm = norm(name), ph = normPhone(phone), em = String(email || "").trim().toLowerCase();
  if (!nm && !ph && !em) return [];

  const out: RelatedRow[] = [];
  for (const r of pool) {
    if (r.order_no === selfNo) continue;
    const hits: string[] = [];
    if (nm && norm(r.name) === nm) hits.push("姓名");
    if (ph && normPhone(r.phone) === ph) hits.push("電話");
    if (em && String(r.email || "").trim().toLowerCase() === em) hits.push("信箱");
    if (hits.length === 0) continue;
    out.push({
      orderNo: r.order_no,
      status: (kind === "order" ? ORDER_STATUS_ZH : SPONSOR_STATUS_ZH)[r.status] || r.status,
      total: r.total,
      matchedBy: hits.join("＋"),
      createdAt: r.created_at,
      paid: ["paid", "shipped", "done", "active"].includes(r.status),
    });
    if (out.length >= 8) break;
  }
  /* 已付款的排前面。那是站長最需要先看到的一行 */
  return out.sort((a, b) => Number(b.paid) - Number(a.paid));
}

export function contactQueue(): ContactItem[] {
  const rows = db
    .prepare(
      `SELECT id,order_no,name,phone,email,total,status,pay_method,pay_note,token,items,created_at,
              remind_count,COALESCE(contacted_at,'') contacted_at
       FROM orders
       WHERE status IN ('pending','cancelled') AND COALESCE(phone,'')<>''
         AND COALESCE(gift,0)=0
       ORDER BY id DESC LIMIT 300`
    )
    .all() as (Row & { items: string })[];

  const pool = loadPool("order");
  const out: ContactItem[] = [];
  for (const o of rows) {
    /* 已經聯絡過就不再出現，否則這份清單會越積越長而失去意義 */
    if (o.contacted_at) continue;

    const base = {
      kind: "order" as const, id: o.id, orderNo: o.order_no, name: o.name,
      phone: o.phone, email: o.email, total: o.total,
      canSms: Boolean(o.phone),
      related: relatedOf(pool, "order", o.order_no, o.name, o.phone, o.email),
    };
    const link = `${site()}/api/orders/pay?no=${encodeURIComponent(o.order_no)}&t=${encodeURIComponent(o.token)}`;
    const typo = emailTypoSuggestion(o.email);
    const atm = atmInfo(o.pay_note);
    const age = hoursSince(o.created_at);

    /* 一、信箱寄不到。這個最優先，因為她連確認信與發票都收不到，
       而且不解決的話後面每一封信都是白寄。 */
    if (typo) {
      out.push({
        ...base,
        reason: "bad_email",
        rank: 0,
        headline: `信箱寄不到：${o.email}`,
        detail: `應該是 ${typo}。確認信與電子發票都收不到，需要跟她確認正確信箱。`,
        sms:
          `${o.name}你好，我是問爽的維尼。\n` +
          `你訂單上填的信箱 ${o.email} 我們寄不到信，確認信與電子發票會收不到。\n` +
          `方便回覆我正確的信箱嗎？我幫你更正。\n` +
          `訂單編號 ${o.order_no}`,
      });
      continue;
    }

    /* 二、ATM 已取號但還沒入帳，而且快到期。這是最會白白流失的一種：
       她想買、錢也準備好了，只是沒收到帳號或忘了轉。 */
    if (o.status === "pending" && atm.text) {
      const left = daysUntil(atm.due);
      if (left <= 2) {
        out.push({
          ...base,
          reason: "atm_due",
          rank: left <= 0 ? 1 : 2,
          headline: left <= 0 ? "ATM 已過期，帳號失效了" : `ATM 剩 ${Math.max(0, Math.ceil(left))} 天到期`,
          detail: `${itemsText(o.items)}　${atm.text}`,
          sms:
            `${o.name}你好，我是問爽的維尼。\n` +
            `你訂的商品我幫你留著了，轉帳資訊再提供一次：\n` +
            `${atm.text}\n` +
            `金額 ${money(o.total)}，訂單編號 ${o.order_no}。\n` +
            (left <= 0 ? "這組帳號已經到期，回覆我一聲我幫你重開一組。" : `${atm.due} 前完成轉帳就可以，謝謝你。`) + BOTH,
        });
        continue;
      }
    }

    /* 三、刷卡失敗被取消，而且沒有再回來買。
       綠界的說法是多半卡在 3D 驗證，跟她的卡沒關係，這句一定要講，
       不然她會以為自己額度不夠而放棄。 */
    if (
      o.status === "cancelled" &&
      /付款未完成|付款失敗|授權失敗|LINE Pay 請款失敗/.test(o.pay_note || "") &&
      !(o.pay_note || "").includes("後續已由") &&
      age <= 72 &&
      !orderSupersededBy({ id: o.id, email: o.email, name: o.name, phone: o.phone, pay_method: o.pay_method, pay_note: o.pay_note })
    ) {
      out.push({
        ...base,
        reason: "card_failed",
        rank: 3,
        headline: "刷卡失敗，之後沒有再回來",
        detail: itemsText(o.items),
        sms:
          `${o.name}你好，我是問爽的維尼。\n` +
          `你剛才那筆訂單刷卡沒有完成，但沒有扣到款，請放心。\n` +
          `這通常是卡片跟銀行驗證時中斷，跟你的卡沒有關係。\n` +
          `訂單我幫你留著了，這條可以直接付，建議選 ATM 或 LINE Pay：\n` +
          `${link}\n` +
          `有問題直接回我這裡。` + BOTH,
      });
      continue;
    }

    /*
     * 四、提醒信已經寄出第一封，人還是沒有動作。
     *
     * 不等第二封。第一封寄出的時候（下單滿一小時）就代表對方沒有在付款頁完成，
     * 而第二封要再等一天，等到那時候 ATM 帳號快過期、想買的心情也涼了。
     * 早一天傳訊息，救得回來的機率高得多；重複打擾的代價遠小於白白流失一筆。
     */
    if (o.status === "pending" && (o.remind_count || 0) >= 1) {
      out.push({
        ...base,
        reason: "pending_long",
        rank: 4,
        headline: `${waited(age)}未付款，提醒信寄過 ${o.remind_count} 次`,
        detail: itemsText(o.items),
        sms:
          `${o.name}你好，我是問爽的維尼。\n` +
          `你的訂單還沒完成付款，商品先幫你留著。\n` +
          `這條可以直接接續付款，資料不用重填：\n` +
          `${link}\n` +
          `如果不想買了也沒關係，回我一聲我把名額放掉就好。` + BOTH,
      });
    }
  }

  out.push(...sponsorQueue());
  return out.sort((a, b) => a.rank - b.rank || b.id - a.id);
}

/*
 * 贊助的待聯絡。
 *
 * 沒有電話的也列出來。滿 2,000 元才會留手機，舊資料一律沒有，
 * 但沒有電話不代表不用處理，只是處理方式從傳簡訊變成從後台寄一封信。
 * 卡片上會標出來，草稿一樣寫好，複製過去就能用。
 *
 * 跟商店同樣的四類，只有兩個地方不一樣：
 *
 * 一、贊助的 ATM 虛擬帳號存在自己的欄位（atm_bank／atm_vaccount／atm_expire），
 *     不像訂單是塞在備註字串裡，所以直接讀欄位就好。
 *
 * 二、刷卡失敗的贊助沒有「接續付款」這條路。付款頁只認 pending 的紀錄，
 *     一旦標成 failed 就打不開了，所以簡訊給的是重新支持的連結（金額已帶好），
 *     不是原本那條。給一條會跳「查無此筆」的連結比不給更糟。
 */
/*
 * 這個人後來自己又支持成功了嗎？
 * 跟訂單那邊同樣的道理：對著已經支持過的人再催一次，
 * 她只會以為自己其實沒支持成功。
 */
function sponsorSupersededBy(id: number, email: string): boolean {
  if (!email) return false;
  return Boolean(
    db
      .prepare(
        `SELECT 1 FROM sponsorships
         WHERE lower(trim(email))=lower(trim(?)) AND id>? AND status IN ('paid','active') LIMIT 1`
      )
      .get(email, id)
  );
}

function sponsorQueue(): ContactItem[] {
  const rows = db
    .prepare(
      `SELECT id,amount,display_name,email,COALESCE(phone,'') phone,status,pay_token,created_at,
              remind_count,COALESCE(last_charge_note,'') note,
              COALESCE(atm_bank,'') atm_bank,COALESCE(atm_vaccount,'') atm_vaccount,COALESCE(atm_expire,'') atm_expire
       FROM sponsorships
       WHERE status IN ('pending','failed') AND COALESCE(contacted_at,'')=''
       ORDER BY id DESC LIMIT 100`
    )
    .all() as {
      id: number; amount: number; display_name: string; email: string; phone: string;
      status: string; pay_token: string; created_at: string; remind_count: number; note: string;
      atm_bank: string; atm_vaccount: string; atm_expire: string;
    }[];

  const pool = loadPool("sponsor");
  const out: ContactItem[] = [];
  for (const sp of rows) {
    /* 支持者名稱是選填的。沒填的話開頭直接用「你好」，
       不然會變成「你好你好，我是小明」。 */
    const name = sp.display_name || "";
    const hi = name ? `${name}你好` : "你好";
    const link = `${site()}/support/pay/${sp.id}?t=${encodeURIComponent(sp.pay_token)}`;
    const age = hoursSince(sp.created_at);
    const typo = emailTypoSuggestion(sp.email);
    const base = {
      kind: "sponsor" as const, id: sp.id, orderNo: `支持 #${sp.id}`,
      name: name || "（匿名支持者）", phone: sp.phone, email: sp.email, total: sp.amount,
      canSms: Boolean(sp.phone),
      related: relatedOf(pool, "sponsor", `支持 #${sp.id}`, name, sp.phone, sp.email),
    };

    if (typo) {
      out.push({
        ...base,
        reason: "bad_email",
        rank: 0,
        headline: `信箱寄不到：${sp.email}`,
        detail: `應該是 ${typo}。收據與電子發票都收不到，需要確認正確信箱。`,
        sms:
          `${hi}，我是問爽的維尼。\n` +
          `你留的信箱 ${sp.email} 我們寄不到信，收據與電子發票會收不到。\n` +
          `方便回覆我正確的信箱嗎？我幫你更正。`,
      });
      continue;
    }

    /*
     * 二、ATM 已取號滿兩天還沒入帳。綠界的虛擬帳號只活三天，
     * 第二天催還來得及，等到第三天帳號就作廢了。
     * 取號幾乎就發生在建立的當下，所以用建立時間估算，誤差是分鐘等級。
     */
    if (sp.status === "pending" && sp.atm_vaccount) {
      const left = daysUntil(sp.atm_expire.replace(/-/g, "/"));
      if (age >= 48 || left <= 1) {
        out.push({
          ...base,
          reason: "atm_due",
          rank: left <= 0 ? 1 : 2,
          headline: left <= 0 ? "ATM 已過期，帳號失效了" : `ATM 取號 ${waited(age)}未入帳`,
          detail: `${sp.atm_bank} ${sp.atm_vaccount}${sp.atm_expire ? `　繳費期限 ${sp.atm_expire}` : ""}`,
          sms:
            `${hi}，我是問爽的維尼。\n` +
            `你的支持 ${money(sp.amount)} 還沒收到款，轉帳資訊再提供一次：\n` +
            `銀行代碼 ${sp.atm_bank}　帳號 ${sp.atm_vaccount}\n` +
            (left <= 0
              ? "這組帳號已經到期，回覆我一聲我幫你重開一組。"
              : sp.atm_expire
                ? `繳費期限 ${sp.atm_expire}，逾期帳號就會失效。`
                : "帳號有期限，逾期就會失效，麻煩你抽空處理。") + BOTH,
        });
        continue;
      }
    }

    /*
     * 三、刷卡失敗。跟商店那邊一樣，多半是卡在 3D 驗證而不是卡有問題，
     * 這句一定要講，不然對方會以為自己額度不夠而不再嘗試。
     */
    if (
      sp.status === "failed" &&
      /付款未完成|付款失敗|授權失敗|LINE Pay 請款失敗/.test(sp.note) &&
      age <= 72 &&
      !sponsorSupersededBy(sp.id, sp.email)
    ) {
      out.push({
        ...base,
        reason: "card_failed",
        rank: 3,
        headline: "刷卡失敗，之後沒有再回來",
        detail: sp.note,
        sms:
          `${hi}，我是問爽的維尼。\n` +
          `你剛才那筆 ${money(sp.amount)} 的支持刷卡沒有完成，但沒有扣到款，請放心。\n` +
          `這通常是卡片跟銀行驗證時中斷，跟你的卡沒有關係。\n` +
          `如果還想支持，這條金額已經幫你帶好了，建議選 ATM 或 LINE Pay：\n` +
          `${site()}/support?mode=once&amount=${sp.amount}\n` +
          `真的謝謝你。` + BOTH,
      });
      continue;
    }

    if (sp.status === "pending" && (sp.remind_count || 0) >= 1) {
      out.push({
        ...base,
        reason: "pending_long",
        rank: 4,
        headline: `支持 ${money(sp.amount)} 待付款，${waited(age)}，提醒信寄過 ${sp.remind_count} 次`,
        detail: "",
        sms:
          `${hi}，我是問爽的維尼。\n` +
          `你的支持還沒完成付款，這條可以直接接續：\n` +
          `${link}\n` +
          `如果是不小心按到或改變主意了也沒關係，回我一聲就好，真的謝謝你。` + BOTH,
      });
    }
  }
  return out;
}

/*
 * 「這筆可能錢已經進來了，但系統沒有入帳」。
 *
 * 為什麼需要：金流通知沒接上的情況一定會發生，而發生的時候完全沒有聲音。
 * 訂單停在已取消，發票沒開、信沒寄、出貨清單上也沒有，
 * 除非顧客自己來問，否則不會有人發現。鄭貴理那筆就是顧客先問了才知道。
 *
 * 判準的關鍵在這句話：綠界的信用卡只有在授權成功時才回呼。
 * 所以「金流從頭到尾沒說過話」不等於「沒有付款」，它同時也可能是通知掉了。
 * 一開始我只撈有金流單號的，那是錯的：那個單號是我們自己產的重試編號，
 * 只代表對方按過第二次，跟她有沒有付款無關。沉默的那些才最危險。
 *
 * 明確被金流回報失敗的（10100058、10100282 之類）不列進來，
 * 那種是綠界主動說了「這筆沒過」，確定沒扣到款。
 *
 * 分三個急迫度，照急迫度與金額排，先查大的：
 *  1 走進過付款流程，或 ATM 帳號還活著
 *  2 逾期取消而金流從沒說過話
 *  3 判定為重複而取消（同一個人另一筆確實付了，但也可能兩筆都付）
 */
export type SuspectOrder = {
  id: number;
  orderNo: string;
  name: string;
  total: number;
  status: string;
  payMethod: string;
  rank: number;
  /* 去金流後台要拿什麼去查 */
  lookup: string;
  why: string;
  createdAt: string;
};

export function suspectPaidOrders(): SuspectOrder[] {
  const rows = db
    .prepare(
      `SELECT id,order_no,name,total,status,pay_method,COALESCE(trade_no,'') trade_no,
              COALESCE(pay_note,'') pay_note,created_at
       FROM orders
       WHERE status IN ('pending','cancelled') AND COALESCE(gift,0)=0
       ORDER BY id DESC LIMIT 400`
    )
    .all() as {
      id: number; order_no: string; name: string; total: number; status: string;
      pay_method: string; trade_no: string; pay_note: string; created_at: string;
    }[];

  const out: SuspectOrder[] = [];
  for (const o of rows) {
    /* 綠界主動說了這筆沒過，不用查 */
    if (/付款未完成|付款失敗|授權失敗|LINE Pay 請款失敗/.test(o.pay_note)) continue;

    const linePayReqs = [...o.pay_note.matchAll(/LINEPAYREQ:(\d+)/g)].map((m) => m[1]);
    const retryNos = [...o.pay_note.matchAll(/金流單號 ([A-Z0-9]+)/g)].map((m) => m[1]);
    const atm = /(?:ATM 轉帳：|繳費帳號)\s*(\d+)\s+(\d+)/.exec(o.pay_note);
    const gateway = [o.trade_no, ...retryNos, ...linePayReqs].filter(Boolean);

    let rank = 0;
    let why = "";
    if (atm) {
      rank = 1;
      why = o.status === "cancelled" ? "已取消，但虛擬帳號可能還活著" : "ATM 已取號，帳號是活的";
    } else if (gateway.length > 0) {
      rank = 1;
      why = "曾按過第二次付款，確實走進過金流";
    } else if (o.status === "cancelled" && o.pay_note.includes(SUPERSEDED_MARK)) {
      rank = 3;
      why = "判定為重複而取消。同一個人另一筆有付，但也可能兩筆都付了";
    } else if (o.status === "cancelled") {
      rank = 2;
      why = "逾期取消，而金流從頭到尾沒說過話。信用卡只在成功時回呼，沉默不等於沒付";
    } else {
      /* 還在待付款而且沒取號：時間還沒到，系統的提醒信會處理，不用人工查 */
      continue;
    }

    out.push({
      id: o.id,
      orderNo: o.order_no,
      name: o.name,
      total: o.total,
      status: o.status,
      payMethod: o.pay_method,
      rank,
      lookup: gateway.length ? gateway.join("、") : atm ? `${atm[1]} ${atm[2]}` : o.order_no,
      why,
      createdAt: o.created_at,
    });
  }

  return out.sort((a, b) => a.rank - b.rank || b.total - a.total);
}
