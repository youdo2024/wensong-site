"use server";
import { redirect } from "next/navigation";
import { clientIp } from "@/lib/ratelimit";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import db, { setSetting, getSetting } from "@/lib/db";
import { episodeSlugConflict, parseChapterLine } from "@/lib/episodes";
import { bumpSessionEpoch, checkAccountPassword, checkPassword, createSession, currentAdmin, destroySession, isAdmin, loginLocked, recordLoginFail, clearLoginFails, passwordUsable, accountModeEnabled } from "@/lib/auth";
import { logAdmin } from "@/lib/admin-log";
import { sendOrderShippedMail, sendMail } from "@/lib/mail";
import { mailEnabled, sendOrderPaidMail, sendSponsorThanksMail, sendSponsorChargedMail, sendSponsorResumeMail } from "@/lib/mail";
import { checkEmail } from "@/lib/email-typo";
import { wrapMail, wrapOwnerMail } from "@/lib/mail";
import { restoreChoiceStocks, deductChoiceStocks } from "@/lib/choice-stock";
import { gaTestEvent } from "@/lib/ga";
import { isCvsMethod, normalizeBrand } from "@/lib/cvs";
import nodeCrypto from "crypto";
import { notifyOrderLine, orderStatusUrl, type LineOrderLike } from "@/lib/line";
import { resetRound, countManualRemind, sendNotice, loadOrderTarget, loadSponsorTarget } from "@/lib/remind";
import { carriesField } from "@/components/admin/settings-fields";


/*
 * 勾選框的儲存。
 *
 * 舊寫法是 formData.get(key) ? "1" : "0"，只要送出的表單裡沒有這個欄位就存成關閉。
 * 於是每次新增一個設定，只要有人用「還沒有那個勾選框的舊分頁」按下儲存，
 * 新設定就會被靜靜地關掉，而且畫面上完全看不出發生過什麼事。
 * 這件事真的發生過：贊助入口的三個開關上線後被舊分頁的一次儲存全部歸零。
 *
 * 現在每個勾選框前面都配一個同名的 hidden value="0"，所以只要表單是新版，
 * 至少會送出一個值；舊版表單則完全沒有這個欄位，這時保持原設定不動才是對的。
 *
 * 第二個坑（也真的發生過）：沒有寫 value 屬性的 checkbox，勾選時瀏覽器送出的是
 * "on" 而不是 "1"。原本這裡寫死比對 "1"，於是勾了照樣存成 "0"，畫面永遠打不開。
 * 現在標記那邊補上 value="1"，這裡也改成「只要有任何一個不是 "0" 的值就算勾選」，
 * 兩層各自成立，將來有人新增勾選框忘了寫 value 也不會再壞掉。
 */
/*
 * 勾選框是否有勾。開關列（components/admin/Switch）前面藏一個同名 value="0"，
 * 舊寫法 formData.get(key) ? 1 : 0 會把字串 "0" 當成有勾，永遠存成開。這裡看「有沒有任何一個不是 0 的值」。
 */
function on(formData: FormData, key: string): boolean {
  return formData.getAll(key).map(String).some((v) => v !== "0" && v !== "");
}

function setCheckbox(formData: FormData, key: string) {
  const vals = formData.getAll(key).map(String);
  if (vals.length === 0) return;
  setSetting(key, vals.some((v) => v !== "0") ? "1" : "0");
}

/* 同名多欄（MultiInput）＋舊逗號輸入相容：全部攤平成字串陣列 */
function getMulti(formData: FormData, name: string): string[] {
  return (formData.getAll(name) as string[])
    .flatMap((v) => String(v).split(/[,，、]/))
    .map((t) => t.trim())
    .filter(Boolean);
}
/* 信箱清單：同上再擋掉沒有 @ 的，存成逗號字串（lib/notify.ts 讀取端就是照逗號拆） */
function getEmails(formData: FormData, name: string): string {
  return Array.from(new Set(getMulti(formData, name).map((e) => e.toLowerCase()).filter((e) => e.includes("@")))).join(",");
}

/*
 * 設定拆六頁之後，儲存與各種工具鈕要回到「按下去的那一頁」而不是固定回目錄頁。
 * 頁面用隱藏欄位 _back 帶自己的網址過來，但那是使用者送上來的字串，
 * 直接丟給 redirect() 等於開一個把站長導去任意網站的洞，所以只認白名單那七條。
 */
const SETTINGS_PAGES = ["/admin/settings", "/admin/settings/shop", "/admin/settings/sponsor",
  "/admin/settings/pay", "/admin/settings/notify", "/admin/settings/content", "/admin/settings/system"];
function settingsBack(raw: FormDataEntryValue | null, fallback = "/admin/settings"): string {
  const v = String(raw || "");
  return SETTINGS_PAGES.includes(v) ? v : fallback;
}

async function guard() {
  if (!(await isAdmin())) redirect("/admin/login");
}

/* ── 登入（含防暴力破解） ── */
export async function login(formData: FormData) {
  const h = await headers();
  /*
   * 用 clientIp() 而不是直接讀 x-forwarded-for。
   *
   * 直接讀 XFF 的話，攻擊者每次請求換一個值就拿到一個全新的計數桶，
   * 「15 分鐘錯 8 次就鎖定」形同虛設，可以無限次猜密碼。
   * clientIp() 會優先採用平台注入的可信 header（Zeabur／Cloudflare），
   * 那些偽造不了。全站其他 18 處限流本來就用它，只有登入這支漏掉，
   * 而登入偏偏是最需要的那一支。
   */
  const ip = clientIp(h);
  if (loginLocked(ip)) redirect("/admin/login?error=locked");
  /*
   * 正式環境沒設好登入方式時 passwordUsable 一律回 false，
   * 這時顯示「密碼不對」會害站長一直重打密碼、找不到真正的原因，
   * 所以先分流出一個講清楚的訊息：要去 Zeabur 設環境變數。
   */
  if (!passwordUsable(process.env)) redirect("/admin/login?error=nopw");
  /* 有設任何一個 ADMIN_USER_N 就走帳號制，三個都沒設才退回舊的單一密碼（本機開發用） */
  if (accountModeEnabled(process.env)) {
    const username = String(formData.get("username") || "").trim();
    const pw = String(formData.get("password") || "");
    const user = checkAccountPassword(username, pw);
    if (!user) {
      recordLoginFail(ip);
      redirect("/admin/login?error=1");
    }
    clearLoginFails(ip);
    await createSession(user!);
  } else {
    const pw = String(formData.get("password") || "");
    if (!checkPassword(pw)) {
      recordLoginFail(ip);
      redirect("/admin/login?error=1");
    }
    clearLoginFails(ip);
    await createSession({ id: 0, name: "站長" });
  }
  await logAdmin("登入");
  redirect("/admin");
}
export async function logout() {
  /* 記錄與 bump 都要在 session 還有效的時候讀，作廢之後 currentAdmin() 就讀不到人了。
     帳號制（id>0）先記住是誰，等一下只 bump 這個人的 epoch，不影響另外兩位；
     單一密碼制（沒有帳號，currentAdmin() 讀不到人）退回 id 0，走全域那一份。 */
  const admin = (await currentAdmin()) ?? { id: 0, name: "站長" };
  await logAdmin("登出");
  /* 登出＝把這一代 session 作廢，不只是刪掉自己瀏覽器裡那張。
     cookie 沒有識別碼，站長懷疑 cookie 外流時能做的就是按登出；
     少了這一行，被側錄走的那張還能再用 7 天。只 bump 自己的 epoch，
     不會像改版前那樣把另外兩位當下的 session 一起踢掉（2026-09-14 審查抓到）。 */
  bumpSessionEpoch(admin);
  await destroySession();
  redirect("/admin/login");
}

/* ── 文章 ── */
export async function saveArticle(formData: FormData) {
  await guard();
  const id = Number(formData.get("id")) || 0;
  const data = {
    slug: String(formData.get("slug") || "").trim(),
    title: String(formData.get("title") || "").trim(),
    seo_title: String(formData.get("seo_title") || "").trim(),
    sources: String(formData.get("sources") || "").trim(),
    category: String(formData.get("category") || "生活"),
    tags: JSON.stringify(getMulti(formData, "tags")),
    date: String(formData.get("date") || new Date().toISOString().slice(0, 10)),
    read_min: Number(formData.get("read_min")) || 5,
    author: String(formData.get("author") || "問爽的").trim() || "問爽的",
    cta_text: String(formData.get("cta_text") || "").trim(),
    cover: String(formData.get("cover") || ""),
    location: String(formData.get("location") || ""),
    summary: String(formData.get("summary") || ""),
    body: String(formData.get("body") || ""),
    published: on(formData, "published") ? 1 : 0,
  };
  if (!data.slug || !data.title) redirect(`/admin/articles/${id || "new"}?error=missing`);

  if (id) {
    db.prepare("UPDATE articles SET updated_at=? WHERE id=?").run(new Date().toISOString().slice(0, 10), id);
    db.prepare(
      `UPDATE articles SET slug=@slug,title=@title,seo_title=@seo_title,sources=@sources,category=@category,tags=@tags,date=@date,read_min=@read_min,author=@author,cta_text=@cta_text,cover=@cover,location=@location,summary=@summary,body=@body,published=@published WHERE id=@id`
    ).run({ ...data, id });
  } else {
    db.prepare(
      `INSERT INTO articles (slug,title,seo_title,sources,category,tags,date,read_min,author,cta_text,cover,location,summary,body,published,sort)
       VALUES (@slug,@title,@seo_title,@sources,@category,@tags,@date,@read_min,@author,@cta_text,@cover,@location,@summary,@body,@published,
               (SELECT COALESCE(MIN(sort),1)-1 FROM articles))`
    ).run(data);
  }
  /* 文末 CTA 兩個開關（站長 2026-09-04）：表單有帶才寫，舊分頁沒這兩格就不動 */
  if (formData.has("cta_shop") || formData.has("cta_support")) {
    db.prepare("UPDATE articles SET cta_shop=COALESCE(?, cta_shop), cta_support=COALESCE(?, cta_support) WHERE slug=?").run(
      formData.has("cta_shop") ? (on(formData, "cta_shop") ? 1 : 0) : null,
      formData.has("cta_support") ? (on(formData, "cta_support") ? 1 : 0) : null,
      data.slug
    );
  }
  revalidatePath("/articles");
  /* 詳情頁是 ISR：存檔立即失效該篇快取，站長改完字重新整理就看得到 */
  revalidatePath(`/articles/${data.slug}`);
  if (data.published) {
    const { pingIndexNow } = await import("@/lib/indexnow");
    void pingIndexNow([`/articles/${data.slug}`]);
  }
  await logAdmin("編輯文章", data.slug, data.title);
  redirect("/admin/articles");
}
export async function deleteArticle(formData: FormData) {
  await guard();
  db.prepare("DELETE FROM articles WHERE id=?").run(Number(formData.get("id")));
  await logAdmin("刪除文章", String(formData.get("id") || ""));
  revalidatePath("/articles");
  redirect("/admin/articles");
}

