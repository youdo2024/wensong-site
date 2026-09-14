import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import db, { getSetting, json } from "@/lib/db";
import { PAYUNI, buildUppFields, payMethodParams, payuniEnabled, siteUrl } from "@/lib/payuni";
import { sendOrderCreatedMail, sendOrderPaidMail } from "@/lib/mail";
import { notifyChoiceFull, notifyProductPurchases } from "@/lib/notify";
import { parseChoiceStocks } from "@/lib/choice-stock";
import { addonEnabled, addonTiers, applyDiscount, coldEnabled, findDiscount, freightRates, isPayMethodOff, newebpayAtmBank, shopGateway } from "@/lib/shop";
import { tappayEnabled } from "@/lib/tappay";
import { buildCheckoutFields, ecpayEnabled, type EcpayMethod } from "@/lib/ecpay";
import { ecpayBackstageAtmOn, takeAtmNumberForOrder } from "@/lib/ecpay-genpay";
import { buildMpgForm, newebpayEnabled, type NewebpayMethod } from "@/lib/newebpay";
import { linepayEnabled } from "@/lib/linepay";
import { rateLimit, clientIp } from "@/lib/ratelimit";
import { draftViewable, shopViewable } from "@/lib/shop-preview";
import { gaClientIdFromCookie, gaPurchaseEvent, gaSessionFromCookie, GA_SESSION_COOKIE } from "@/lib/ga";
import { taipeiYMD } from "@/lib/month";
import { MULTI_SHIP, cvsPickupText, isMultiShip } from "@/lib/multi-ship";
import { computeFreight, hasCold, type OriginInfo } from "@/lib/freight";
import { npobanFormatOk, npobanName } from "@/lib/npoban";
import { taxIdChecksumOk } from "@/lib/taxid";
import { choiceActive, parseChoiceExpiry } from "@/lib/choice-split";
import { cvsMethodOf, normalizeBrand } from "@/lib/cvs";
import { checkEmail } from "@/lib/email-typo";
import { claimPayLink, payLinkByToken, payLinkItems } from "@/lib/pay-link";

type InItem = { id: number; choice: string | null; qty: number };

/*
 * 給顧客看的業務錯誤。只有這個類別的訊息會原文回傳；
 * 其他任何 Error（SQLite、程式蟲）一律回通用訊息——
 * 資料庫的錯誤原文（no such column 之類）不該出現在顧客的畫面上，
 * 那既嚇人也等於把內部結構講給攻擊者聽。
 */
class OrderError extends Error {}

/*
 * 建立訂單。
 * PayUni 已設定：訂單建立為 pending，回傳 UPP 跳轉表單，
 * 付款結果由 /api/payuni/notify 更新。未設定金鑰時為模擬模式（直接視為已付款）。
 */