/* ── 商品 ── */
export async function saveProduct(formData: FormData) {
  await guard();
  const id = Number(formData.get("id")) || 0;
  let story: unknown = [];
  let spec: unknown = [];
  try { story = JSON.parse(String(formData.get("story") || "[]")); } catch { redirect(`/admin/products/${id || "new"}?error=story`); }
  try { spec = JSON.parse(String(formData.get("spec") || "[]")); } catch { redirect(`/admin/products/${id || "new"}?error=spec`); }
  /* 補充圖：解析失敗就當沒有，不要因為這個擋住整筆存檔 */
  let images: string[] = [];
  try {
    const parsed = JSON.parse(String(formData.get("images") || "[]"));
    if (Array.isArray(parsed)) images = parsed.map((x) => String(x).trim()).filter(Boolean);
  } catch {}

  /* 規格選項＋各規格庫存（ChoicesEditor 送來的兩個 JSON；解析失敗就當沒有規格） */
  let choiceNames: string[] = [];
  let choiceStocks: Record<string, number> = {};
  try {
    const parsed = JSON.parse(String(formData.get("option_choices") || "[]"));
    if (Array.isArray(parsed)) choiceNames = parsed.map((x) => String(x).trim()).filter(Boolean);
  } catch {}
  try {
    const parsed = JSON.parse(String(formData.get("choice_stocks") || "{}"));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        const n = Number(v);
        if (choiceNames.includes(k) && Number.isFinite(n)) choiceStocks[k] = Math.max(0, Math.floor(n));
      }
    }
  } catch { choiceStocks = {}; }
  /* 規格下架日：只留「名稱存在＋日期格式正確」的 */
  let choiceExpiry: Record<string, string> = {};
  try {
    const parsed = JSON.parse(String(formData.get("choice_expiry") || "{}"));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        if (choiceNames.includes(k) && typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)) choiceExpiry[k] = v;
      }
    }
  } catch { choiceExpiry = {}; }

  const data = {
    name: String(formData.get("name") || "").trim(),
    category: String(formData.get("category") || "其他"),
    price: Number(formData.get("price")) || 0,
    stock: Math.max(0, Number(formData.get("stock")) || 0),
    description: String(formData.get("description") || ""),
    option_name: String(formData.get("option_name") || "").trim() || null,
    option_choices: JSON.stringify(choiceNames),
    choice_stocks: JSON.stringify(choiceStocks),
    choice_expiry: JSON.stringify(choiceExpiry),
    soldout_label: String(formData.get("soldout_label") || "").trim(),
    story: JSON.stringify(story),
    spec: JSON.stringify(spec),
    image: String(formData.get("image") || ""),
    images: JSON.stringify(images),
    featured: on(formData, "featured") ? 1 : 0,
    published: on(formData, "published") ? 1 : 0,
    price_original: Number(formData.get("price_original")) || 0,
    price_note: String(formData.get("price_note") || ""),
    notice: String(formData.get("notice") || ""),
    soldout_collapse: on(formData, "soldout_collapse") ? 1 : 0,
    partner_id: Number(formData.get("partner_id")) || null,
    temp_zone: String(formData.get("temp_zone")) === "cold" ? "cold" : "ambient",
    ship_note: String(formData.get("ship_note") || "").trim(),
    corp_entry: on(formData, "corp_entry") ? 1 : 0,
    free_ship: Math.max(0, Number(formData.get("free_ship")) || 0),
  };
  if (!data.name) redirect(`/admin/products/${id || "new"}?error=missing`);

  /* 編輯既有商品時的庫存競態防護：表單值＝開頁當下的快照，
     編輯期間可能有人下單把庫存扣掉了。只有站長「真的改了」的欄位才用表單值，
     沒動過的一律保留資料庫現值，避免舊快照把已售出的量蓋回去 */
  if (id) {
    const cur = db.prepare("SELECT stock, choice_stocks FROM products WHERE id=?").get(id) as
      | { stock: number; choice_stocks: string }
      | undefined;
    if (cur) {
      const stockOrig = Number(formData.get("stock_orig"));
      if (Number.isFinite(stockOrig) && data.stock === stockOrig) data.stock = cur.stock;
      try {
        const origMap = JSON.parse(String(formData.get("choice_stocks_orig") || "{}")) as Record<string, number>;
        const curMap = JSON.parse(cur.choice_stocks || "{}") as Record<string, number>;
        const merged: Record<string, number> = {};
        for (const [k, v] of Object.entries(choiceStocks)) {
          const untouched = Object.prototype.hasOwnProperty.call(origMap, k) && origMap[k] === v;
          merged[k] = untouched && Object.prototype.hasOwnProperty.call(curMap, k) ? curMap[k] : v;
        }
        data.choice_stocks = JSON.stringify(merged);
      } catch {}
    }
  }

  if (id) {
    db.prepare(
      `UPDATE products SET name=@name,category=@category,price=@price,stock=@stock,description=@description,option_name=@option_name,option_choices=@option_choices,choice_stocks=@choice_stocks,choice_expiry=@choice_expiry,soldout_label=@soldout_label,story=@story,spec=@spec,image=@image,images=@images,featured=@featured,published=@published,price_original=@price_original,price_note=@price_note,notice=@notice,soldout_collapse=@soldout_collapse,partner_id=@partner_id,temp_zone=@temp_zone,ship_note=@ship_note,corp_entry=@corp_entry,free_ship=@free_ship WHERE id=@id`
    ).run({ ...data, id });
  } else {
    db.prepare(
      `INSERT INTO products (name,category,price,stock,description,option_name,option_choices,choice_stocks,choice_expiry,soldout_label,story,spec,image,images,featured,published,sort,price_original,price_note,notice,soldout_collapse,partner_id,temp_zone,ship_note,corp_entry,free_ship)
       VALUES (@name,@category,@price,@stock,@description,@option_name,@option_choices,@choice_stocks,@choice_expiry,@soldout_label,@story,@spec,@image,@images,@featured,@published,
               (SELECT COALESCE(MAX(sort),0)+1 FROM products),@price_original,@price_note,@notice,@soldout_collapse,@partner_id,@temp_zone,@ship_note,@corp_entry,@free_ship)`
    ).run(data);
  }
  revalidatePath("/shop");
  redirect("/admin/products");
}
export async function deleteProduct(formData: FormData) {
  await guard();
  const id = Number(formData.get("id"));
  /*
   * 有訂單引用的商品不准刪，只准下架。
   *
   * 硬刪除的後果不是資料庫壞掉，是更陰的：訂單還在，但出貨工作台是拿
   * 「現存商品」去對照訂單品項的，商品一消失，該商品所有未出貨的訂單
   * 就從工作台上蒸發——沒有錯誤、沒有警告，就是沒人會出那批貨。
   * 之後夥伴結算報表也要靠商品對回夥伴，刪了帳就對不起來。
   * 付款連結同理：連結上談好的品項對不回商品，預扣的庫存也無從釋放。
   */
  const referenced = (() => {
    const rows = db.prepare("SELECT items FROM orders UNION ALL SELECT items FROM pay_links").all() as { items: string }[];
    for (const r of rows) {
      try {
        if ((JSON.parse(r.items || "[]") as { id: number }[]).some((it) => Number(it.id) === id)) return true;
      } catch { /* 壞資料不擋刪除判斷 */ }
    }
    return false;
  })();
  if (referenced) {
    db.prepare("UPDATE products SET published=0 WHERE id=?").run(id);
    redirect(`/admin/products?err=${encodeURIComponent("這個商品已有訂單或付款連結引用，不能刪除（已幫你改成下架）。刪掉它會讓那些訂單從出貨工作台上消失。")}`);
  }
  db.prepare("DELETE FROM products WHERE id=?").run(id);
  revalidatePath("/shop");
  redirect("/admin/products");
}

/*
 * 人工確認款項已到，把訂單補成已付款。
 *
 * 為什麼需要這顆按鈕：金流那邊錢確實進來了，但通知沒接上的情況一定會發生
 * （訂單先被取消、通知晚一步、或金流商當下連不上）。沒有這條路的話，
 * 唯一的辦法是直接改資料庫，而那樣不會開發票、不會寄信、
 * 出貨清單也不會多出那一盒，等於只是把狀態欄塗掉。
 *
 * 這裡走的是跟自動入帳完全相同的後續流程，所以補回來的訂單跟正常訂單沒有差別。
 */
export async function markOrderPaidByHand(formData: FormData) {
  await guard();
  const id = Number(formData.get("id")) || 0;
  const tradeNo = String(formData.get("trade_no") || "").trim();
  /* 打錯一個數字就是把別人的訂單標成已付款，所以要求把訂單編號打對才放行 */
  const typed = String(formData.get("confirm_no") || "").trim().toUpperCase();
  const row = db.prepare("SELECT order_no FROM orders WHERE id=?").get(id) as { order_no: string } | undefined;
  if (!row) redirect(`/admin/orders?err=${encodeURIComponent("查無這筆訂單")}`);
  if (typed !== row.order_no.toUpperCase()) {
    redirect(`/admin/orders/${id}?err=${encodeURIComponent("訂單編號沒有打對，為了避免標錯訂單，這一步不能省略")}`);
  }
  const { markOrderPaidManually } = await import("@/lib/payment-sync");
  const r = markOrderPaidManually(id, "站長", tradeNo || undefined);
  revalidatePath(`/admin/orders/${id}`);
  revalidatePath("/admin/orders");
  revalidatePath("/partner");
  if (!r.ok) redirect(`/admin/orders/${id}?err=${encodeURIComponent(r.reason || "沒有更動")}`);
  redirect(`/admin/orders/${id}?saved=manualpaid`);
}

/* ── 贈品訂單 ── */

/*
 * 站長自己要送人的單：不收錢，但貨真的要做要寄，所以要進夥伴的出貨清單、
 * 要佔該週的產能。全有全無，任何一位過不了就整批退回來。
 */
export async function createGiftOrdersAction(formData: FormData) {
  await guard();
  const count = Math.min(50, Math.max(0, Number(formData.get("count")) || 0));
  const recipients = [];
  for (let i = 0; i < count; i++) {
    const ship = String(formData.get(`ship_${i}`) || "宅配");
    recipients.push({
      name: String(formData.get(`name_${i}`) || ""),
      phone: String(formData.get(`phone_${i}`) || ""),
      /* 可留空：留空的話出貨通知會寄給站長自己（見 lib/gift-order.ts 的說明） */
      email: String(formData.get(`email_${i}`) || "").trim(),
      qty: Number(formData.get(`qty_${i}`)) || 0,
      shipMethod: (ship === "7-11店到店" ? "7-11店到店" : "宅配") as "宅配" | "7-11店到店",
      address: String(formData.get(`address_${i}`) || ""),
      storeName: String(formData.get(`store_name_${i}`) || ""),
      storeNo: String(formData.get(`store_no_${i}`) || ""),
    });
  }
  const { createGiftOrders } = await import("@/lib/gift-order");
  const r = createGiftOrders({
    productId: Number(formData.get("product_id")) || 0,
    choice: String(formData.get("choice") || ""),
    note: String(formData.get("note") || ""),
    recipients,
  });
  revalidatePath("/admin/orders");
  revalidatePath("/partner");
  if (!r.ok) {
    /*
     * 失敗時把「每一條問題」與「哪幾列有問題」都帶回去。
     * 表單本身不靠這個回傳值復原資料——那份名單存在瀏覽器的草稿裡，
     * 頁面重新載入之後會自己長回來（見 components/GiftOrderForm.tsx）。
     * 這裡帶回去的只是「要改哪裡」。
     */
    const qs = new URLSearchParams({ gifterr: r.problems.join("\n") });
    if (r.badRows.length > 0) qs.set("giftbad", r.badRows.join(","));
    redirect(`/admin/orders?${qs.toString()}`);
  }
  redirect(`/admin/orders?gift=${encodeURIComponent(r.orderNos.join(","))}`);
}

/* ── 寄不到的信箱 ── */

/*
 * 把一個信箱標記為寄不到。
 *
 * 標了之後全站都不再寄給它：待付款提醒、電子報、訂單通知一律跳過。
 * 為什麼需要：信箱滿了或根本不存在的時候，系統不知道自己在對空氣說話，
 * 一封一封照寄，每一封都換來一封退信塞進站長的信箱。
 */
export async function blockMailAddress(formData: FormData) {
  await guard();
  const email = String(formData.get("email") || "").trim().toLowerCase();
  const reason = String(formData.get("reason") || "").trim() || "退信";
  if (!email.includes("@")) redirect(`/admin/mail?err=${encodeURIComponent("請填一個有 @ 的信箱")}`);
  const { blockMail } = await import("@/lib/mail");
  blockMail(email, reason);
  revalidatePath("/admin/mail");
  revalidatePath("/admin/contact");
  /* 從待聯絡那邊按的要回待聯絡，不然標一個信箱就被丟到另一頁，很難連續處理 */
  const back = String(formData.get("back") || "") === "contact" ? "/admin/contact" : "/admin/mail";
  redirect(`${back}?blocked=${encodeURIComponent(email)}`);
}

export async function unblockMailAddress(formData: FormData) {
  await guard();
  const email = String(formData.get("email") || "").trim().toLowerCase();
  const { unblockMail } = await import("@/lib/mail");
  unblockMail(email);
  revalidatePath("/admin/mail");
  redirect(`/admin/mail?unblocked=${encodeURIComponent(email)}`);
}

/* ── 待聯絡清單 ── */

/*
 * 標記已經自己聯絡過了。標了之後從清單消失，並在備註留下時間，
 * 日後回頭看得出這筆有沒有人跟進過。
 */
export async function markContacted(formData: FormData) {
  await guard();
  const id = Number(formData.get("id")) || 0;
  const sponsor = String(formData.get("kind")) === "sponsor";
  const now = new Date().toISOString();
  const stamp = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(5, 16).replace("T", " ");
  const note = `（${stamp} 站長已用手機聯絡）`;
  /* 順手在備註留一筆。日後回頭看那筆訂單，看得出有沒有人跟進過，
     不然只有一個 contacted_at 時間戳，過兩個月連自己都想不起來做了什麼。 */
  if (sponsor) {
    db.prepare("UPDATE sponsorships SET contacted_at=?, last_charge_note=trim(COALESCE(last_charge_note,'') || ' ' || ?) WHERE id=? AND COALESCE(contacted_at,'')=''")
      .run(now, note, id);
  } else {
    db.prepare("UPDATE orders SET contacted_at=?, pay_note=trim(COALESCE(pay_note,'') || ' ' || ?) WHERE id=? AND COALESCE(contacted_at,'')=''")
      .run(now, note, id);
  }
  revalidatePath("/admin/contact");
  redirect("/admin/contact?done=1");
}

/* 標錯了要能改回來 */
export async function unmarkContacted(formData: FormData) {
  await guard();
  const id = Number(formData.get("id")) || 0;
  const table = String(formData.get("kind")) === "sponsor" ? "sponsorships" : "orders";
  db.prepare(`UPDATE ${table} SET contacted_at='' WHERE id=?`).run(id);
  revalidatePath("/admin/contact");
  redirect("/admin/contact?undone=1");
}

/* ── 後台手寫信 ── */

/*
 * 用站上的信件版型寄一封手寫信。
 *
 * 為什麼要有：站長常常需要單獨聯絡某幾位顧客（刷卡失敗、信箱打錯、缺件確認），
 * 從 Gmail 寄出去的是一封白底純文字信，跟系統寄的訂單信完全不像同一個品牌。
 * 這支讓那種信也長成同一個樣子。
 *
 * 刻意設上限：這是寫給特定幾個人的工具，不是群發電子報。
 * 真要群發名單需要退訂連結與寄送速率控制，混在一起遲早把網域寄到被當垃圾信。
 */
export async function sendAdminMail(formData: FormData) {
  await guard();
  const { buildAdminMail, parseRecipients, ADMIN_MAIL_MAX } = await import("@/lib/admin-mail");
  const { sendMail, mailEnabled } = await import("@/lib/mail");
  const { checkEmail } = await import("@/lib/email-typo");

  const to = parseRecipients(String(formData.get("to") || ""));
  const subject = String(formData.get("subject") || "").trim();
  const title = String(formData.get("title") || "").trim();
  const body = String(formData.get("body") || "").trim();

  const fail = (msg: string) => redirect(`/admin/mail?err=${encodeURIComponent(msg)}`);
  if (!mailEnabled()) fail("還沒設定寄信服務（SMTP），寄不出去");
  if (to.length === 0) fail("請填收件人");
  if (to.length > ADMIN_MAIL_MAX) fail(`一次最多 ${ADMIN_MAIL_MAX} 位收件人，這次有 ${to.length} 位`);
  if (!subject) fail("請填信件主旨");
  if (!body) fail("請填內文");
  /* 收件人也走同一套信箱檢查，打錯網域就直接擋下，不要寄出去才發現退信 */
  for (const e of to) {
    const err = checkEmail(e);
    if (err) fail(`${e}：${err}`);
  }

  const html = buildAdminMail({
    title,
    body,
    btnText: String(formData.get("btn_text") || ""),
    btnUrl: String(formData.get("btn_url") || ""),
    footnote: String(formData.get("footnote") || ""),
  });

  /*
   * 逐封寄，一封失敗不影響其他封。sendMail 回傳 false 就是這一封沒成功。
   * 每封都進寄件紀錄（含整封內容，列表上可以「看內容」、失敗可以「重寄」）。
   *
   * 副本：只寄一個人時交給 sendMail 用密件副本；寄多人時每封都副本會收到 N 封一樣的，
   * 所以改成這裡自己寄一封總副本，最上面列出「本次寄給：⋯共 N 人」。
   */
  const { copyPlan, copyTarget, recipientsLine } = await import("@/lib/mail-log");
  const { sendCopyOnly } = await import("@/lib/mail");
  const many = to.length > 1;
  const okList: string[] = [];
  const badList: string[] = [];
  const run = async () => {
    for (const e of to) {
      let ok = false;
      try {
        ok = await sendMail(e, subject, html, undefined, { kind: "manual", keepBody: true, copy: many ? "none" : "auto" });
      } catch (err) {
        console.error("[admin mail] 寄送失敗", e, err);
      }
      (ok ? okList : badList).push(e);
    }
    if (many && okList.length > 0) {
      const copyTo = copyTarget(copyPlan(), "manual", "");
      /* 副本信箱自己就在收件人裡的話，他已經收到原信了，不用再一封總副本 */
      if (copyTo && !okList.some((e) => e.toLowerCase() === copyTo.toLowerCase())) await sendCopyOnly(copyTo, subject, recipientsLine(okList) + html);
    }
  };

  /*
   * 一封 SMTP 要一到三秒。收件人多的時候在這裡等到寄完，瀏覽器早就逾時，站長看到錯誤再按一次
   * 就是六十個人收到兩封。所以超過幾個人就丟到背景跑、馬上回頁面，結果看寄件紀錄。
   */
  if (to.length > ADMIN_MAIL_SYNC_MAX) {
    void run().catch((err) => console.error("[admin mail] 背景寄送炸掉", err));
    redirect(`/admin/mail?queued=${to.length}#log`);
  }
  await run();
  const q = new URLSearchParams({ sent: String(okList.length) });
  if (badList.length) q.set("failed", badList.join(","));
  redirect(`/admin/mail?${q.toString()}`);
}

/* 幾個人以內當場寄完再回頁面（馬上看到「已寄出 N 封」）；超過就背景寄 */
const ADMIN_MAIL_SYNC_MAX = 5;

/* 寄件紀錄裡失敗的手寫信「重寄」：用當時存下的主旨與整封內容原樣再寄一次，會再記一筆 */
export async function resendMailLog(formData: FormData) {
  await guard();
  const { mailLogById } = await import("@/lib/mail-log");
  const { sendMail } = await import("@/lib/mail");
  const id = Number(formData.get("id")) || 0;
  const row = mailLogById(id);
  if (!row) redirect("/admin/mail?err=" + encodeURIComponent("找不到這筆寄件紀錄") + "#log");
  if (row!.kind !== "manual" || !row!.body) redirect("/admin/mail?err=" + encodeURIComponent("只有手寫信能從紀錄重寄") + "#log");
  if (row!.status !== "failed") redirect("/admin/mail?err=" + encodeURIComponent("這封已經寄出去了，要再寄請重新寫一封") + "#log");
  let ok = false;
  try { ok = await sendMail(row!.to_addr, row!.subject, row!.body, undefined, { kind: "manual", keepBody: true }); } catch { ok = false; }
  redirect(`/admin/mail?${ok ? "ok" : "err"}=${encodeURIComponent(ok ? `已重寄給 ${row!.to_addr}` : `重寄失敗：${row!.to_addr}`)}#log`);
}

/* ── 付款連結 ── */

/*
 * 建立付款連結。金額由站長決定，所以這條路一定要在登入後台之後才走得到，
 * 不能有任何免登入的入口，否則等於開放任何人建立一元訂單。guard() 就是那道門。
 *
 * 表單以平行陣列送出（item_pid[]、item_name[] …），因為一條連結可以有好幾個項目。
 * 各陣列長度不一致時只取最短的那個長度，寧可少一列也不要錯位組出一個亂掉的項目。
 */
export async function createPayLinkAction(formData: FormData) {
  await guard();
  const { createPayLink } = await import("@/lib/pay-link");
  const arr = (k: string) => formData.getAll(k).map(String);
  const pids = arr("item_pid");
  const names = arr("item_name");
  const choices = arr("item_choice");
  const prices = arr("item_price");
  const qtys = arr("item_qty");
  const len = Math.min(pids.length, names.length, choices.length, prices.length, qtys.length);

  const items = [] as { id: number; name: string; choice: string | null; price: number; qty: number }[];
  for (let i = 0; i < len; i++) {
    const qty = Math.floor(Number(qtys[i]) || 0);
    const name = names[i].trim();
    if (qty <= 0 || !name) continue;   /* 空白列直接略過，讓站長可以留空行不填 */
    items.push({
      id: Math.max(0, Math.floor(Number(pids[i]) || 0)),
      name,
      choice: choices[i].trim() || null,
      price: Math.max(0, Math.floor(Number(prices[i]) || 0)),
      qty,
    });
  }

  /*
   * 一條付款連結限單一出貨地×溫層：多地址名單掛在整筆訂單上，
   * 兩個夥伴各出一半是拆不開的（出貨工作台的歸屬判斷也依賴這個前提）。
   * 自訂項目（id=0）視為本店常溫。
   */
  const realIds = [...new Set(items.map((i) => i.id).filter((x) => x > 0))];
  if (realIds.length > 1) {
    const marks = realIds.map(() => "?").join(",");
    const origins = new Set(
      (db.prepare(`SELECT COALESCE(partner_id,0) AS o, temp_zone FROM products WHERE id IN (${marks})`).all(...realIds) as { o: number; temp_zone: string }[])
        .map((r2) => `${r2.o}|${r2.temp_zone === "cold" ? "cold" : "ambient"}`)
    );
    if (items.some((i) => i.id === 0)) origins.add("0|ambient");
    if (origins.size > 1)
      redirect(`/admin/pay-links?err=${encodeURIComponent("一條付款連結只能包含同一個出貨地（同一位夥伴、同一溫層）的商品，請分成兩條連結。")}`);
  }

  const pays = formData.getAll("pays").map(String).filter(Boolean);
  const r = createPayLink({
    title: String(formData.get("title") || ""),
    items,
    needAddress: String(formData.get("need_address") || "") === "1",
    pays,
    holdDays: Number(formData.get("hold_days")) || 30,
    invTaxId: String(formData.get("inv_tax_id") || ""),
    invCompany: String(formData.get("inv_company") || ""),
    presetName: String(formData.get("preset_name") || ""),
    presetPhone: String(formData.get("preset_phone") || ""),
    presetEmail: String(formData.get("preset_email") || ""),
  });
  if (!r.ok) redirect(`/admin/pay-links?err=${encodeURIComponent(r.error)}`);
  revalidatePath("/admin/pay-links");
  redirect(`/admin/pay-links?created=${encodeURIComponent(r.token)}`);
}

/* 作廢還沒用掉的連結：預扣的庫存立刻放回去 */
export async function cancelPayLinkAction(formData: FormData) {
  await guard();
  const { cancelPayLink } = await import("@/lib/pay-link");
  const ok = cancelPayLink(Number(formData.get("id")) || 0);
  revalidatePath("/admin/pay-links");
  redirect(`/admin/pay-links?${ok ? "cancelled=1" : "err=" + encodeURIComponent("這條連結不是「可用」狀態，沒有作廢")}`);
}

/* ── 訂單 ── */
export async function updateOrder(formData: FormData) {
  await guard();
  const id = Number(formData.get("id"));
  const newStatus = String(formData.get("status") || "paid");
  const prev = db.prepare("SELECT status,items FROM orders WHERE id=?").get(id) as { status: string; items: string } | undefined;
  /*
   * 手動跨越「已取消」邊界時同步庫存（總庫存＋規格庫存），
   * 跟金流失敗自動取消、刪單還庫存的行為保持一致：
   * 改成取消＝加回；從取消改回有效＝重新扣掉。
   *
   * 整組包進同一個交易：庫存與訂單狀態必須一起成立或一起不成立。
   * 分開跑的話，中途出錯會留下「庫存加回了、訂單還是待付款」這種對不起來的狀態，
   * 而且沒有任何痕跡。JSON 解析失敗也要讓整筆退回去，不能默默略過。
   */
  db.transaction(() => {
    if (prev && prev.status !== "cancelled" && newStatus === "cancelled") {
      const items = JSON.parse(prev.items) as { id: number; qty: number }[];
      const inc = db.prepare("UPDATE products SET stock = stock + ? WHERE id=?");
      for (const i of items) inc.run(i.qty, i.id);
      restoreChoiceStocks(prev.items);
    } else if (prev && prev.status === "cancelled" && newStatus !== "cancelled") {
      const items = JSON.parse(prev.items) as { id: number; qty: number }[];
      const dec = db.prepare("UPDATE products SET stock = stock - ? WHERE id=?");
      for (const i of items) dec.run(i.qty, i.id);
      deductChoiceStocks(prev.items);
    }
    /* 不再處理物流單號：站長不使用，欄位保留在資料庫但不再寫入 */
    /* 退款時間戳：進入「已退款」蓋章、離開就清掉（結算負項認這個欄位，不是 created_at） */
    if (newStatus === "refunded" && prev?.status !== "refunded") {
      db.prepare("UPDATE orders SET status=?, refunded_at=? WHERE id=?").run(newStatus, new Date().toISOString(), id);
    } else if (newStatus !== "refunded" && prev?.status === "refunded") {
      db.prepare("UPDATE orders SET status=?, refunded_at='' WHERE id=?").run(newStatus, id);
    } else {
      db.prepare("UPDATE orders SET status=? WHERE id=?").run(newStatus, id);
    }
  })();
  /* 改成「已出貨」時自動寄物流通知 */
  if (newStatus === "shipped" && prev?.status !== "shipped") {
    const full = db.prepare("SELECT * FROM orders WHERE id=?").get(id) as Parameters<typeof sendOrderShippedMail>[0];
    void sendOrderShippedMail(full);
    void notifyOrderLine("shipped", full as LineOrderLike, { url: orderStatusUrl(full.order_no, (full as LineOrderLike).token || "") }).catch((e) => console.error("[line] shipped", e));
  }
  redirect(`/admin/orders/${id}?saved=1`);
}

/*
 * 修改訂單的收件資訊。
 *
 * 為什麼需要：顧客把信箱打錯是真的會發生的（karen_liu12 打成 liu13、
 * gmail.com 打成 gmail.con），而信箱錯了她就收不到確認信與電子發票。
 * 發票是在付款成功的那一刻由光貿開立並寄出，所以一定要趕在付款之前改好，
 * 事後才發現就要作廢重開，稅務上麻煩得多。
 *
 * 地址與姓名也一起開放修改：門牌打錯、誤觸多打一個字都會讓貨寄不到。
 */
export async function updateOrderContact(formData: FormData) {
  await guard();
  const { checkEmail } = await import("@/lib/email-typo");
  const id = Number(formData.get("id")) || 0;
  const name = String(formData.get("name") || "").trim();
  const phone = String(formData.get("phone") || "").replace(/[\s-]/g, "");
  const email = String(formData.get("email") || "").trim();
  const address = String(formData.get("address") || "").trim();
  /* 郵遞區號手動值：留空＝交給系統即時推導；填了就以人的為準（lib/zip-lookup.ts 的優先序） */
  const zip = String(formData.get("zip") || "").trim();
  /* 收件人：留空＝同訂購人。姓名空著就不管電話欄位打了什麼，強制一起清空，
     不讓「填了電話沒填姓名」這種半吊子資料存進去（lib/recipient.ts 的判斷只看姓名） */
  const recipientName = String(formData.get("recipient_name") || "").trim();
  const recipientPhoneRaw = String(formData.get("recipient_phone") || "").replace(/[\s-]/g, "");
  const recipientPhone = recipientName ? recipientPhoneRaw : "";

  const bad = (m: string) => redirect(`/admin/orders/${id}?err=${encodeURIComponent(m)}`);
  if (!id) bad("找不到這筆訂單");
  if (!name) bad("姓名不能空白");
  if (!/^09\d{8}$/.test(phone)) bad("電話請填 10 碼手機號碼（09 開頭）");
  if (recipientName && !/^09\d{8}$/.test(recipientPhone)) bad("收件人電話請填 10 碼手機號碼（09 開頭）");
  if (zip && !/^\d{3}$/.test(zip)) bad("郵遞區號請填 3 碼數字，或留空讓系統自動判別");
  const emailErr = checkEmail(email);
  if (emailErr) bad(emailErr);

  const prev = db.prepare("SELECT email FROM orders WHERE id=?").get(id) as { email: string } | undefined;
  if (!prev) bad("找不到這筆訂單");
  db.prepare("UPDATE orders SET name=?, phone=?, email=?, address=?, zip=?, recipient_name=?, recipient_phone=? WHERE id=?")
    .run(name, phone, email, address, zip, recipientName, recipientPhone, id);
  /* 信箱換過要留痕跡：日後對帳或客訴時查得到原本寄到哪裡去了 */
  if (prev && prev.email !== email) {
    const stamp = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(5, 16).replace("T", " ");
    db.prepare("UPDATE orders SET pay_note=trim(COALESCE(pay_note,'') || ' ' || ?) WHERE id=?")
      .run(`（${stamp} 信箱由 ${prev.email} 改為 ${email}）`, id);
  }
  revalidatePath(`/admin/orders/${id}`);
  redirect(`/admin/orders/${id}?saved=contact`);
}

/*
 * 重寄這筆訂單的信。
 *
 * 待付款且已取號的寄繳費資訊（顧客最需要的是那組帳號），
 * 待付款但還沒取號的寄訂單確認信，已付款的寄付款完成通知。
 * 改完信箱之後按這顆，對方才真的收得到東西。
 */
/*
 * 待付款訂單：換付款方式並產生結帳連結。
 *
 * 為什麼需要：顧客結帳選了 LINE Pay 之後想改別的，以前只能請她重下一單，
 * 舊單留著佔庫存、新單再扣一次，站長還要手動去取消舊的。
 * 這裡沿用同一張訂單、同一組權杖，只改 pay_method 並在 pay_note 留痕。
 * 庫存在建單時就扣過了，這裡一顆都不碰；連結就是 /api/orders/pay 加 m= 參數，
 * 顧客點下去的那一刻才真的去金流商建立交易（綠界每次換新號、LINE Pay 每次新請求）。
 *
 * 只對 pending 生效。已取消的單另有 reopenFailedOrderForRetry 那條路，會重新檢查庫存，
 * 不在這裡混做。舊單沒有權杖的順手補一組。
 */