export async function POST(req: NextRequest) {
  if (!rateLimit(`order:${clientIp(req.headers)}`, 20, 60 * 60 * 1000))
    return NextResponse.json({ error: "操作太頻繁，請稍後再試" }, { status: 429 });
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "格式錯誤" }, { status: 400 });

  const { name, phone, email, address, shipMethod, storeName, storeNo, newsletter, lineOptin, payMethod, invoiceType, invoiceData, items, addon, discountCode, source, env, payLink, recipientName, recipientPhone } = body as {
    name?: string; phone?: string; email?: string; address?: string;
    shipMethod?: string; storeName?: string; storeNo?: string; newsletter?: boolean;
    /* 結帳最後一格「用 LINE 收通知」：只記意願，感謝頁看它決定綁定按鈕多大 */
    lineOptin?: boolean;
    payMethod?: string; invoiceType?: string; invoiceData?: Record<string, string>;
    items?: InItem[]; addon?: number; discountCode?: string;
    /* 來源頁與瀏覽器環境：純分析用，前端送什麼都不影響流程，長度截斷即可 */
    source?: string; env?: string;
    /* 付款連結權杖：品項、數量、價格一律以資料庫裡那條連結為準，不看前端送什麼 */
    payLink?: string;
    /* 收件人不是訂購人才會有值；留空＝同訂購人（lib/recipient.ts 的判斷依據） */
    recipientName?: string; recipientPhone?: string;
  };

  /*
   * 付款連結：所有金額相關的東西都從資料庫讀，前端送來的 items、addon、discountCode
   * 在這條路上一律不採信。對方能決定的只有收件與發票資料。
   */
  const linkToken = String(payLink || "").trim();
  const link = linkToken ? payLinkByToken(linkToken) : undefined;
  if (linkToken && (!link || link.status !== "open"))
    return NextResponse.json({ error: "這條付款連結已經使用過或已失效" }, { status: 400 });
  /* 連結指定了開放哪些付款方式：前端隱藏擋不住直接打 API 的請求 */
  if (link && !json<string[]>(link.pays, []).includes(payMethod || "信用卡"))
    return NextResponse.json({ error: "這條連結沒有開放這種付款方式" }, { status: 400 });

  /* 後台停用的付款方式，後端也擋 */
  if (isPayMethodOff(payMethod || "信用卡")) {
    return NextResponse.json({ error: "此付款方式目前暫停使用，請改用其他方式" }, { status: 400 });
  }

  /*
   * 商店休息中：只有登入後台的站長能下單（站長預覽的測試單）。
   * 但付款連結不受這道門管：那是站長私下談定並主動發出去的，
   * 對方走公司請款流程可能拖上幾週，期間商店很可能已經因為檔期結束而關閉，
   * 這時候擋下來等於自己把談成的生意退掉。連結本身就是授權。
   */
  if (!link && !(await shopViewable()))
    return NextResponse.json({ error: "商店目前未開放" }, { status: 403 });
  /* 不需寄送的連結（收服務費那種）沒有貨要出，整塊物流不存在，也不能要求對方填地址 */
  const noShip = Boolean(link && !link.need_address);
  /* 取貨方式：宅配要地址，7-11 店到店要門市名稱（地址欄以門市字串呈現，後台與信件通用） */
  const isCvs = !noShip && shipMethod === "711";
  /*
   * 多地址配送：只有企業付款連結能選（前台也只在付款連結顯示這顆按鈕，
   * 但前台隱藏擋不住直接打 API，所以後端也要綁 link）。
   * 這種單結帳時不收地址——顧客只要付款，收件名單由站長在後台補進 ship_list。
   */
  const isMulti = !noShip && Boolean(link) && isMultiShip(shipMethod);
  /*
   * 超商品牌：門市字串要寫對是哪一家，不然客人拿著「7-11 大里國光店」去找
   * 一間不存在的門市。由伺服器從購物車的商品算，不採信前端。
   * 這裡先算一次給地址字串用；交易裡還會再算一次做混買擋門（那裡才有 lineItems）。
   */
  const brandOfProduct = db.prepare("SELECT pr.cvs_brand FROM products p LEFT JOIN partners pr ON pr.id = p.partner_id WHERE p.id=?");
  const ownBrandDefault = normalizeBrand(getSetting("cvs_brand_own", "7-11"));
  const cartBrands = new Set(
    (link ? payLinkItems(link) : items || []).map((it) => {
      const r = brandOfProduct.get(Number((it as { id?: number }).id) || 0) as { cvs_brand: string | null } | undefined;
      return r?.cvs_brand ? normalizeBrand(r.cvs_brand) : ownBrandDefault;
    })
  );
  const cvsBrandForAddress = cartBrands.size === 1 ? [...cartBrands][0] : ownBrandDefault;
  const shipAddress = noShip || isMulti
    ? ""
    : isCvs
      ? cvsPickupText(storeName, storeNo, cvsBrandForAddress)
      : String(address || "").trim();
  if (!name?.trim() || !phone?.trim() || !email?.trim())
    return NextResponse.json({ error: "請完整填寫訂購人資訊" }, { status: 400 });
  /* 信箱：確認信、發票、待付款提醒全靠它，打錯的話對方什麼都收不到 */
  const emailErr = checkEmail(email);
  if (emailErr) return NextResponse.json({ error: emailErr }, { status: 400 });
  /* 電話：台灣手機 10 碼（09 開頭），物流通知用 */
  if (!/^09\d{8}$/.test(String(phone).replace(/[\s-]/g, "")))
    return NextResponse.json({ error: "電話請填 10 碼手機號碼（09 開頭）" }, { status: 400 });
  /*
   * 收件人：留空＝同訂購人，前端沒勾「收件人不是我」就送空字串。
   * 填了姓名就當作勾了，電話要跟訂購人同一套格式（09 開頭 10 碼）；
   * 直接打 API 只塞電話不塞姓名的話，姓名沒填，電話也一起當沒填，
   * 存進資料庫的規則跟 lib/recipient.ts 的判斷一致：只看姓名。
   */
  const recipientNameTrim = String(recipientName || "").trim();
  const recipientPhoneTrim = recipientNameTrim ? String(recipientPhone || "").replace(/[\s-]/g, "") : "";
  if (recipientNameTrim && !/^09\d{8}$/.test(recipientPhoneTrim))
    return NextResponse.json({ error: "收件人電話請填 10 碼手機號碼（09 開頭）" }, { status: 400 });
  /* 發票選項（站內開票用）：統編 8 碼、手機條碼載具斜線開頭 8 碼、捐贈碼 3~7 碼 */
  const invD = (invoiceData || {}) as { carrierNo?: string; taxId?: string; npoban?: string };
  if (invoiceType === "b2b" && !taxIdChecksumOk(String(invD.taxId || "")))
    return NextResponse.json({ error: "統一編號不正確，請再確認一次（8 位數字，含檢查碼）" }, { status: 400 });
  if (invD.carrierNo && !/^\/[0-9A-Z.+-]{7}$/.test(String(invD.carrierNo).trim().toUpperCase()))
    return NextResponse.json({ error: "手機條碼載具格式不對（斜線開頭共 8 碼）" }, { status: 400 });
  /*
   * 捐贈碼一定要在這裡擋，不能只靠結帳頁的即時查詢——前端的檢查任何人都繞得過，
   * 而繞過去的後果是：錢收了、光貿退件、系統降級補開成寄 Email 的發票，
   * 客人以為自己捐了、其實沒捐。捐贈不可逆，所以要在建單之前就否決。
   */
  const npoban = String(invD.npoban || "").trim();
  if (npoban) {
    if (!npobanFormatOk(npoban))
      return NextResponse.json({ error: "捐贈碼是 3 到 7 位數字" }, { status: 400 });
    if (!npobanName(npoban))
      return NextResponse.json({ error: "查不到這個捐贈碼，請確認後再送出" }, { status: 400 });
  }
  /* 統編與捐贈是互斥的：開給公司報帳的發票不能捐出去。
     前端是單選所以不會同時出現，但送進來的是客戶端資料，一律不採信 */
  if (invoiceType === "b2b" && npoban)
    return NextResponse.json({ error: "打統編的發票不能同時捐贈" }, { status: 400 });
  if (!noShip && !isMulti && (isCvs ? !String(storeName || "").trim() || !String(storeNo || "").trim() : !String(address || "").trim()))
    return NextResponse.json({ error: isCvs ? "請填寫取貨門市名稱與店號" : "請填寫收件地址" }, { status: 400 });
  if (!link && (!Array.isArray(items) || items.length === 0))
    return NextResponse.json({ error: "購物車是空的" }, { status: 400 });

  /*
   * 未上架的商品一般人買不了。但站長（或持商店預覽金鑰的人）要能真的走完
   * 一次結帳來驗流程——排版看得出來的東西有限，運費、發票、通知信要下單才知道。
   * 這裡的 canPreview 沿用 shopViewable()，跟商品頁的預覽是同一道門。
   */
  const canPreviewShop = await draftViewable();
  const getProd = db.prepare(`SELECT id,name,price,stock,option_name,option_choices,choice_stocks,choice_expiry,soldout_label FROM products WHERE id=?${canPreviewShop ? "" : " AND published=1"}`);

  try {
    /* 這次下單後「剛好額滿」的規格：交易成功後通知站長 */
    const justFilled: { productId: number; productName: string; choice: string; label: string }[] = [];
    const result = db.transaction(() => {
      let subtotal = 0;
      let lineItems: { id: number; name: string; choice: string | null; price: number; qty: number }[] = [];
      /* 規格庫存：同商品可能多個規格，各自讀一次、最後寫回一次 */
      const choiceMaps = new Map<number, Record<string, number>>();
      /* 總庫存也要跨列累計：同商品選兩個規格＝兩列，不能各自只跟原始庫存比（會超賣） */
      const totalTaken = new Map<number, number>();
      /*
       * 付款連結：品項、數量、價格全部鎖死，直接抄資料庫裡的那一份。
       * 庫存不在這裡扣——建立連結的當下就預扣過了，這裡只是把預扣的量「交接」給訂單。
       * 再扣一次的話同一批貨會被扣兩份，那才是真正會出事的地方。
       */
      const linkItems = link ? payLinkItems(link) : [];
      for (const it of (link ? [] : items!)) {
        const p = getProd.get(it.id) as { id: number; name: string; price: number; stock: number; option_name: string | null; option_choices: string; choice_stocks: string; choice_expiry: string; soldout_label: string } | undefined;
        if (!p) throw new OrderError("商品不存在，請重新整理購物車");
        const qty = Math.floor(Number(it.qty));
        if (!Number.isFinite(qty) || qty < 1 || qty > 999) throw new OrderError("商品數量不正確，請重新整理購物車");
        const taken = (totalTaken.get(p.id) || 0) + qty;
        if (p.stock < taken) throw new OrderError(`「${p.name}」庫存不足，請調整數量`);
        totalTaken.set(p.id, taken);
        /*
         * 有規格的商品必須帶一個「存在且未過期」的規格。
         * 原本只在「有帶 choice」時檢查，不帶就整段跳過——前台一定會帶，
         * 但下架日功能讓「全部週次過期」變成可能：選項清單空了，前台沒東西可鎖，
         * 一筆沒有出貨週的訂單就會進到夥伴的工作台，沒有人知道該哪一週出。
         * 直接打 API 不帶 choice 的請求也是同一個洞，一起堵。
         */
        const allChoices = json<string[]>(p.option_choices, []);
        if (allChoices.length > 0) {
          if (!it.choice || !allChoices.includes(it.choice))
            throw new OrderError(`「${p.name}」請選擇${p.option_name || "規格"}`);
          if (!choiceActive(it.choice, parseChoiceExpiry(p.choice_expiry), taipeiYMD().iso))
            throw new OrderError(`「${p.name}」的「${it.choice}」已截止，請改選其他${p.option_name || "選項"}`);
        }
        /* 規格庫存（有設定該規格才管；沒設定＝不限量） */
        if (it.choice) {
          if (!choiceMaps.has(p.id)) choiceMaps.set(p.id, parseChoiceStocks(p.choice_stocks));
          const map = choiceMaps.get(p.id)!;
          if (Object.prototype.hasOwnProperty.call(map, it.choice)) {
            const label = p.soldout_label || "已滿";
            if (map[it.choice] < qty)
              throw new OrderError(`「${p.name}」的「${it.choice}」${map[it.choice] <= 0 ? label : "數量不足"}，請改選其他${p.option_name || "選項"}`);
            map[it.choice] -= qty;
            if (map[it.choice] <= 0) justFilled.push({ productId: p.id, productName: p.name, choice: it.choice, label });
          }
        }
        subtotal += p.price * qty;
        lineItems.push({ id: p.id, name: p.name, choice: it.choice ?? null, price: p.price, qty });
      }
      const setChoices = db.prepare("UPDATE products SET choice_stocks=? WHERE id=?");
      for (const [pid, map] of choiceMaps) setChoices.run(JSON.stringify(map), pid);
      if (link) {
        lineItems = linkItems.map((i) => ({ id: Number(i.id) || 0, name: i.name, choice: i.choice ?? null, price: i.price, qty: i.qty }));
        subtotal = lineItems.reduce((sum, i) => sum + i.price * i.qty, 0);
      }
      /* 加購贊助：階層金額之外也收自訂金額（站長指示 2026-08-29）。
         上限十萬：這是防手滑不是防惡意——錢是對方自己付的，
         但十萬以上的支持值得一封信談，不該在結帳頁順手發生。
         關閉加購時後端也要擋，前台隱藏擋不住直接打 API 的請求 */
      const addonRaw = Math.floor(Number(addon)) || 0;
      const addonAmt = addonEnabled() && addonRaw > 0 ? Math.min(addonRaw, 100000) : 0;

      /* 折扣碼（不分大小寫），金額一律以伺服器計算為準。
         連結型訂單不吃折扣碼：談好的企業價本來就是折扣，再疊一次是重複折讓，
         而折扣碼一定會流出去，看到欄位的人就是會試。 */
      const disc = link ? null : findDiscount(String(discountCode || ""));
      if (!link && discountCode && !disc) throw new OrderError("折扣碼無效或已停用");
      const { discount, freeship } = applyDiscount(subtotal, disc);

      const freeShip = Number(getSetting("free_ship_threshold", "1500"));
      /*
       * 運費（多夥伴版）：按（出貨地×溫層）分組，一組一包一費，各組免運各自算。
       * 引擎在 lib/freight.ts（純函式，結帳頁畫明細用同一份）。
       * freight_mode=flat 可切回舊制的整單一費。
       */
      const originOf = (() => {
        const cache = new Map<number, OriginInfo>();
        const q = db.prepare("SELECT p.partner_id, p.temp_zone, p.free_ship, pr.name AS pname, pr.ship_origin FROM products p LEFT JOIN partners pr ON pr.id = p.partner_id WHERE p.id=?");
        return (pid: number): OriginInfo => {
          if (!cache.has(pid)) {
            const r = q.get(pid) as { partner_id: number | null; temp_zone: string; free_ship: number | null; pname: string | null; ship_origin: string | null } | undefined;
            cache.set(pid, {
              origin: r?.partner_id || 0,
              originName: r?.partner_id ? String(r.pname || "夥伴工坊") : "問爽的本店",
              temp: r?.temp_zone === "cold" ? "cold" : "ambient",
              /* 逐商品免運門檻也從資料庫讀，不採信前端送來的任何數字 */
              freeAt: Math.max(0, Number(r?.free_ship) || 0),
            });
          }
          return cache.get(pid)!;
        };
      })();
      const frLines = lineItems.map((li) => ({ id: li.id, price: li.price, qty: li.qty }));
      /*
       * 超商品牌由伺服器自己算，不採信前端：品牌決定貨從哪家寄出，
       * 前端送什麼都不能影響。混買不同通路時擋下——一張單只有一個門市欄位，
       * 填哪一家都會有一半寄不到。
       */
      const brandQ = db.prepare("SELECT pr.cvs_brand FROM products p LEFT JOIN partners pr ON pr.id = p.partner_id WHERE p.id=?");
      const ownBrand = normalizeBrand(getSetting("cvs_brand_own", "7-11"));
      const brands = new Set(
        lineItems.map((li) => {
          const r = brandQ.get(li.id) as { cvs_brand: string | null } | undefined;
          return r?.cvs_brand ? normalizeBrand(r.cvs_brand) : ownBrand;
        })
      );
      if (isCvs && brands.size > 1)
        throw new OrderError("這筆訂單含不同超商通路的商品，請改用宅配，或分成兩筆下單");
      const cartBrand = [...brands][0] || ownBrand;
      /* 冷凍功能關閉時，購物車裡不該出現冷凍品（誤設商品溫層的保險） */
      if (!coldEnabled() && hasCold(frLines, originOf)) throw new OrderError("冷凍商品尚未開放購買，請聯繫我們");
      const freight = computeFreight(frLines, originOf, {
        mode: getSetting("freight_mode", "origin") === "flat" ? "flat" : "origin",
        isCvs,
        rates: freightRates(),
        allFree: freeship,
      });
      /* 不需寄送的連結（例如收拍片服務費）沒有貨要出，運費固定 0 */
      const shipping = link && !link.need_address ? 0 : freight.total;
      const shipDetail = link && !link.need_address ? "[]" : JSON.stringify(freight.groups);

      /* 訂單編號：YD + 日期 + 當日流水號。
         日期用台灣時間：伺服器（Zeabur 容器）多半跑 UTC，直接用本地時間的話，
         台灣早上 8 點前成立的訂單會被編成前一天的日期。 */
      const ymd = taipeiYMD().short;
      /*
       * 流水號只能往前，不能因為刪掉訂單而回頭。
       *
       * 先前是取「資料庫當日最大號 + 1」，這解決了用 COUNT 會回退的問題，
       * 但沒解決真正的麻煩：訂單編號同時也是送給金流商的商店訂單編號，
       * 而金流商那邊的號碼是永久的。站長刪掉測試單 YD…0003 之後，
       * 資料庫最大號退回 0002，下一筆又發 0003，金流商就回
       * 「已存在相同商店訂單編號」，顧客根本結不了帳。
       *
       * 改成把「當日發出去的最大號」另外記在 settings，取號時取
       * 資料庫最大號與這個水位的較大者再加一。訂單被刪掉水位也不會退，
       * 同一個號碼就不會發第二次。
       */
      const seqKey = `order_seq_${ymd}`;
      const lastNo = (db.prepare("SELECT MAX(order_no) AS m FROM orders WHERE order_no LIKE ?").get(`YD${ymd}%`) as { m: string | null }).m;
      const lastSeq = lastNo ? Number(lastNo.slice(-4)) : 0;
      const markRow = db.prepare("SELECT value FROM settings WHERE key=?").get(seqKey) as { value: string } | undefined;
      const markSeq = Number(markRow?.value) || 0;
      const base = Math.max(Number.isFinite(lastSeq) ? lastSeq : 0, markSeq);
      let seq = base + 1;
      let orderNo = `YD${ymd}${String(seq).padStart(4, "0")}`;
      /* 保險：舊資料或人工插入可能讓推算不準，往後找第一個沒用過的號 */
      const taken = db.prepare("SELECT 1 FROM orders WHERE order_no=?");
      for (let guard = 0; taken.get(orderNo) && guard < 10000; guard++) {
        seq++;
        orderNo = `YD${ymd}${String(seq).padStart(4, "0")}`;
      }
      /* 立刻把水位寫上去：即使這筆後來失敗或被刪，這個號碼也算用掉了 */
      db.prepare("INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
        .run(seqKey, String(seq));
      const orderToken = crypto.randomBytes(12).toString("hex");

      /* 連結型訂單的庫存在建立連結時就預扣了，這裡再扣一次會變成扣兩份 */
      if (!link) {
        const dec = db.prepare("UPDATE products SET stock = stock - ? WHERE id=?");
        for (const li of lineItems) dec.run(li.qty, li.id);
      }

      const total = subtotal - discount + addonAmt + shipping;
      /* 金流閘道：TapPay 只接站內刷卡（信用卡）。
         後台選了 TapPay 但金鑰未設：不默默退回 PayUni（前台顯示的是 TapPay），直接明講 */
      if (shopGateway() === "tappay" && !tappayEnabled() && (payMethod || "信用卡") === "信用卡")
        throw new OrderError("信用卡金流啟用作業中，暫時無法結帳");
      const useTappay = shopGateway() === "tappay" && tappayEnabled() && (payMethod || "信用卡") === "信用卡";
      /* 綠界模式：與贊助同一組金鑰。LINE Pay 走官方金流，前台已依 linepayEnabled 過濾，
         這裡再擋一次防有人繞過網頁直接打 API */
      const useEcpay = shopGateway() === "ecpay" && ecpayEnabled();
      if (shopGateway() === "ecpay" && !ecpayEnabled())
        throw new OrderError("金流啟用作業中，暫時無法結帳");
      if (useEcpay && payMethod === "LINE Pay" && !linepayEnabled())
        throw new OrderError("LINE Pay 尚未啟用，請改用其他付款方式");
      /* 藍新模式：只接信用卡、ATM、Apple Pay（見 lib/newebpay.ts），其餘方式在這個模式下不該出現，
         前台已經濾過，這裡再擋一次防有人繞過網頁直接打 API */
      const useNewebpay = shopGateway() === "newebpay" && newebpayEnabled();
      if (shopGateway() === "newebpay" && !newebpayEnabled())
        throw new OrderError("金流啟用作業中，暫時無法結帳");
      if (useNewebpay && !["信用卡", "ATM 轉帳", "Apple Pay"].includes(payMethod || "信用卡"))
        throw new OrderError("此付款方式目前暫停使用，請改用其他方式");
      const live = useTappay || useEcpay || useNewebpay || payuniEnabled();
      /* 訪客的 GA client_id：付款完成時伺服器端回報 purchase 用，能歸因回原流量來源 */
      const gaCid = gaClientIdFromCookie(req.cookies.get("_ga")?.value);
      const gaSess = gaSessionFromCookie(req.cookies.get(GA_SESSION_COOKIE)?.value);
      db.prepare(
        `INSERT INTO orders (order_no,name,phone,email,address,ship_method,pay_method,invoice_type,invoice_data,items,subtotal,shipping,total,status,created_at,addon_amount,discount_code,discount_amount,ga_cid,token,ga_sid,ga_snum,source,env,pay_link,ship_detail,line_optin,recipient_name,recipient_phone)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
      ).run(
        orderNo, name.trim(), phone.trim(), email.trim(), shipAddress,
        noShip ? "無需寄送" : isMulti ? MULTI_SHIP : isCvs ? cvsMethodOf(cartBrand) : "宅配",
        payMethod || "信用卡",
        invoiceType === "b2b" ? "b2b" : "b2c",
        /*
         * 捐贈碼順便把「當下查到的單位名稱」一起存起來。
         * 一來確認信與後台不必再查一次，二來財政部清單會變（單位改名、退出），
         * 半年後回頭看這筆訂單時，客人當初看到的名字才是對的那一個。
         */
        JSON.stringify(npoban ? { ...(invoiceData || {}), npoban, npobanName: npobanName(npoban) || "" } : (invoiceData || {})),
        JSON.stringify(lineItems),
        subtotal, shipping, total,
        live ? "pending" : "paid",
        new Date().toISOString(),
        addonAmt, disc ? disc.code : "", discount, gaCid, orderToken, gaSess.sid, gaSess.snum,
        String(source || "").slice(0, 200),
        ["fb", "ig", "line", "wv"].includes(String(env || "")) ? String(env) : "",
        link ? link.token : "",
        shipDetail,
        lineOptin === true ? 1 : 0,
        recipientNameTrim, recipientPhoneTrim
      );
      /*
       * 連結在「訂單成立」的這一刻就用掉，不是等付款成功。
       * 等付款成功才失效的話，對方刷卡失敗後重走一次流程就會再成立一張訂單，
       * 同一批貨被鎖兩份庫存。成立之後要重試，走的是訂單自己的免重填付款連結。
       *
       * 搶佔式：兩個分頁同時送出時只有一個會贏，輸的那個整筆交易回滾。
       */
      if (link && !claimPayLink(link.token, orderNo)) throw new OrderError("這條付款連結剛剛已經被使用了");
      const descParts = lineItems.map((li) => `${li.name}x${li.qty}`);
      /* 加購支持在金流明細上與發票定性一致，寫交易標的而非「贊助」 */
      if (addonAmt) descParts.push(`數位內容服務${addonAmt}`);
      return { orderNo, orderToken, total, desc: descParts.join(";").slice(0, 200), emailTrim: email.trim(), useTappay, useEcpay, useNewebpay };
    })();

    /* 這單把某個規格買到額滿 → 通知站長（該發限動了） */
    for (const f of justFilled) void notifyChoiceFull(f.productId, f.productName, f.choice, f.label);

    /*
     * 付款連結的訂單：成立當下就寄「收到訂單」信（含繼續付款按鈕）。
     *
     * 為什麼只限連結單：一般結帳 2026-07-14 就決定「付款完成才寄」，
     * 因為棄單的人不該收到信。但連結單不一樣——連結在成立這一刻就作廢了，
     * 對方再點只會看到「已經成立訂單了，請看信裡的接續付款連結」，
     * 而這封信先前根本不存在：實際發生過會計刷卡時 3D 驗證頁掛掉（404），
     * 回頭點連結被擋、手上又沒有任何信，只能寫信來問，卡了一小時等提醒信。
     * 信用卡失敗綠界不回呼，這封信是對方唯一能自救的入口。
     */
    if (link) {
      const created = db
        .prepare("SELECT order_no,name,email,address,items,subtotal,shipping,total,addon_amount,discount_amount,discount_code,token,status,invoice_type,invoice_data FROM orders WHERE order_no=?")
        .get(result.orderNo) as (Parameters<typeof sendOrderCreatedMail>[0] & { status: string }) | undefined;
      if (created && created.status === "pending") void sendOrderCreatedMail(created);
    }

    /* 新品通知訂閱（顧客勾選才收；名單在後台會員與名單頁） */
    if (newsletter === true && email?.trim()) {
      db.prepare("INSERT INTO subscribers (email,name,source,created_at) VALUES (?,?,?,?) ON CONFLICT(email) DO NOTHING")
        .run(email.trim().toLowerCase(), name?.trim() || "", "結帳", new Date().toISOString());
    }

    if (result.useTappay) {
      /* TapPay 站內刷卡：訂單已成立（pending），前端接著產 prime 打 /api/tappay/pay 請款 */
      return NextResponse.json({ orderNo: result.orderNo, token: result.orderToken, tappay: true });
    }
    if (result.useEcpay) {
      const site = siteUrl();
      /* LINE Pay 走官方金流：前端導去 request 路由建立付款並跳轉 LINE 授權頁 */
      if ((payMethod || "") === "LINE Pay") {
        return NextResponse.json({
          orderNo: result.orderNo,
          token: result.orderToken,
          linepay: `/api/linepay/request?od=${encodeURIComponent(result.orderNo)}&t=${result.orderToken}`,
        });
      }
      /* ATM 幕後取號（後台開關）：後端直接拿虛擬帳號，感謝頁馬上顯示，客人不進綠界頁。
         取號失敗就往下走原本的綠界跳轉頁，不讓客人卡在這裡 */
      if ((payMethod || "") === "ATM 轉帳" && ecpayBackstageAtmOn()) {
        const took = await takeAtmNumberForOrder(result.orderNo);
        if (took.ok) {
          return NextResponse.json({ orderNo: result.orderNo, token: result.orderToken, redirect: `/shop/thanks?no=${encodeURIComponent(result.orderNo)}&k=${result.orderToken}&pay=pending` });
        }
      }
      /* 其餘走綠界跳轉頁。ItemName 用 # 分隔是綠界的規格 */
      const method: EcpayMethod =
        payMethod === "Apple Pay" ? "applepay"
        : payMethod === "ATM 轉帳" ? "atm"
        : payMethod === "多元支付" ? "twqr"
        : "credit";
      const ec = buildCheckoutFields({
        merchantTradeNo: result.orderNo,
        amount: result.total,
        method,
        itemName: result.desc.split(";").join("#").slice(0, 400),
        clientBackUrl: `${site}/shop/thanks?no=${encodeURIComponent(result.orderNo)}&k=${result.orderToken}`,
      });
      return NextResponse.json({ orderNo: result.orderNo, token: result.orderToken, ecpay: ec });
    }
    if (result.useNewebpay) {
      /* 藍新只接信用卡、ATM、Apple Pay，其餘方式在建單那段已經擋下 */
      const method: NewebpayMethod = payMethod === "ATM 轉帳" ? "atm" : payMethod === "Apple Pay" ? "applepay" : "credit";
      const nb = buildMpgForm({
        orderNo: result.orderNo,
        amount: result.total,
        itemDesc: result.desc.split(";").join("、"),
        email: result.emailTrim,
        method,
        kind: "order",
        bankType: method === "atm" ? newebpayAtmBank() : undefined,
      });
      return NextResponse.json({ orderNo: result.orderNo, token: result.orderToken, newebpay: { action: nb.action, fields: nb.fields } });
    }
    if (payuniEnabled()) {
      /*
       * 這裡沒有帶統編、載具、愛心碼等發票明細，是刻意的，不是漏掉。
       * 查證過官方的 PAYUNi_for_WooCommerce 與 OpenCart4.0 兩個模組，
       * 它們送出的 UPP 參數都只有 MerID／MerTradeNo／TradeAmt／ProdDesc／
       * UsrMail／ReturnURL／NotifyURL／Timestamp 加上付款方式開關，
       * TradeInvoice 只是「要不要開發票」的布林開關（與 ApplePay 等並列），
       * 發票明細由消費者在 PayUni 的付款頁自行填寫，開立後再以
       * InvoiceNotifyType 通知我們（見 payment-sync.ts 的發票通知分支）。
       * 也就是說 UPP 根本不接受這些欄位，硬加只會讓驗簽或參數檢核失敗。
       */
      const upp = buildUppFields({
        MerID: PAYUNI.merId,
        MerTradeNo: result.orderNo,
        TradeAmt: result.total,
        ProdDesc: result.desc,
        UsrMail: result.emailTrim,
        UsrMailFix: "1",
        Timestamp: Math.floor(Date.now() / 1000),
        ReturnURL: `${siteUrl()}/api/payuni/return`,
        NotifyURL: `${siteUrl()}/api/payuni/notify`,
        Lang: "zh-tw",
        ...(process.env.PAYUNI_INVOICE === "1" ? { TradeInvoice: 1 } : {}),
        ...payMethodParams(payMethod || "信用卡"),
      });
      return NextResponse.json({ orderNo: result.orderNo, token: result.orderToken, payuni: upp });
    }
    /* 模擬模式：直接視為已付款，立即寄確認信＋回報 GA */
    const full = db.prepare("SELECT * FROM orders WHERE order_no=?").get(result.orderNo) as Parameters<typeof sendOrderPaidMail>[0] & {
      ga_cid: string; items: string; total: number; shipping: number; order_no: string;
    };
    gaPurchaseEvent(full);
    void sendOrderPaidMail(full);
    {
      const row = db.prepare("SELECT id FROM orders WHERE order_no=?").get(result.orderNo) as { id: number };
      void notifyProductPurchases(row.id);
    }

    return NextResponse.json({ orderNo: result.orderNo, token: result.orderToken });
  } catch (e) {
    if (e instanceof OrderError) return NextResponse.json({ error: e.message }, { status: 400 });
    console.error("[orders] 建單失敗（非業務錯誤）", e);
    return NextResponse.json({ error: "建立訂單失敗，請稍後再試；若一再發生請來信告訴我們" }, { status: 500 });
  }
}