export async function switchOrderPay(formData: FormData) {
  await guard();
  const id = Number(formData.get("id")) || 0;
  const method = String(formData.get("pay_method") || "").trim();
  const wantMail = String(formData.get("mail") || "") === "1";
  const o = db.prepare("SELECT * FROM orders WHERE id=?").get(id) as
    | {
        id: number; order_no: string; name: string; email: string; address: string; items: string;
        subtotal: number; shipping: number; total: number; status: string; pay_method: string; pay_note: string; token: string;
      }
    | undefined;
  if (!o) redirect("/admin/orders");
  const back = (q: string) => redirect(`/admin/orders/${id}?${q}`);
  if (o.status !== "pending") back("err=" + encodeURIComponent("只有待付款的訂單能換付款方式"));
  const { retryPayOptions } = await import("@/lib/shop");
  if (!retryPayOptions().includes(method)) back("err=" + encodeURIComponent("這個付款方式目前沒有開放，先到網站設定看看是不是被停用了"));

  let token = o.token || "";
  const stamp = new Date().toLocaleString("zh-TW", { timeZone: "Asia/Taipei", hour12: false });
  db.transaction(() => {
    if (!token) {
      token = nodeCrypto.randomBytes(12).toString("hex");
      db.prepare("UPDATE orders SET token=? WHERE id=? AND COALESCE(token,'')=''").run(token, id);
    }
    if (method !== o.pay_method) {
      const note = `${o.pay_note || ""}${o.pay_note ? " " : ""}（站長 ${stamp} 將付款方式由 ${o.pay_method || "未填"} 改為 ${method}）`;
      db.prepare("UPDATE orders SET pay_method=?, pay_note=? WHERE id=? AND status='pending'").run(method, note, id);
      /* 通知整合：換付款方式後提醒重算一輪（最多一次） */
      resetRound("order", id);
    }
  })();
  revalidatePath(`/admin/orders/${id}`);
  revalidatePath("/admin/orders");

  if (!wantMail) back("saved=paylink");
  if (!o.email) back("saved=paylink&err=" + encodeURIComponent("這張訂單沒有信箱，連結請自己複製給顧客"));
  const { sendOrderPayLinkMail, mailEnabled } = await import("@/lib/mail");
  if (!mailEnabled()) back("saved=paylink&err=" + encodeURIComponent("付款方式已改，但還沒設定寄信服務（SMTP），信沒寄出"));
  let ok = false;
  try {
    ok = await sendOrderPayLinkMail({
      order_no: o.order_no, name: o.name, email: o.email, address: o.address,
      items: o.items, subtotal: o.subtotal, shipping: o.shipping, total: o.total,
      token, pay_method: method,
    });
  } catch (e) {
    console.error("[paylink] 付款連結信寄送失敗", o.order_no, e);
  }
  back(ok ? "saved=paylinkmail" : "saved=paylink&err=" + encodeURIComponent("付款方式已改，但信寄送失敗，連結請自己複製給顧客"));
}

/* 未取消的訂單刪除時把庫存加回去（測試單、誤下單都適用），規格庫存一併加回 */
function restoreStockOf(itemsJson: string, status: string) {
  if (status === "cancelled") return;
  const items = JSON.parse(itemsJson) as { id: number; qty: number }[];
  const inc = db.prepare("UPDATE products SET stock = stock + ? WHERE id=?");
  for (const i of items) inc.run(i.qty, i.id);
  restoreChoiceStocks(itemsJson);
}

/* 刪除單筆訂單（例如自己測試的單）：庫存加回、訂單消失，統計自動更新 */
export async function deleteOrder(formData: FormData) {
  await guard();
  const id = Number(formData.get("id"));
  const o = db.prepare("SELECT items,status FROM orders WHERE id=?").get(id) as { items: string; status: string } | undefined;
  if (o) {
    /* 加回庫存與刪掉訂單要一起成立：只回補卻沒刪掉，庫存就會憑空多出一份 */
    db.transaction(() => {
      restoreStockOf(o.items, o.status);
      db.prepare("DELETE FROM orders WHERE id=?").run(id);
    })();
  }
  revalidatePath("/admin/orders");
  redirect("/admin/orders?deleted=1");
}

/* 一鍵清空全部訂單紀錄（＝所有商品統計歸零）。需在輸入框打「清空訂單」二次確認 */
export async function clearAllOrders(formData: FormData) {
  await guard();
  if (String(formData.get("confirm") || "").trim() !== "清空訂單") {
    redirect("/admin/orders?cleared=badconfirm");
  }
  const all = db.prepare("SELECT items,status FROM orders").all() as { items: string; status: string }[];
  const tx = db.transaction(() => {
    for (const o of all) restoreStockOf(o.items, o.status);
    db.prepare("DELETE FROM orders").run();
  });
  tx();
  revalidatePath("/admin/orders");
  redirect(`/admin/orders?cleared=${all.length}`);
}

/* ── 廚師 ── */

/* ── 贊助 ── */
/*
 * 後台調整贊助狀態。
 *
 * 改成「已取消」時一定要真的去金流商解約，不能只改本地狀態：
 * 綠界的定期定額委託在對方系統裡，本地標了 cancelled 而委託還在的話，
 * 客人每個月照樣被扣款，而且因為本地已不是 active，回呼進來也不會入帳，
 * 等於錢被扣走卻沒有任何紀錄。顧客自己用信裡連結取消（support/cancel）
 * 本來就有呼叫解約 API，後台這條卻沒有，兩邊行為不一致。
 *
 * 解約失敗時不改本地狀態，直接把錯誤顯示出來。寧可讓站長看到失敗、
 * 去金流後台手動處理，也不要留下「以為停了其實沒停」的假象。
 */
export async function updateSponsorship(formData: FormData) {
  await guard();
  const id = Number(formData.get("id")) || 0;
  const next = String(formData.get("status") || "active");
  const sp = db
    .prepare("SELECT id,mode,status,provider,trade_no,credit_token FROM sponsorships WHERE id=?")
    .get(id) as { id: number; mode: string; status: string; provider: string; trade_no: string; credit_token: string } | undefined;
  if (!sp) redirect("/admin/sponsors");

  let note = "";
  const needCancelUpstream = next === "cancelled" && sp.status === "active" && sp.mode === "monthly";
  if (needCancelUpstream) {
    if (sp.provider === "ecpay" && sp.trade_no) {
      const { cancelCreditPeriod } = await import("@/lib/ecpay");
      const r = await cancelCreditPeriod(sp.trade_no);
      if (!r.ok) redirect(`/admin/sponsors?cancel=${encodeURIComponent(`綠界解約失敗：${r.msg}`)}`);
      note = "後台取消（綠界已解約）";
    } else if ((sp.credit_token || "").startsWith("PORTALY:")) {
      const { cancelSubscription } = await import("@/lib/portaly");
      const ok = await cancelSubscription(sp.credit_token.slice(8));
      if (!ok) redirect(`/admin/sponsors?cancel=${encodeURIComponent("Portaly 取消訂閱失敗，請至 Portaly 後台處理")}`);
      note = "後台取消（Portaly 已申請停止，本期結束後不再扣款）";
    } else {
      /* PayUni 舊制與模擬模式：續扣排程只看本地狀態，改狀態即可停扣 */
      note = "後台取消";
    }
  }

  if (note) {
    db.prepare("UPDATE sponsorships SET status=?, last_charge_note=? WHERE id=?").run(next, note, id);
  } else {
    db.prepare("UPDATE sponsorships SET status=? WHERE id=?").run(next, id);
  }
  redirect(needCancelUpstream ? "/admin/sponsors?cancel=ok" : "/admin/sponsors");
}

/* 刪除單筆贊助紀錄（測試單）：連同它的續扣紀錄一起清掉 */
/*
 * 補開發票：付款成功但發票沒開成的贊助，手動重試（用全新訂單編號避免與先前衝突）。
 *
 * 每月定額要特別小心：它的發票號碼是記在「該期扣款」（sponsor_charges）上，
 * 不是記在訂閱本身。以前這裡只看 sponsorships.invoice_no，對定期定額永遠是空的，
 * 按一次就會對同一期再開一張重複發票。現在改成先找最新一期，已經有號碼就直接擋掉。
 */
export async function reissueSponsorInvoice(formData: FormData) {
  await guard();
  const id = Number(formData.get("id")) || 0;
  const sp = db.prepare("SELECT id,amount,mode,status,invoice_no FROM sponsorships WHERE id=?").get(id) as
    | { id: number; amount: number; mode: string; status: string; invoice_no: string }
    | undefined;
  if (!sp || (sp.status !== "paid" && sp.status !== "active")) redirect("/admin/sponsors?inv=notpaid");

  const { invoiceForSponsorship } = await import("@/lib/amego");
  const stamp = `R${sp.id}T${Date.now().toString(36).toUpperCase()}`;

  if (sp.mode === "monthly") {
    const c = db
      .prepare("SELECT id,amount,invoice_no,note FROM sponsor_charges WHERE sponsorship_id=? ORDER BY id DESC LIMIT 1")
      .get(sp.id) as { id: number; amount: number; invoice_no: string; note: string } | undefined;
    if (!c) redirect("/admin/sponsors?inv=nocharge");
    if (c.invoice_no) redirect("/admin/sponsors?inv=already");
    await invoiceForSponsorship(sp.id, stamp, c.amount || sp.amount, c.id);
  } else {
    if (sp.invoice_no) redirect("/admin/sponsors?inv=already");
    await invoiceForSponsorship(sp.id, stamp, sp.amount);
  }
  revalidatePath("/admin/sponsors");
  redirect("/admin/sponsors?inv=done");
}

/*
 * 未完成付款提醒信：手動補寄給還卡在「待付款」的支持者。
 * 信裡帶一鍵回到付款頁的連結（用建立時就發的 pay_token 認證）。
 * 只對 pending 生效，寄出時間記在 remind_at，後台會顯示，避免重複打擾同一個人。
 */
export async function remindSponsorship(formData: FormData) {
  await guard();
  const id = Number(formData.get("id")) || 0;
  const t = loadSponsorTarget(id);
  if (!t || t.status !== "pending") redirect("/admin/sponsors?err=" + encodeURIComponent("這筆不是待付款"));
  const seq = Math.min(3, t!.remind_seq + 1);
  const r = await sendNotice(t!, `remind${seq}`, { force: true });
  countManualRemind("sponsor", id);
  const ok = Boolean(r.mail?.ok || r.line?.ok || r.sms?.ok);
  redirect(`/admin/sponsors?${ok ? "ok" : "err"}=${encodeURIComponent(ok ? `已提醒（第 ${seq} 次）` : `提醒沒送出：${r.mail?.why || r.line?.why || r.sms?.why || ""}`)}`);
}

/*
 * 訂單未完成付款提醒信：手動補寄給還卡在「待付款」的顧客。
 * 與贊助那支同一套規矩：只對 pending 生效、寄出計數，
 * 手動寄的也要計數，否則自動對帳會再多寄一封，總數就超過兩封了。
 */
/*
 * 訂單列表那顆「發付款提醒」：規則跟自動對帳一樣（信一定寄；LINE 有綁就推；沒推成功才發簡訊）。
 * 其他種類的通知、指定管道、自訂內容，都在訂單頁「通知客人」那一區（notifyOrderChannels）。
 */
export async function remindOrder(formData: FormData) {
  await guard();
  const id = Number(formData.get("id")) || 0;
  const t = loadOrderTarget(id);
  if (!t || t.status !== "pending") redirect("/admin/orders?remind=notpending");
  const { supersededBy } = await import("@/lib/remind");
  if (supersededBy(t!)) redirect("/admin/orders?remind=superseded");
  /* 手動也算一次、從現在重新計時（docs/notify-spec.md 第二章） */
  const seq = Math.min(3, t!.remind_seq + 1);
  const r = await sendNotice(t!, `remind${seq}`, { force: true });
  countManualRemind("order", id);
  const { notifySummary } = await import("@/lib/notify-order");
  const summary = notifySummary({ mail: r.mail && { ok: r.mail.ok, error: r.mail.why }, line: r.line && { ok: r.line.ok, error: r.line.why }, sms: r.sms && { ok: r.sms.ok, error: r.sms.why } });
  revalidatePath("/admin/orders");
  redirect(`/admin/orders?remind=${r.mail?.ok || r.line?.ok || r.sms?.ok ? "ok" : "fail"}&detail=${encodeURIComponent(summary)}`);
}

/*
 * 訂單頁「通知客人」：一種通知、任意管道組合、一顆按鈕。
 * 取代以前的重寄訂單信、推 LINE、簡訊頁單獨寄一則三條路。
 */
export async function notifyOrderChannels(formData: FormData) {
  await guard();
  const id = Number(formData.get("id")) || 0;
  const { loadOrderForNotify, notifyOrder, notifySummary, NOTIFY_KINDS } = await import("@/lib/notify-order");
  const o = loadOrderForNotify(id);
  if (!o) redirect("/admin/orders");
  const back = (q: string) => redirect(`/admin/orders/${id}?${q}#notify`);
  const kind = String(formData.get("kind") || "");
  if (!NOTIFY_KINDS.some((k) => k.key === kind)) back("err=" + encodeURIComponent("沒有這種通知"));
  const channels = {
    mail: String(formData.get("ch_mail") || "") === "1",
    sms: String(formData.get("ch_sms") || "") === "1",
    line: String(formData.get("ch_line") || "") === "1",
  };
  if (!channels.mail && !channels.sms && !channels.line) back("err=" + encodeURIComponent("至少勾一個管道"));
  const r = await notifyOrder(o!, kind as (typeof NOTIFY_KINDS)[number]["key"], channels, {
    subject: String(formData.get("subject") || ""),
    body: String(formData.get("body") || ""),
    url: String(formData.get("url") || ""),
  });
  const anyOk = Boolean(r.mail?.ok || r.sms?.ok || r.line?.ok);
  revalidatePath(`/admin/orders/${id}`);
  back(`${anyOk ? "notify" : "err"}=${encodeURIComponent(notifySummary(r))}`);
}

/*
 * 立即對帳一次：主動去問綠界／LINE Pay，每一筆「待付款」到底付了沒。
 * 真的付了就補開發票、寄感謝信、通知站長；確定沒付且逾時就標記失敗。
 * 平常每 15 分鐘自動跑一次，這顆按鈕只是讓你不用等。
 */
export async function reconcileNow() {
  await guard();
  const { reconcilePending } = await import("@/lib/reconcile");
  let msg = "";
  try {
    const r = await reconcilePending();
    msg = `檢查 ${r.checked} 筆・補正已付款 ${r.paid}・標記失敗 ${r.failed}・寄出提醒 ${r.reminded}`;
    if (r.notes.length) msg += "｜" + r.notes.slice(0, 6).join("；");
  } catch (e) {
    console.error("[reconcile] 手動對帳失敗", e);
    msg = `對帳失敗：${e instanceof Error ? e.message : "未知錯誤"}`;
  }
  revalidatePath("/admin/sponsors");
  redirect(`/admin/sponsors?recon=${encodeURIComponent(msg)}`);
}

export async function deleteSponsorship(formData: FormData) {
  await guard();
  const id = Number(formData.get("id"));
  if (id > 0) {
    db.prepare("DELETE FROM sponsor_charges WHERE sponsorship_id=?").run(id);
    db.prepare("DELETE FROM sponsorships WHERE id=?").run(id);
  }
  revalidatePath("/admin/sponsors");
  redirect("/admin/sponsors?deleted=1");
}

/* 一鍵清空全部贊助紀錄（含續扣紀錄）。需在框內打「清空贊助」二次確認。
   提醒：不會去 Portaly 取消進行中的訂閱，只清本地紀錄，正式營運後請先取消再刪 */
export async function clearAllSponsorships(formData: FormData) {
  await guard();
  if (String(formData.get("confirm") || "").trim() !== "清空贊助") {
    redirect("/admin/sponsors?cleared=badconfirm");
  }
  const n = (db.prepare("SELECT COUNT(*) AS n FROM sponsorships").get() as { n: number }).n;
  const tx = db.transaction(() => {
    db.prepare("DELETE FROM sponsor_charges").run();
    db.prepare("DELETE FROM sponsorships").run();
  });
  tx();
  revalidatePath("/admin/sponsors");
  redirect(`/admin/sponsors?cleared=${n}`);
}

/* ── 影片 ── */
function extractYoutubeId(input: string): string {
  const s = input.trim();
  const m = s.match(/(?:youtube\.com\/(?:watch\?.*?v=|shorts\/|embed\/|live\/)|youtu\.be\/)([\w-]{6,20})/);
  if (m) return m[1];
  if (/^[\w-]{6,20}$/.test(s)) return s; /* 本來就是 ID */
  return "";
}


/* ── 顯示/隱藏：清單頁一鍵切換 ── */
export async function togglePublished(formData: FormData) {
  await guard();
  const table = String(formData.get("table")) as keyof typeof MOVABLE;
  if (!(table in MOVABLE)) redirect("/admin");
  const id = Number(formData.get("id"));
  db.prepare(`UPDATE ${table} SET published = 1 - published WHERE id=?`).run(id);
  await logAdmin("切換顯示", `${table}#${id}`);
  revalidatePath(table === "articles" ? "/articles" : table === "products" ? "/shop" : table === "episodes" ? "/ep" : "/guests");
  revalidatePath("/");
  redirect(MOVABLE[table]);
}

/* 文章列表上的文末 CTA 一鍵切換（支持商品／小額支持各自獨立） */
export async function toggleArticleCta(formData: FormData) {
  await guard();
  const id = Number(formData.get("id")) || 0;
  const which = String(formData.get("which")) === "support" ? "cta_support" : "cta_shop";
  const row = db.prepare("SELECT slug FROM articles WHERE id=?").get(id) as { slug: string } | undefined;
  if (!row) redirect("/admin/articles");
  db.prepare(`UPDATE articles SET ${which} = 1 - ${which} WHERE id=?`).run(id);
  revalidatePath(`/articles/${row!.slug}`);
  redirect("/admin/articles");
}

/* ── 排序：與相鄰項目交換序號 ── */
const MOVABLE = {
  articles: "/admin/articles",
  products: "/admin/products",
  episodes: "/admin/episodes",
  guests: "/admin/guests",
} as const;

export async function moveItem(formData: FormData) {
  await guard();
  const table = String(formData.get("table")) as keyof typeof MOVABLE;
  if (!(table in MOVABLE)) redirect("/admin");
  const id = Number(formData.get("id"));
  const dir = formData.get("dir") === "up" ? -1 : 1;

  const rows = db.prepare(`SELECT id FROM ${table} ORDER BY sort, id`).all() as { id: number }[];
  const idx = rows.findIndex((r) => r.id === id);
  const swapWith = rows[idx + dir];
  if (idx >= 0 && swapWith) {
    const tx = db.transaction(() => {
      /* 以位置重寫序號，交換兩者 */
      const upd = db.prepare(`UPDATE ${table} SET sort=? WHERE id=?`);
      rows.forEach((r, i) => {
        const pos = r.id === id ? i + dir : r.id === swapWith.id ? idx : i;
        upd.run(pos + 1, r.id);
      });
    });
    tx();
  }
  revalidatePath(table === "articles" ? "/articles" : table === "products" ? "/shop" : table === "episodes" ? "/ep" : "/guests");
  revalidatePath("/");
  redirect(MOVABLE[table]);
}

/* ── 折扣碼 ── */
export async function saveDiscount(formData: FormData) {
  await guard();
  const code = String(formData.get("code") || "").trim().toUpperCase();
  const name = String(formData.get("name") || "").trim();
  const expiresAt = String(formData.get("expires_at") || "").trim();
  const kind = ["percent", "amount", "freeship"].includes(String(formData.get("kind")))
    ? String(formData.get("kind"))
    : "percent";
  const value = Math.max(0, Number(formData.get("value")) || 0);
  if (!code || !/^[A-Z0-9-]{2,20}$/.test(code)) redirect("/admin/discounts?error=code");
  if (kind === "percent" && (value < 1 || value > 99)) redirect("/admin/discounts?error=percent");
  if (kind === "amount" && value < 1) redirect("/admin/discounts?error=amount");
  try {
    db.prepare("INSERT INTO discount_codes (code,name,kind,value,active,expires_at,created_at) VALUES (?,?,?,?,1,?,?)").run(
      code, name, kind, value, expiresAt, new Date().toISOString()
    );
  } catch {
    redirect("/admin/discounts?error=dup");
  }
  redirect("/admin/discounts");
}
export async function toggleDiscount(formData: FormData) {
  await guard();
  db.prepare("UPDATE discount_codes SET active = 1 - active WHERE id=?").run(Number(formData.get("id")));
  redirect("/admin/discounts");
}
export async function deleteDiscount(formData: FormData) {
  await guard();
  db.prepare("DELETE FROM discount_codes WHERE id=?").run(Number(formData.get("id")));
  redirect("/admin/discounts");
}

/* ── 投稿 ── */

/* ── 文案與信件 ── */
export async function saveCopy(formData: FormData) {
  await guard();
  const { COPY_KEYS } = await import("@/lib/copy");
  for (const key of COPY_KEYS) {
    const v = formData.get(`copy_${key}`);
    if (v !== null) setSetting(`copy_${key}`, String(v).trim());
  }
  await logAdmin("儲存文案");
  revalidatePath("/", "layout");
  redirect("/admin/settings/content?saved=1");
}

/* ── 設定 ── */
/*
 * 設定從一整頁拆成六頁之後（docs/admin-redesign/ia.md §2），這支 action 被六個表單共用，
 * 每一次送出只會帶其中一頁的欄位。所以每一個寫入前面都要先問 has()：
 * 這次的表單到底有沒有帶這個設定的來源欄位。沒帶就完全不碰。
 *
 * 不這樣做的後果不是「少存一格」，是「按下商店頁的儲存，通知頁的信箱、內容頁的條款
 * 全部被寫成空字串」，而且畫面上沒有任何跡象，要等到客人收不到信才會發現。
 * 對照表在 components/admin/settings-fields.ts，冒煙測試盯著同一份，兩邊不會各寫一套。
 */
export async function saveSettings(formData: FormData) {
  await guard();
  /* formData.keys() 是一次性的迭代器，先攤成 Set，後面每個判斷都用同一份 */
  const present = new Set<string>([...formData.keys()]);
  const has = (key: string) => carriesField(present, key);

  if (has("sponsor_tiers")) {
    const tiers = [1, 2, 3, 4]
      .map((i) => Number(formData.get(`tier_${i}`)))
      .filter((n) => n > 0)
      .sort((a, b) => a - b);
    if (tiers.length === 4) setSetting("sponsor_tiers", JSON.stringify(tiers));
  }
  if (has("addon_tiers")) {
    const addons = [1, 2, 3, 4]
      .map((i) => Number(formData.get(`addon_${i}`)))
      .filter((n) => n > 0)
      .sort((a, b) => a - b);
    if (addons.length === 4) setSetting("addon_tiers", JSON.stringify(addons));
  }
  if (has("sponsor_lead")) setSetting("sponsor_lead", String(formData.get("sponsor_lead") || ""));
  if (has("free_ship_threshold")) setSetting("free_ship_threshold", String(Number(formData.get("free_ship_threshold")) || 1500));
  if (has("ship_fee")) setSetting("ship_fee", String(Number(formData.get("ship_fee")) || 120));
  if (has("ship_fee_cvs")) setSetting("ship_fee_cvs", String(Number(formData.get("ship_fee_cvs")) || 65));
  /* 四格費率表（溫層×取貨方式）：收費／成本／免運門檻三組 */
  for (const pre of ["rate_charge", "rate_cost", "rate_free"]) {
    for (const k of ["ambient_home", "ambient_cvs", "cold_home", "cold_cvs"]) {
      const key = `${pre}_${k}`;
      if (!has(key)) continue;
      const v = Number(formData.get(key));
      if (Number.isFinite(v) && v >= 0) setSetting(key, String(Math.floor(v)));
    }
  }
  if (has("cold_enabled")) setSetting("cold_enabled", on(formData, "cold_enabled") ? "1" : "0");
  if (has("notify_all_products")) setSetting("notify_all_products", on(formData, "notify_all_products") ? "1" : "0");
  if (has("cvs_brand_own")) setSetting("cvs_brand_own", normalizeBrand(formData.get("cvs_brand_own")));
  if (has("freight_mode")) setSetting("freight_mode", String(formData.get("freight_mode")) === "flat" ? "flat" : "origin");
  if (has("partner_late_days")) setSetting("partner_late_days", String(Math.max(0, Number(formData.get("partner_late_days")) || 0)));
  /* setCheckbox 自己就會在「這次沒送這個欄位」時原封不動退出，不用再包一層 */
  setCheckbox(formData, "shop_enabled");
  setCheckbox(formData, "addon_enabled");
  setCheckbox(formData, "nav_support_home");
  setCheckbox(formData, "nav_support_shop");
  setCheckbox(formData, "home_support_section");
  setCheckbox(formData, "footer_business_model");
  setCheckbox(formData, "article_shop_cta");
  /* 只收站內路徑；外部網址存進來會變成從自己站上導出去的開放轉址 */
  if (has("article_shop_href")) {
    const artHref = String(formData.get("article_shop_href") || "").trim();
    setSetting("article_shop_href", artHref.startsWith("/") ? artHref : "/shop");
  }
  if (has("support_mode")) {
    const supMode = String(formData.get("support_mode") || "api");
    setSetting("support_mode", ["api", "hybrid", "link", "off"].includes(supMode) ? supMode : "api");
    setSetting("support_enabled", supMode === "off" ? "0" : "1"); /* 保留舊鍵相容 */
  }
  if (has("support_url")) setSetting("support_url", String(formData.get("support_url") || "").trim());
  if (has("monthly_gateway")) {
    const mg = String(formData.get("monthly_gateway") || "portaly");
    setSetting("monthly_gateway", mg === "newebpay" ? "newebpay" : "portaly");
  }
  /* 節目連結與主持人（問爽的）：網址欄只收 http(s)，其餘文字照存 */
  const urlOrEmpty = (v: FormDataEntryValue | null) => { const t = String(v || "").trim(); return /^https?:\/\//i.test(t) ? t : ""; };
  if (has("podcast_rss_url")) { const v = urlOrEmpty(formData.get("podcast_rss_url")); if (v) setSetting("podcast_rss_url", v); }
  for (const k of ["platform_apple", "platform_spotify", "platform_kkbox", "platform_youtube", "platform_soundon"]) {
    if (has(k)) setSetting(k, urlOrEmpty(formData.get(k)));
  }
  for (const n of [1, 2]) {
    for (const f of ["name", "title", "intro", "photo"]) {
      const k = `host_${n}_${f}`;
      if (has(k)) setSetting(k, String(formData.get(k) || "").trim().slice(0, f === "intro" ? 600 : 120));
    }
    if (has(`host_${n}_link`)) setSetting(`host_${n}_link`, urlOrEmpty(formData.get(`host_${n}_link`)));
  }
  setCheckbox(formData, "newsletter_block");
  if (has("notify_emails")) setSetting("notify_emails", getMulti(formData, "notify_emails").join(","));
  if (has("owner_notify_emails")) setSetting("owner_notify_emails", getMulti(formData, "owner_notify_emails").join(","));
  if (has("ecpay_atm_bank")) {
    const { ECPAY_ATM_BANKS } = await import("@/lib/ecpay");
    const v = String(formData.get("ecpay_atm_bank") || "");
    setSetting("ecpay_atm_bank", ECPAY_ATM_BANKS.some((b) => b.key === v) ? v : "");
  }
  setCheckbox(formData, "ecpay_atm_backstage");
  if (has("newebpay_atm_bank")) {
    const { NEWEBPAY_ATM_BANKS } = await import("@/lib/newebpay");
    const v = String(formData.get("newebpay_atm_bank") || "");
    setSetting("newebpay_atm_bank", NEWEBPAY_ATM_BANKS.some((b) => b.key === v) ? v : "");
  }
  setCheckbox(formData, "applepay_onsite");
  setCheckbox(formData, "notify_pause");
  setCheckbox(formData, "notify_dry_run");
  /* 信件副本：信箱一格＋四個種類開關（lib/mail-log.ts copyPlan 讀） */
  if (has("mail_copy_to")) {
    const v = String(formData.get("mail_copy_to") || "").trim();
    /* 留空＝關掉；填了但格式不對就維持原值，不要默默把副本關掉 */
    if (!v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) setSetting("mail_copy_to", v);
  }
  for (const k of ["mail_copy_manual", "mail_copy_remind", "mail_copy_routine", "mail_copy_owner"]) setCheckbox(formData, k);
  setCheckbox(formData, "line_notify_on");
  setCheckbox(formData, "line_collect_email");
  /* LINE：方案額度（站長升級後自己改）與測試白名單（有值＝測試模式，只推給名單內的人） */
  if (has("line_quota_monthly")) setSetting("line_quota_monthly", String(Math.max(0, Number(formData.get("line_quota_monthly")) || 0)));
  if (has("line_test_user_ids")) setSetting("line_test_user_ids", getMulti(formData, "line_test_user_ids").filter((s) => /^U[0-9a-f]{32}$/i.test(s)).join(","));
  /* 商店金流閘道（PayUni ⇄ TapPay＋光貿） */
  if (has("shop_gateway")) {
    const gw = String(formData.get("shop_gateway") || "payuni");
    setSetting("shop_gateway", gw === "tappay" ? "tappay" : gw === "ecpay" ? "ecpay" : gw === "newebpay" ? "newebpay" : "payuni");
  }
  /*
   * 付款方式開關：沒勾＝停用，存代號陣列。商店與贊助各存一份（站長指示 2026-08-31），
   * 舊的 pay_methods_off 同步寫入商店那一份的內容，讓還沒讀新鍵的地方行為不變。
   *
   * 這一區整個包在 has() 裡：沒勾的 checkbox 完全不會送出，所以「全部沒勾」與
   * 「這一頁根本沒有付款方式那一區」送上來的東西一模一樣。靠同區的隱藏標記 pm_form
   * 分辨兩者，沒有標記就一格都不動——不然在通知頁按一次儲存，付款方式會全部關掉。
   */
  let linepayMsg = "";
  if (has("pay_methods_off_shop")) {
    const PM_KEYS = ["credit", "linepay", "applepay", "samsungpay", "atm", "twqr"];
    const paysOffShop = PM_KEYS.filter((k) => !formData.get(`pm_shop_${k}`));
    const paysOffSupport = PM_KEYS.filter((k) => !formData.get(`pm_support_${k}`));
    /*
     * LINE Pay 只有一個地方管：就是這兩排開關。系統自動暫停也是寫同一份清單，所以畫面永遠反映現況。
     * 但把它勾回來的當下要先探測金鑰：金鑰還是錯的就不准開（維持關閉並在頁首說明），
     * 不然下一位客人又撞 1104、系統再自動關，開關就跟自動暫停打架。
     */
    const { payMethodsOff } = await import("@/lib/shop");
    const turningOn = (!paysOffShop.includes("linepay") && payMethodsOff("shop").includes("linepay")) ||
      (!paysOffSupport.includes("linepay") && payMethodsOff("support").includes("linepay"));
    if (turningOn) {
      const { linepayProbe } = await import("@/lib/linepay");
      const r = await linepayProbe();
      if (!r.ok) {
        linepayMsg = `${r.code} ${r.message}`.trim().slice(0, 120);
        if (!paysOffShop.includes("linepay")) paysOffShop.push("linepay");
        if (!paysOffSupport.includes("linepay")) paysOffSupport.push("linepay");
      } else {
        setSetting("linepay_last_error", "");
      }
    }
    setSetting("pay_methods_off_shop", JSON.stringify(paysOffShop));
    setSetting("pay_methods_off_support", JSON.stringify(paysOffSupport));
    setSetting("pay_methods_off", JSON.stringify(paysOffShop));
  }
  if (has("product_categories")) {
    const cats = getMulti(formData, "product_categories");
    if (cats.length > 0) setSetting("product_categories", cats.join(","));
  }
  if (has("home_who_img")) setSetting("home_who_img", String(formData.get("home_who_img") || ""));
  for (let i = 1; i <= 5; i++) {
    if (has(`pillar_img_${i}`)) setSetting(`pillar_img_${i}`, String(formData.get(`pillar_img_${i}`) || ""));
  }
  if (has("social_fb")) setSetting("social_fb", String(formData.get("social_fb") || "").trim());
  if (has("social_ig")) setSetting("social_ig", String(formData.get("social_ig") || "").trim());
  if (has("social_yt")) setSetting("social_yt", String(formData.get("social_yt") || "").trim());
  if (has("privacy_md")) setSetting("privacy_md", String(formData.get("privacy_md") || ""));
  if (has("terms_md")) setSetting("terms_md", String(formData.get("terms_md") || ""));
  if (has("returns_md")) setSetting("returns_md", String(formData.get("returns_md") || ""));

  /*
   * 文案信件（copy_*）併進設定·內容、通知文案（ncopy_*）併進設定·通知，
   * 所以這兩批也由同一顆儲存收下。規則跟原本 saveCopy／saveNotifyCopy 一模一樣：
   * 表單裡沒有那一格就不動它（清空欄位＝回復預設，那是「有送但空字串」）。
   */
  const { COPY_KEYS } = await import("@/lib/copy");
  for (const key of COPY_KEYS) {
    const v = formData.get(`copy_${key}`);
    if (v !== null) setSetting(`copy_${key}`, String(v).trim());
  }
  const { COPY_EVENTS } = await import("@/lib/notify-copy");
  for (const ev of COPY_EVENTS) {
    for (const f of ["subject", "p1", "btn", "btn2", "line", "sms"]) {
      const v = formData.get(`ncopy_${ev.key}_${f}`);
      if (v !== null) setSetting(`ncopy_${ev.key}_${f}`, String(v).trim());
    }
  }

  revalidatePath("/", "layout");
  /* 存完回原來那一頁。網址由表單自己帶（_back），但只認設定底下那七條，其他一律回目錄頁 */
  const dest = settingsBack(formData.get("_back"));
  await logAdmin("儲存設定", dest);
  redirect(linepayMsg ? `${dest}?saved=1&linepay=${encodeURIComponent(linepayMsg)}` : `${dest}?saved=1`);
}

export async function toggleProductNotify(formData: FormData) {
  await guard();
  const id = Number(formData.get("id")) || 0;
  if (id > 0) db.prepare("UPDATE products SET notify = 1 - notify WHERE id=?").run(id);
  revalidatePath("/admin/products");
}

/* 寄一封測試信到「訂單通知信箱」，確認主機寄信功能正常。
   以目前輸入框的內容為準，並順手存起來（避免測試後欄位被重整清空） */
export async function sendTestNotifyMail(formData: FormData) {
  await guard();
  /*
   * 信箱欄位在設定·商店那一頁，這顆鈕在設定·系統，所以表單通常不會帶 notify_emails。
   * 沒帶就用存好的那份寄，絕對不能照舊無條件 setSetting——那會把信箱清成空字串，
   * 之後所有訂單通知都寄不出去，而且畫面上看不出來。
   */
  const emails = formData.has("notify_emails")
    ? getMulti(formData, "notify_emails").filter((s) => s.includes("@"))
    : getSetting("notify_emails", "").split(",").map((t) => t.trim()).filter((s) => s.includes("@"));
  if (formData.has("notify_emails")) setSetting("notify_emails", emails.join(","));
  if (emails.length === 0) redirect("/admin/settings/system?mailtest=noemail");
  const html = wrapOwnerMail("寄信測試", `<p style="font-size:15px;line-height:2;">這是一封測試信。看到它代表網站的寄信功能正常，商品訂購通知會寄到這個信箱。</p>`);
  let ok = true;
  for (const to of emails) {
    const sent = await sendMail(to, "寄信測試｜問爽的後台", html, undefined, { kind: "test" });
    if (!sent) ok = false;
  }
  redirect(`/admin/settings/system?mailtest=${ok ? "ok" : "fail"}`);
}

/*
 * 一次寄出全部交易信範本（訂單確認、出貨、贊助感謝、扣款、未完成付款提醒），
 * 用來檢查改過的信件版型實際長什麼樣子。
 *
 * 本來是 /api/admin/test-mails?to=… 這支 GET。後台 cookie 是 SameSite=Lax，
 * 網址列的跳轉會照樣帶上，所以站長只要在別的網站點到一條做好的連結，
 * 我們的 SMTP 就替對方朝任意信箱送出 7 封信（寄件人是本站，退信與黑名單也算在本站頭上）。
 * 改成 server action 之後只吃 POST，跨站送不出來，收件信箱也照 checkEmail 擋掉手誤。
 */
export async function sendTemplateTestMails(formData: FormData) {
  await guard();
  if (!mailEnabled()) redirect(`/admin/settings/system?tmplmail=${encodeURIComponent("SMTP 未設定，寄不出去")}`);
  const to = String(formData.get("tmpl_test_to") || "").trim() || String(process.env.SMTP_USER || "");
  const bad = checkEmail(to);
  if (bad) redirect(`/admin/settings/system?tmplmail=${encodeURIComponent(bad)}`);

  const fakeOrder = {
    order_no: "YD2607070099",
    name: "測試買家",
    email: to,
    address: "台中市西區測試路 1 號 5 樓",
    items: JSON.stringify([
      { name: "問爽的節目T恤", choice: "M", price: 780, qty: 1 },
      { name: "問爽的貼紙組", choice: null, price: 220, qty: 2 },
    ]),
    subtotal: 1220,
    shipping: 120,
    total: 1340,
    /* 範本裡放捐贈發票：這是站長選的「三層告知」第二層，
       要能在後台的測試信裡看到實際長什麼樣子 */
    invoice_type: "b2c",
    invoice_data: JSON.stringify({ npoban: "8585", npobanName: "財團法人台灣兒童暨家庭扶助基金會" }),
  };

  await sendOrderPaidMail(fakeOrder);
  await sendOrderShippedMail(fakeOrder);
  await sendSponsorThanksMail({ id: 0, mode: "once", amount: 1000, display_name: "測試支持者", email: to });
  await sendSponsorThanksMail({ id: 0, mode: "monthly", amount: 888, display_name: "測試支持者", email: to });
  await sendSponsorChargedMail({ id: 0, amount: 888, display_name: "測試支持者", email: to });
  /* 範本預覽用：pay_token 是假的，按下按鈕會回到贊助頁而不是付款頁 */
  await sendSponsorResumeMail({
    id: 0, mode: "once", amount: 1000, display_name: "測試支持者", email: to,
    provider: "ecpay", pay_method: "信用卡", pay_token: "TESTTOKEN",
    atm_bank: "", atm_vaccount: "", atm_expire: "",
  });
  await sendSponsorResumeMail({
    id: 0, mode: "once", amount: 1000, display_name: "測試支持者", email: to,
    provider: "ecpay", pay_method: "ATM 轉帳", pay_token: "TESTTOKEN",
    atm_bank: "812", atm_vaccount: "9103522104618327", atm_expire: "2026/08/05",
  });
  redirect(`/admin/settings/system?tmplmail=${encodeURIComponent(`ok:${to}`)}`);
}

/* 寄一封測試信到「站長通知信箱」（投稿等商品以外的通知），同樣以目前輸入框內容為準並順手存起來 */
/* 手動立即備份：不管資料有沒有變都寄一份（force），用來驗證備份機制正常 */
/* 重新產生商店預覽金鑰：撤銷所有已發出的審查連結與已種的 cookie */
export async function regenShopPreviewKey() {
  await guard();
  const crypto = await import("crypto");
  setSetting("shop_preview_key", crypto.randomBytes(12).toString("base64url"));
  revalidatePath("/admin/settings/system");
  redirect("/admin/settings/system");
}

/*
 * 改訂單品項的出貨週（顧客來訊「我要改週」時用）。
 * 這裡是唯一正路：手動註記會讓夥伴手上的資料比系統準，統計就沒人信了。
 * 庫存跟著搬：舊週加回一格、新週扣掉一格（只動有設定分週庫存的鍵）。
 * 新週已額滿也放行——站長自己決定要不要塞，畫面上會先講。
 */
/*
 * 改品項數量（站長 2026-09-05：企業單 40 盒改 42，錢另請款）。
 * 差額直接對規格庫存與總庫存加減，允許扣成負數（站長明說夥伴願意多做），
 * 備註寫進付款備註，訂單頁看得到「其中 N 盒另請款」。
 */
export async function updateOrderItemQty(formData: FormData) {
  await guard();
  const id = Number(formData.get("id")) || 0;
  const idx = Number(formData.get("item_idx"));
  const newQty = Math.floor(Number(formData.get("new_qty")) || 0);
  const note = String(formData.get("qty_note") || "").trim().slice(0, 120);
  const o = db.prepare("SELECT id,items,status,pay_note FROM orders WHERE id=?").get(id) as { id: number; items: string; status: string; pay_note: string } | undefined;
  if (!o || o.status === "cancelled" || !Number.isInteger(idx) || newQty < 1 || newQty > 999) redirect(`/admin/orders/${id || ""}`);
  let items: { id: number; name: string; choice: string | null; price: number; qty: number }[] = [];
  try { items = JSON.parse(o!.items || "[]"); } catch { items = []; }
  const it = items[idx];
  if (!it || it.qty === newQty) redirect(`/admin/orders/${id}`);
  const diff = newQty - it.qty;
  db.transaction(() => {
    if (it.id > 0) {
      if (diff > 0) deductChoiceStocks(JSON.stringify([{ ...it, qty: diff }]));
      else restoreChoiceStocks(JSON.stringify([{ ...it, qty: -diff }]));
      db.prepare("UPDATE products SET stock=stock-? WHERE id=?").run(diff, it.id);
    }
    items[idx] = { ...it, qty: newQty };
    const stamp = new Date().toISOString().slice(0, 10);
    const line = `${stamp} 站長把「${it.name}」${it.qty} 改為 ${newQty}${note ? `：${note}` : ""}`;
    db.prepare("UPDATE orders SET items=?, pay_note=? WHERE id=?").run(JSON.stringify(items), [o!.pay_note || "", line].filter(Boolean).join("\n"), id);
  })();
  revalidatePath(`/admin/orders/${id}`);
  redirect(`/admin/orders/${id}?saved=qty`);
}

export async function updateOrderItemChoice(formData: FormData) {
  await guard();
  const id = Number(formData.get("id")) || 0;
  const idx = Number(formData.get("item_idx"));
  const newChoice = String(formData.get("new_choice") || "").trim();
  const o = db.prepare("SELECT id,items,status,pay_note FROM orders WHERE id=?").get(id) as
    | { id: number; items: string; status: string; pay_note: string }
    | undefined;
  if (!o || o.status === "cancelled" || !newChoice || !Number.isInteger(idx)) redirect(`/admin/orders/${id || ""}`);

  let items: { id: number; name: string; choice: string | null; price: number; qty: number }[] = [];
  try { items = JSON.parse(o.items || "[]"); } catch { items = []; }
  const it = items[idx];
  if (!it || it.choice === newChoice) redirect(`/admin/orders/${id}`);
  const oldChoice = it.choice || "";

  /*
   * 分週庫存搬移：只動 choice_stocks 裡存在的鍵（沒設定＝不限量，不用搬）。
   *
   * 一定要先檢查目標那一週還有沒有位子。原本是無條件相減，把訂單搬到已經額滿的
   * 那一週就會扣成負數：不會超賣（下單時 -2 < 1 一樣擋得住），
   * 但夥伴工作台的「剩餘可賣」會顯示負數，你在後台看到 -2、顧客看到的是「已滿」，
   * 兩邊對不起來，而且「剛好額滿」的判斷也跟著失真。
   *
   * 搬移與訂單內容包在同一個交易裡：庫存搬了、訂單沒改，就是永久對不起來的帳。
   */
  const prod = db.prepare("SELECT choice_stocks FROM products WHERE id=?").get(it.id) as { choice_stocks: string } | undefined;
  let map: Record<string, number> = {};
  if (prod) {
    try { map = JSON.parse(prod.choice_stocks || "{}"); } catch { map = {}; }
    const limited = Object.prototype.hasOwnProperty.call(map, newChoice);
    if (limited && map[newChoice] < it.qty) {
      /* 位子不夠就整筆不動，把原因帶回頁面上，不要默默扣成負數 */
      redirect(`/admin/orders/${id}?nostock=${encodeURIComponent(`${newChoice}｜剩 ${map[newChoice]}，需要 ${it.qty}`)}`);
    }
  }

  it.choice = newChoice;
  const stamp = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(5, 16).replace("T", " ");
  db.transaction(() => {
    if (prod) {
      if (Object.prototype.hasOwnProperty.call(map, oldChoice)) map[oldChoice] += it.qty;
      if (Object.prototype.hasOwnProperty.call(map, newChoice)) map[newChoice] -= it.qty;
      db.prepare("UPDATE products SET choice_stocks=? WHERE id=?").run(JSON.stringify(map), it.id);
    }
    db.prepare("UPDATE orders SET items=?, pay_note=trim(COALESCE(pay_note,'') || ' ' || ?) WHERE id=?")
      .run(JSON.stringify(items), `（${stamp} 出貨週調整：${oldChoice || "無"} → ${newChoice}）`, id);
  })();
  redirect(`/admin/orders/${id}?saved=1`);
}

/* ── 出貨夥伴管理（多夥伴版）：一人一把金鑰。重生成只失效那一位，別人不受影響 ── */
export async function createPartner(formData: FormData) {
  await guard();
  const name = String(formData.get("name") || "").trim();
  if (!name) redirect("/admin/partners?err=" + encodeURIComponent("夥伴名稱不能空白"));
  const crypto = await import("crypto");
  db.prepare("INSERT INTO partners (name,key,pin,notify_emails,ship_origin,cvs_brand,active,created_at) VALUES (?,?,?,?,?,?,1,?)").run(
    name,
    crypto.randomBytes(12).toString("base64url"),
    String(formData.get("pin") || "").trim() || String(Math.floor(1000 + Math.random() * 9000)),
    getEmails(formData, "notify_emails"),
    String(formData.get("ship_origin") || "").trim(),
    normalizeBrand(formData.get("cvs_brand")),
    new Date().toISOString()
  );
  revalidatePath("/admin/partners");
  redirect("/admin/partners");
}

export async function updatePartner(formData: FormData) {
  await guard();
  const id = Number(formData.get("id")) || 0;
  db.prepare("UPDATE partners SET name=?, pin=?, notify_emails=?, ship_origin=?, cvs_brand=? WHERE id=?").run(
    String(formData.get("name") || "").trim() || "未命名",
    String(formData.get("pin") || "").trim() || "0000",
    getEmails(formData, "notify_emails"),
    String(formData.get("ship_origin") || "").trim(),
    normalizeBrand(formData.get("cvs_brand")),
    id
  );
  revalidatePath("/admin/partners");
  redirect("/admin/partners");
}

export async function regenPartnerKey(formData: FormData) {
  await guard();
  const id = Number(formData.get("id")) || 0;
  const crypto = await import("crypto");
  db.prepare("UPDATE partners SET key=? WHERE id=?").run(crypto.randomBytes(12).toString("base64url"), id);
  revalidatePath("/admin/partners");
  redirect("/admin/partners");
}

export async function togglePartnerActive(formData: FormData) {
  await guard();
  const id = Number(formData.get("id")) || 0;
  db.prepare("UPDATE partners SET active = 1 - active WHERE id=?").run(id);
  revalidatePath("/admin/partners");
  redirect("/admin/partners");
}

/* 重新產生支持方案說明頁金鑰：撤銷所有已發出的說明頁連結與對方裝置上的權限 */
export async function regenPlanPreviewKey() {
  await guard();
  const crypto = await import("crypto");
  setSetting("plan_preview_key", crypto.randomBytes(12).toString("base64url"));
  revalidatePath("/admin/settings/system");
  redirect("/admin/settings/system");
}

export async function runBackupNow() {
  await guard();
  const { runBackup, clearBackupFailure } = await import("@/lib/backup");
  const r = await runBackup({ force: true });
  /* 手動補寄成功就把自動備份的失敗紀錄清掉，後台那則紅字才不會一直留著 */
  if (r.ok) clearBackupFailure();
  const msg = r.ok
    ? `ok:${encodeURIComponent(`${r.filename}（${Math.round((r.bytes || 0) / 1024).toLocaleString()} KB${r.mode === "db-only" ? "，僅資料庫" : "，含圖片"}）`)}`
    : `err:${encodeURIComponent((r.msg || "失敗").slice(0, 120))}`;
  redirect(`/admin/settings/system?backup=${msg}`);
}

/* 送一筆 GA 測試轉換：驗證 GA_API_SECRET 是否正確，
   同時讓 sponsor_complete／purchase 這兩個事件名出現在 GA 清單裡（才能標成重要事件）。
   金額一律 0，不會污染營收數字，並帶 test=1 供日後辨識。 */
/* LINE Pay：先探測金鑰，通了就把商店與贊助兩邊的 LINE Pay 一起勾回來 */
/* 探測正式特店能不能用綠界幕後取號（真的取一組 100 元、1 天到期的虛擬帳號，沒人繳就作廢） */
export async function ecpayGenPayProbeAction() {
  await guard();
  const { ecpayGenPayProbe } = await import("@/lib/ecpay-genpay");
  const r = await ecpayGenPayProbe();
  redirect(`/admin/settings/system?genpay=${r.ok ? "ok" : "fail"}`);
}

export async function linepayProbeAndEnable() {
  await guard();
  const { linepayProbe } = await import("@/lib/linepay");
  const { setPayMethodOff } = await import("@/lib/pay-off");
  const r = await linepayProbe();
  if (!r.ok) redirect(`/admin/settings/system?linepay=${encodeURIComponent(`${r.code} ${r.message}`.trim().slice(0, 120))}`);
  setPayMethodOff("linepay", "shop", false);
  setPayMethodOff("linepay", "support", false);
  setSetting("linepay_last_error", "");
  revalidatePath("/cart");
  revalidatePath("/support");
  redirect("/admin/settings/system?linepay=ok");
}

export async function sendGaTestEvent() {
  await guard();
  const a = await gaTestEvent("sponsor_complete", { mode: "test", value: 0, currency: "TWD", test: "1" });
  const b = await gaTestEvent("purchase", { transaction_id: `TEST-${Date.now()}`, value: 0, currency: "TWD", test: "1", items: [] });
  const ok = a.ok && b.ok;
  redirect(`/admin/settings/system?gatest=${ok ? "ok" : encodeURIComponent((a.ok ? b.msg : a.msg).slice(0, 120))}`);
}

export async function sendTestOwnerMail(formData: FormData) {
  await guard();
  /* 同 sendTestNotifyMail：表單沒帶這格就用存好的，不要把站長信箱清掉 */
  const emails = formData.has("owner_notify_emails")
    ? getMulti(formData, "owner_notify_emails").filter((s) => s.includes("@"))
    : getSetting("owner_notify_emails", "").split(",").map((t) => t.trim()).filter((s) => s.includes("@"));
  if (formData.has("owner_notify_emails")) setSetting("owner_notify_emails", emails.join(","));
  if (emails.length === 0) redirect("/admin/settings/system?mailtest=noemail");
  const html = wrapOwnerMail("寄信測試", `<p style="font-size:15px;line-height:2;">這是一封測試信。看到它代表網站的寄信功能正常，有人投稿等通知會寄到這個信箱。</p>`);
  let ok = true;
  for (const to of emails) {
    const sent = await sendMail(to, "寄信測試｜問爽的後台", html, undefined, { kind: "test" });
    if (!sent) ok = false;
  }
  redirect(`/admin/settings/system?mailtest=${ok ? "ok" : "fail"}`);
}

/*
 * 到財政部重抓一份捐贈碼清單。
 *
 * 為什麼是「按鈕」而不是排程：清單一個月才動一次，而它動的時候我們不會知道。
 * 排程一旦靜靜地失敗（對方改網址、改格式），症狀是「新成立的公益團體客人捐不了」，
 * 那種症狀沒有人會回報。做成按鈕，站長按下去當場就看到成功幾筆、或失敗的原因。
 *
 * 抓失敗、解析不出來、或筆數少於現有的一半，都保留舊清單（見 lib/npoban.ts）。
 */
/* ── 簡訊 ── */

export async function saveSmsSettings(formData: FormData) {
  await guard();
  setSetting("sms_brand", String(formData.get("sms_brand") || "").trim() || "問爽的");
  setSetting("sms_whitelist_ok", on(formData, "sms_whitelist_ok") ? "1" : "0");
  setSetting("sms_signature", String(formData.get("sms_signature") || "").trim());
  /* 模板留空就存空字串，smsTemplate() 會退回預設文案——
     這樣站長清空欄位等於「還原預設」，不用另外做一顆還原按鈕 */
  setSetting("sms_tpl_pending", String(formData.get("sms_tpl_pending") || "").trim());
  setSetting("sms_tpl_pending2", String(formData.get("sms_tpl_pending2") || "").trim());
  setSetting("sms_tpl_pending3", String(formData.get("sms_tpl_pending3") || "").trim());
  setSetting("sms_tpl_failed", String(formData.get("sms_tpl_failed") || "").trim());
  redirect("/admin/sms?ok=" + encodeURIComponent("設定已儲存"));
}

export async function sendManualSms(formData: FormData) {
  await guard();
  const { sendSms } = await import("@/lib/sms");
  const r = await sendSms({
    phone: String(formData.get("phone") || ""),
    body: String(formData.get("body") || ""),
    url: String(formData.get("url") || "").trim(),
    kind: "manual",
  });
  redirect(`/admin/mail?${r.ok ? "ok" : "err"}=${encodeURIComponent(r.ok ? "簡訊已送出" : "簡訊：" + r.error)}`);
}

/*
 * 手寫簡訊要用的短網址：站長貼一條站內網址，換一條 30 字元的。
 *
 * 為什麼只收站內：短網址掛在自己的網域上，能縮站外就等於開一台公開轉址機，
 * 而這個網域是簡訊白名單送審過的那一個，賠掉就整套寄不出去（lib/short-link.ts）。
 * 管道記成 manual：跟系統自動發的那幾條分開算，站長才知道自己手寫那則有沒有人點。
 */
export async function makeShortLink(formData: FormData) {
  await guard();
  const { ensureShortLink, shortSiteUrl } = await import("@/lib/short-link");
  const raw = String(formData.get("url") || "").trim();
  let made = "", err = "";
  if (!raw) err = "短網址：要先貼一條網址";
  else {
    try { made = `${shortSiteUrl()}/l/${ensureShortLink(raw, "manual")}`; }
    catch (e) {
      console.error("[short] 後台手動縮網址失敗", raw.slice(0, 120), e);
      err = "短網址：只能縮本站的網址（貼 /api/orders/pay?... 這種路徑，或 www.wensong.tw 開頭的完整網址）";
    }
  }
  /* redirect 會丟例外，一定要留在 try 外面，否則會被上面的 catch 吃掉 */
  redirect(err ? `/admin/mail?tab=sms&err=${encodeURIComponent(err)}` : `/admin/mail?tab=sms&short=${encodeURIComponent(made)}`);
}

/* ── LINE 通知 ── */
export async function saveLineSettings(formData: FormData) {
  await guard();
  const { LINE_KINDS } = await import("@/lib/line");
  /* 模板留空＝還原預設，跟簡訊一樣 */
  for (const k of LINE_KINDS) setSetting(`line_tpl_${k.key}`, String(formData.get(`line_tpl_${k.key}`) || "").trim());
  redirect("/admin/line?ok=" + encodeURIComponent("模板已儲存"));
}

export async function sendManualLine(formData: FormData) {
  await guard();
  const { pushLine, findLineBinding, composeLine } = await import("@/lib/line");
  const target = String(formData.get("target") || "").trim();
  const body = String(formData.get("body") || "").trim();
  const url = String(formData.get("url") || "").trim();
  if (!target || !body) redirect("/admin/mail?err=" + encodeURIComponent("LINE：對象與內容都要填"));
  let uid = "", orderNo = "";
  if (/^U[0-9a-f]{32}$/i.test(target)) uid = target;
  else {
    const o = db.prepare("SELECT order_no,phone,email FROM orders WHERE order_no=?").get(target.toUpperCase()) as { order_no: string; phone: string; email: string } | undefined;
    if (!o) redirect("/admin/mail?err=" + encodeURIComponent("LINE：找不到這張訂單"));
    const b = findLineBinding({ phone: o!.phone, email: o!.email });
    if (!b) redirect("/admin/mail?err=" + encodeURIComponent("LINE：這張訂單的客人沒有綁 LINE"));
    if (b!.status !== "bound") redirect("/admin/mail?err=" + encodeURIComponent(`LINE：這個人的狀態是「${b!.status}」，推不出去`));
    uid = b!.line_user_id; orderNo = o!.order_no;
  }
  const r = await pushLine({ lineUserId: uid, text: composeLine(body, url), kind: "manual", orderNo });
  redirect(`/admin/mail?${r.ok ? "ok" : "err"}=${encodeURIComponent(r.ok ? "LINE 已推送" : "LINE：" + (r.error || r.reason))}`);
}

/* 投稿採用：站長寄完載明稿費的採用信後，用 LINE 補一句「已採用，詳情看 Email」（金額不進 LINE） */

/* ── 訂閱名單匯入 ── */

export async function importSubscribers(formData: FormData) {
  await guard();
  const { importEmails } = await import("@/lib/subscriber-import");
  const raw = String(formData.get("emails") || "");
  const r = importEmails(raw, String(formData.get("source") || "manychat"));
  const msg = `新增 ${r.added}、已存在 ${r.existed}、退訂過所以跳過 ${r.skippedUnsub}` +
    (r.invalid.length ? `、格式有問題 ${r.invalid.length}（${r.invalid.slice(0, 3).join("、")}${r.invalid.length > 3 ? "…" : ""}）` : "");
  redirect(`/admin/newsletter?imported=${encodeURIComponent(msg)}`);
}

export async function saveSheetUrl(formData: FormData) {
  await guard();
  setSetting("manychat_sheet_url", String(formData.get("sheet_url") || "").trim());
  redirect(`/admin/newsletter?imported=${encodeURIComponent("試算表網址已儲存")}`);
}

export async function syncSheetNow() {
  await guard();
  /* 走跟排程同一個 runSheetSync：兩邊都會把結果寫進 settings，
     站長在匯入區看到的那一行才會「按過的」與「自動跑的」都算數 */
  const { runSheetSync } = await import("@/lib/subscriber-import");
  const r = await runSheetSync("manual");
  if (!r.ok) redirect(`/admin/newsletter?err=${encodeURIComponent(r.msg)}`);
  redirect(`/admin/newsletter?imported=${encodeURIComponent(`從試算表同步：${r.msg}`)}`);
}

/* ── 電子報 ── */

export async function saveNewsletter(formData: FormData) {
  await guard();
  const { default: db } = await import("@/lib/db");
  const id = Number(formData.get("id")) || 0;
  const d = {
    subject: String(formData.get("subject") || "").trim(),
    title: String(formData.get("title") || "").trim(),
    body: String(formData.get("body") || "").trim(),
    btn_text: String(formData.get("btn_text") || "").trim(),
    btn_url: String(formData.get("btn_url") || "").trim(),
  };
  if (!d.subject || !d.body) redirect(`/admin/newsletter/${id || "new"}?err=${encodeURIComponent("主旨與內文都要填")}`);
  if (id) {
    /* 已經開始寄的不准改內容：改了之後，前半段收到的人跟後半段收到的人
       會看到不一樣的信，而我們沒有辦法解釋那件事 */
    const cur = db.prepare("SELECT status FROM newsletters WHERE id=?").get(id) as { status: string } | undefined;
    if (cur && cur.status !== "draft")
      redirect(`/admin/newsletter/${id}?err=${encodeURIComponent("已開始寄送，不能再改內容")}`);
    db.prepare("UPDATE newsletters SET subject=@subject,title=@title,body=@body,btn_text=@btn_text,btn_url=@btn_url WHERE id=@id")
      .run({ ...d, id });
    redirect(`/admin/newsletter/${id}?saved=1`);
  }
  const r = db
    .prepare("INSERT INTO newsletters (subject,title,body,btn_text,btn_url,status,created_at) VALUES (@subject,@title,@body,@btn_text,@btn_url,'draft',@created_at)")
    .run({ ...d, created_at: new Date().toISOString() });
  redirect(`/admin/newsletter/${Number(r.lastInsertRowid)}?saved=1`);
}

export async function startNewsletterSend(formData: FormData) {
  await guard();
  const { startNewsletter } = await import("@/lib/newsletter");
  const id = Number(formData.get("id"));
  const r = startNewsletter(id);
  redirect(`/admin/newsletter/${id}?${r.ok ? "started" : "err"}=${encodeURIComponent(r.msg)}`);
}

export async function retryNewsletterFailed(formData: FormData) {
  await guard();
  const { retryFailed } = await import("@/lib/newsletter");
  const id = Number(formData.get("id"));
  const n = retryFailed(id);
  redirect(`/admin/newsletter/${id}?started=${encodeURIComponent(`已把 ${n} 封重新排入待寄`)}`);
}

/* 寄一封測試給站長自己：內容與版型跟正式寄出完全一樣，只有收件人不同 */
export async function sendNewsletterTest(formData: FormData) {
  await guard();
  const { getNewsletter, newsletterHtml } = await import("@/lib/newsletter");
  const { sendMail } = await import("@/lib/mail");
  const id = Number(formData.get("id"));
  const to = String(formData.get("test_to") || "").trim();
  const n = getNewsletter(id);
  if (!n || !to.includes("@")) redirect(`/admin/newsletter/${id}?err=${encodeURIComponent("請填一個測試收件信箱")}`);
  /* 測試信走 SMTP，沒有電子豹的變數代入：退訂連結指到站上的退訂入口，看得到位置與樣子就好 */
  const ok = await sendMail(to, `［測試］${n!.subject}`, newsletterHtml(n!, `${(process.env.SITE_URL || "https://www.wensong.tw").replace(/\/$/, "")}/unsubscribe`), undefined, { kind: "test" });
  redirect(`/admin/newsletter/${id}?${ok ? "started" : "err"}=${encodeURIComponent(ok ? `測試信已寄到 ${to}` : "測試信寄送失敗")}`);
}

export async function refreshNpobanList() {
  await guard();
  const { refreshNpoban } = await import("@/lib/npoban");
  const r = await refreshNpoban();
  redirect(`/admin/settings/system?npoban=${encodeURIComponent(r.msg)}`);
}


/*
 * 儲存多地址配送的收件名單。
 *
 * 保留出貨狀態是這支的重點：站長很可能先存了名單、出了三位，
 * 然後對方才補上第四位的地址。重存的時候若把整份覆蓋掉，
 * 那三位的「已出貨」就消失了，工作台會叫人再寄一次。
 * 所以用「姓名＋電話＋地址」當同一個人的識別，把舊的 shipped 旗標接回去。
 */
export async function saveOrderShipList(formData: FormData) {
  await guard();
  const id = Number(formData.get("id"));
  if (!id) redirect("/admin/orders");

  const { isMultiShip } = await import("@/lib/multi-ship");
  type Recip = import("@/lib/multi-ship").ShipRecipient;

  const row = db.prepare("SELECT ship_method, ship_list FROM orders WHERE id=?").get(id) as
    | { ship_method: string; ship_list: string }
    | undefined;
  if (!row) redirect("/admin/orders");
  const fail = (msg: string) => redirect(`/admin/orders/${id}?shiplist=${encodeURIComponent(msg)}`);
  if (!isMultiShip(row.ship_method)) fail("這筆訂單的出貨方式不是多地址配送");

  /* 表單是一位一組格子（name_0、phone_0…），count 告訴我們有幾組 */
  const count = Math.min(500, Math.max(0, Number(formData.get("count")) || 0));
  const list: Recip[] = [];
  for (let i = 0; i < count; i++) {
    const name = String(formData.get(`name_${i}`) || "").trim();
    const phone = String(formData.get(`phone_${i}`) || "").trim();
    const isCvs = isCvsMethod(String(formData.get(`ship_${i}`) || "宅配"));
    const address = String(formData.get(`address_${i}`) || "").trim();
    const storeName = String(formData.get(`store_name_${i}`) || "").trim();
    const storeNo = String(formData.get(`store_no_${i}`) || "").trim();
    const zip = String(formData.get(`zip_${i}`) || "").trim();
    const qty = Number(formData.get(`qty_${i}`)) || 0;
    const note = String(formData.get(`note_${i}`) || "").trim().slice(0, 80);
    const wantShipped = String(formData.get(`shipped_${i}`) || "") === "1";
    /* 整列都空的就當這一位被刪掉了，不報錯 */
    if (!name && !phone && !address && !storeName) continue;
    if (!name) fail(`第 ${i + 1} 位沒有填姓名`);
    if (isCvs) {
      if (!storeName || !storeNo) fail(`第 ${i + 1} 位是超商取貨，門市名稱與店號都要填`);
    } else if (!address) {
      fail(`第 ${i + 1} 位沒有填地址`);
    }
    if (qty < 1 || qty > 999) fail(`第 ${i + 1} 位的盒數不合理`);
    if (zip && !/^\d{3}$/.test(zip)) fail(`第 ${i + 1} 位的郵遞區號請填 3 碼數字，或留空讓系統自動判別`);
    list.push({
      name, phone, qty,
      shipMethod: isCvs ? "7-11店到店" : "宅配",
      address: isCvs ? "" : address,
      storeName: isCvs ? storeName : "",
      storeNo: isCvs ? storeNo : "",
      /* 手動郵遞區號只對宅配有意義；keyOf 刻意不含 zip，改它不會重置已出貨標記 */
      ...(!isCvs && zip ? { zip } : {}),
      ...(note ? { note } : {}),
      ...(wantShipped ? { shipped: 1 } : {}),
    });
  }

  /*
   * 出貨狀態不能只信表單送回來的值：那等於讓瀏覽器決定「這位寄出去了沒」。
   * 只有原本就已出貨、而且姓名電話地址都沒變的那幾位，才保留已出貨。
   * 表單把某一位改成未出貨（站長按了「取消出貨標記」）則照做，那是有意識的動作。
   */
  let prev: Recip[] = [];
  try { prev = JSON.parse(row.ship_list || "[]"); } catch { prev = []; }
  const keyOf = (r: Recip) =>
    [
      (r.name || "").trim(),
      (r.phone || "").replace(/\D/g, ""),
      isCvsMethod(r.shipMethod) ? "cvs" : "home",
      (r.address || "").replace(/\s/g, ""),
      (r.storeName || "").replace(/\s/g, ""),
      (r.storeNo || "").replace(/\D/g, ""),
    ].join("|");
  const wasShipped = new Set(prev.filter((r) => r.shipped).map(keyOf));
  const next: Recip[] = list.map((r) => {
    const base: Recip = {
      name: r.name, phone: r.phone, qty: r.qty,
      shipMethod: r.shipMethod, address: r.address, storeName: r.storeName, storeNo: r.storeNo,
      /* 郵遞區號手動值要跟著留下來，這個 base 少列一個欄位就是靜默弄丟一個欄位 */
      ...(r.zip ? { zip: r.zip } : {}),
      /* note 原本沒有列在這裡：上面 list.push 有存，但存回資料庫的是這個 base，
         少列這一行等於每次重存名單都把備註靜靜清空（既有 bug，順手修） */
      ...(r.note ? { note: r.note } : {}),
    };
    const keep = Boolean(r.shipped) && wasShipped.has(keyOf(r));
    return keep ? { ...base, shipped: 1 } : base;
  });

  db.prepare("UPDATE orders SET ship_list=? WHERE id=?").run(JSON.stringify(next), id);
  redirect(`/admin/orders/${id}?shiplist=ok`);
}


/* ═══════════════════════ 集數與來賓（問爽的） ═══════════════════════ */

function slugOk(s: string): boolean {
  return /^[a-z0-9-]+$/.test(s);
}

/* 章節文字 → JSON：「分:秒 標題」或「時:分:秒 標題」一行一個，解析不出來的行跳過 */
export async function parseChapters(text: string): Promise<{ t: number; label: string }[]> {
  const out: { t: number; label: string }[] = [];
  for (const raw of text.split("\n")) {
    const c = parseChapterLine(raw);
    if (c) out.push(c);
  }
  return out;
}

export async function saveEpisode(formData: FormData) {
  await guard();
  const id = Number(formData.get("id")) || 0;
  if (!id) redirect("/admin/episodes");
  const key = String(formData.get("key") || "").trim().toLowerCase();
  const alias = String(formData.get("slug_alias") || "").trim().toLowerCase();
  if (!slugOk(key) || (alias && !slugOk(alias))) redirect(`/admin/episodes/${id}?error=key`);
  if (episodeSlugConflict(id, key, alias)) redirect(`/admin/episodes/${id}?error=key`);
  const series = String(formData.get("series") || "main");
  const data = {
    id,
    key,
    slug_alias: alias,
    series: ["main", "submit", "pilot", "other"].includes(series) ? series : "main",
    ep_no: String(formData.get("ep_no") || "").trim(),
    short_title: String(formData.get("short_title") || "").trim(),
    seo_title: String(formData.get("seo_title") || "").trim(),
    tags: JSON.stringify(getMulti(formData, "tags")),
    cover: String(formData.get("cover") || ""),
    summary: String(formData.get("summary") || "").trim(),
    notes: String(formData.get("notes") || ""),
    transcript: String(formData.get("transcript") || ""),
    chapters: JSON.stringify(await parseChapters(String(formData.get("chapters") || ""))),
    published: on(formData, "published") ? 1 : 0,
    updated_at: new Date().toISOString().slice(0, 10),
  };
  db.prepare(
    `UPDATE episodes SET key=@key,slug_alias=@slug_alias,series=@series,ep_no=@ep_no,short_title=@short_title,seo_title=@seo_title,
       tags=@tags,cover=@cover,summary=@summary,notes=@notes,transcript=@transcript,chapters=@chapters,published=@published,updated_at=@updated_at WHERE id=@id`
  ).run(data);
  /* 來賓勾選：整組重寫 */
  const guests = formData.getAll("guest").map(Number).filter((n) => n > 0);
  db.transaction(() => {
    db.prepare("DELETE FROM episode_guests WHERE episode_id=?").run(id);
    const ins = db.prepare("INSERT OR IGNORE INTO episode_guests (episode_id,guest_id) VALUES (?,?)");
    for (const g of guests) ins.run(id, g);
  })();
  revalidatePath("/");
  revalidatePath("/ep");
  revalidatePath(`/ep/${key}`);
  if (data.published) {
    const { pingIndexNow } = await import("@/lib/indexnow");
    void pingIndexNow([`/ep/${key}`]);
  }
  await logAdmin("編輯集數", data.key, data.short_title);
  redirect(`/admin/episodes/${id}?saved=1`);
}

export async function deleteEpisode(formData: FormData) {
  await guard();
  const id = Number(formData.get("id"));
  db.transaction(() => {
    db.prepare("DELETE FROM episode_guests WHERE episode_id=?").run(id);
    db.prepare("DELETE FROM episodes WHERE id=?").run(id);
  })();
  await logAdmin("刪除集數", String(id));
  revalidatePath("/");
  revalidatePath("/ep");
  redirect("/admin/episodes");
}

export async function syncEpisodesNow() {
  await guard();
  const { syncEpisodes } = await import("@/lib/episodes");
  const r = await syncEpisodes();
  await logAdmin("同步集數", "", r.ok ? `新增 ${r.added}・更新 ${r.updated}` : r.msg || "失敗");
  revalidatePath("/");
  revalidatePath("/ep");
  redirect(`/admin/episodes?synced=${r.ok ? "ok" : "fail"}`);
}

export async function saveGuest(formData: FormData) {
  await guard();
  const id = Number(formData.get("id")) || 0;
  const slug = String(formData.get("slug") || "").trim().toLowerCase();
  const name = String(formData.get("name") || "").trim();
  if (!slug || !name || !slugOk(slug)) redirect(`/admin/guests/${id || "new"}?error=missing`);
  const dup = db.prepare("SELECT id FROM guests WHERE slug=? AND id<>?").get(slug, id);
  if (dup) redirect(`/admin/guests/${id || "new"}?error=slug`);
  const links = String(formData.get("links") || "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const i = l.indexOf("|");
      const label = i >= 0 ? l.slice(0, i).trim() : "";
      const url = (i >= 0 ? l.slice(i + 1) : l).trim();
      return { label, url };
    })
    .filter((l) => /^https?:\/\//i.test(l.url));
  const data = {
    id,
    slug,
    name,
    title: String(formData.get("title") || "").trim(),
    intro: String(formData.get("intro") || ""),
    photo: String(formData.get("photo") || ""),
    links: JSON.stringify(links),
    published: on(formData, "published") ? 1 : 0,
    featured: on(formData, "featured") ? 1 : 0,
    updated_at: new Date().toISOString().slice(0, 10),
  };
  let gid = id;
  if (id) {
    db.prepare(
      `UPDATE guests SET slug=@slug,name=@name,title=@title,intro=@intro,photo=@photo,links=@links,published=@published,featured=@featured,updated_at=@updated_at WHERE id=@id`
    ).run(data);
    const eps = formData.getAll("episode").map(Number).filter((n) => n > 0);
    db.transaction(() => {
      db.prepare("DELETE FROM episode_guests WHERE guest_id=?").run(id);
      const ins = db.prepare("INSERT OR IGNORE INTO episode_guests (episode_id,guest_id) VALUES (?,?)");
      for (const e of eps) ins.run(e, id);
    })();
  } else {
    const r = db.prepare(
      `INSERT INTO guests (slug,name,title,intro,photo,links,published,featured,created_at,sort)
       VALUES (@slug,@name,@title,@intro,@photo,@links,@published,@featured,@updated_at,(SELECT COALESCE(MAX(sort),0)+1 FROM guests))`
    ).run(data);
    gid = Number(r.lastInsertRowid);
  }
  await logAdmin("編輯來賓", slug, name);
  revalidatePath("/");
  revalidatePath("/guests");
  revalidatePath(`/guests/${slug}`);
  redirect(gid && id ? "/admin/guests" : `/admin/guests/${gid}`);
}

export async function deleteGuest(formData: FormData) {
  await guard();
  const id = Number(formData.get("id"));
  db.transaction(() => {
    db.prepare("DELETE FROM episode_guests WHERE guest_id=?").run(id);
    db.prepare("DELETE FROM guests WHERE id=?").run(id);
  })();
  await logAdmin("刪除來賓", String(id));
  revalidatePath("/");
  revalidatePath("/guests");
  redirect("/admin/guests");
}
