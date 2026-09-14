"use client";
import { useEffect, useRef, useState } from "react";
import PayChip from "@/components/PayChip";

/* 多元支付（TWQR）可用的錢包，與贊助頁同一份 */
const TWQR_WALLETS = ["台灣Pay", "街口", "全支付", "一卡通", "悠遊付"];
import { MULTI_SHIP } from "@/lib/multi-ship";
import { computeFreight, hasCold, type OriginInfo, type RateTable } from "@/lib/freight";
import { storeHint, type CvsBrand } from "@/lib/cvs";
import { DEFAULT_NPOBAN, npobanFormatOk } from "@/lib/npoban-code";
import { taxIdChecksumOk } from "@/lib/taxid";

/* 發票四選項。順序＝畫面順序，站長指定：捐發票 → 存信箱 → 存載具 → 打統編 */
type InvKind = "donate" | "email" | "carrier" | "b2b";
const INV_KEY = "yo_inv_choice";

/* 待付款訂單的重試資訊（訂單編號＋權杖），僅存於本分頁 */
const RETRY_KEY = "yo_tappay_retry";
function saveRetry(no: string, tok: string) {
  try {
    sessionStorage.setItem(RETRY_KEY, JSON.stringify({ no, tok }));
  } catch {}
}
function clearRetry() {
  try {
    sessionStorage.removeItem(RETRY_KEY);
  } catch {}
}
import { useRouter } from "next/navigation";
import { inAppBrowser } from "@/lib/webview";
import InAppWarn from "./InAppWarn";
import EmailField from "./EmailField";
import { useCart } from "./CartProvider";
import { money, dollar } from "@/lib/format";
import Highlight from "./Highlight";
import TapPayCard, { type TapPayCardHandle } from "./TapPayCard";
import { TW_ZIP, TW_COUNTIES } from "@/lib/tw-zip";

/* 順序照站長指定：LINE Pay 排第一（實測成功率最高），信用卡放最後（成功率最低）。
   Samsung Pay 已停用，不列在這裡。 */
/* 沒有傳 pays 時的備援順序，跟購物車保持一致：LINE Pay → ATM → 信用卡 → Apple Pay */
const DEFAULT_PAYS = ["LINE Pay", "ATM 轉帳", "信用卡", "Apple Pay"];

/* TapPay 模式的前端設定（appId/appKey 是 SDK 公開值，非機密） */
export type TapPayClientConfig = { appId: number; appKey: string; sandbox: boolean };

type DiscountInfo = { code: string; kind: "percent" | "amount" | "freeship"; value: number; label: string };

export default function CheckoutForm({
  freeShip,
  shipFee,
  addonTiers,
  addonPitch = "結帳前，要不要【額外贊助「問爽的」】？多一份支持，沒有業配的節目就能走得更遠。",
  pays = DEFAULT_PAYS,
  showAddon = true,
  cvsFee = 65,
  presets = { name: "", phone: "", email: "", address: "" },
  gateway = "payuni",
  tappay = null,
  payLink = null,
  lineNotify = false,
  origins = {},
  freightMode = "flat",
  rates,
  coldOn = false,
}: {
  freeShip: number;
  shipFee: number;
  addonTiers: number[];
  addonPitch?: string;
  pays?: string[];
  showAddon?: boolean;
  cvsFee?: number;
  /* 商品 → 出貨地與溫層（多夥伴運費分組用）。沒給＝全部當本店常溫，行為同舊制 */
  origins?: Record<number, { origin: number; name: string; temp: "ambient" | "cold"; cvs?: "7-11" | "全家"; freeAt?: number }>;
  freightMode?: "origin" | "flat";
  /* 四格費率（溫層×取貨方式）。沒給時用預設值，行為等同今天 */
  rates?: RateTable;
  coldOn?: boolean;
  /* LINE Messaging API 有設定時才顯示「用 LINE 收通知」那一格 */
  lineNotify?: boolean;
  presets?: { name: string; phone: string; email: string; address: string };
  /* 後台選的金流：文案與流程跟著它走（就算金鑰還沒設好，也不會顯示成另一家） */
  gateway?: "payuni" | "tappay" | "ecpay" | "newebpay";
  /* TapPay 前端設定；gateway=tappay 但金鑰未設時為 null（欄位隱藏、送出鎖住） */
  tappay?: TapPayClientConfig | null;
  /*
   * 付款連結：品項、數量、價格都由後台先談好並鎖死，這裡只是照著顯示。
   * 送出時只帶權杖，伺服器一律以資料庫裡那條連結為準，不採信前端送來的金額。
   * needAddress=false 代表沒有貨要寄（例如收拍片服務費），整塊物流與運費消失。
   */
  payLink?: { token: string; items: { id: number; name: string; choice: string | null; price: number; qty: number }[]; needAddress: boolean; invTaxId?: string; invCompany?: string } | null;
}) {
  const { cart, clear } = useCart();
  /* 連結型結帳不看購物車，品項來自連結本身 */
  const lines = payLink ? payLink.items.map((i, n) => ({ key: `pl${n}`, ...i })) : cart;
  const noShip = Boolean(payLink && !payLink.needAddress);
  const router = useRouter();
  const [pay, setPay] = useState(pays[0] || "信用卡");
  /*
   * 內建瀏覽器（FB／IG／LINE）：贊助頁早就在處理，結帳頁一直沒有——
   * 而商店才是 LINE Pay 用得最兇的地方。Apple Pay 在內建瀏覽器無法完成一律隱藏、
   * ATM（零失敗）提前到信用卡前，並把環境記進訂單供後台歸因。
   * 偵測失敗一律當一般瀏覽器，不影響任何流程。
   */
  const [envKind, setEnvKind] = useState("");
  const [payList, setPayList] = useState(pays);
  /* Apple Pay 只給真的能付的裝置看（Safari／iOS 16 以上），其他瀏覽器到了綠界頁也不會出現這個選項 */
  useEffect(() => {
    try {
      const w = window as unknown as { ApplePaySession?: { canMakePayments?: () => boolean } };
      if (!(w.ApplePaySession && w.ApplePaySession.canMakePayments && w.ApplePaySession.canMakePayments())) {
        setPayList((list) => list.filter((x) => x !== "Apple Pay"));
      }
    } catch { setPayList((list) => list.filter((x) => x !== "Apple Pay")); }
  }, []);
  /* 來源頁：顧客是從哪一頁走進結帳的（同站才記路徑，站外只記網域，不記完整網址） */
  const [srcPath, setSrcPath] = useState("");
  useEffect(() => {
    try {
      const ref = document.referrer;
      if (!ref) { setSrcPath("直接進入"); return; }
      const u = new URL(ref);
      setSrcPath(u.origin === location.origin ? u.pathname : u.hostname);
    } catch { /* 取不到就留空，純分析用，不影響流程 */ }
  }, []);
  useEffect(() => {
    const env = inAppBrowser();
    if (!env.inApp) return;
    setEnvKind(env.kind);
    setPayList((list) => {
      /*
       * 內建瀏覽器裡把刷卡類全部拿掉，只留 LINE Pay 與 ATM。
       *
       * 依據是實際資料：內建瀏覽器裡刷卡四個人嘗試只有一個人成功，
       * 而同一批人的 LINE Pay 是 4/4；一般瀏覽器裡刷卡則是 4/5。
       * 贊助那邊獨立量到的方向一致（內建信用卡 33%、LINE Pay 67%）。
       *
       * 「不要剝奪選擇」這個說法在這裡站不住：給他一個八成會失敗的選項，
       * 失敗之後多數人不會換瀏覽器重試，他們就走了。想刷卡的人還是有出路，
       * 上面的警示會告訴他用 Safari 或 Chrome 開這一頁。
       */
      const l = list.filter((x) => x !== "Apple Pay" && x !== "信用卡");
      /* 保險：後台若把 LINE Pay 與 ATM 都停用了，濾完會是空的。
         總不能讓人沒有任何付款方式，那時候就維持原樣。 */
      if (l.length === 0) return list;
      const ai = l.indexOf("ATM 轉帳");
      const ci = l.indexOf("信用卡");
      /* ATM 不需跳轉驗證，在內建瀏覽器裡是唯一零失敗的方式，排到信用卡前面 */
      if (ai > -1 && ci > -1 && ai > ci) {
        l.splice(ai, 1);
        l.splice(ci, 0, "ATM 轉帳");
      }
      return l;
    });
  }, []);
  /* 被隱藏的付款方式如果正好是目前選中的，要換掉，否則送出會被後端擋下 */
  useEffect(() => {
    if (payList.length && !payList.includes(pay)) setPay(payList[0]);
  }, [payList, pay]);

  const [cardReady, setCardReady] = useState(false);
  /* TapPay 首刷失敗後重試用：訂單已成立（購物車已清空），重試只重新請款、不重建訂單 */
  const [pendingOrderNo, setPendingOrderNo] = useState("");
  const [pendingToken, setPendingToken] = useState("");
  /* 重試資訊存進 sessionStorage，關掉分頁再回來還找得到那筆待付款訂單。
     只存訂單編號與權杖，不存任何個資或卡片資訊。 */
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(RETRY_KEY);
      if (!raw) return;
      const { no, tok } = JSON.parse(raw) as { no: string; tok: string };
      if (no) {
        setPendingOrderNo(no);
        setPendingToken(tok || "");
      }
    } catch {
      /* sessionStorage 不可用（無痕模式或被封鎖）不影響付款，忽略即可 */
    }
  }, []);
  const tpRef = useRef<TapPayCardHandle | null>(null);
  const isTappay = gateway === "tappay";
  /* 站內開票（光貿）：TapPay、綠界、藍新模式都由本站開發票，要在這裡收發票選項；
     只有 PayUni 是由它的付款頁自行收集 */
  const selfInvoice = isTappay || gateway === "ecpay" || gateway === "newebpay";
  const tappayCard = isTappay && pay === "信用卡";
  /*
   * 預設店到店（站長指示 2026-08-30）：多數客人選的是超商，而且運費便宜一半
   * （常溫 65 對 125、冷凍 145 對 280），預設踩在便宜的那一邊比較不會勸退。
   *
   * 企業付款連結例外，維持宅配：那種單動輒 30 盒起，超商件有材積與重量限制，
   * 而且對方本來就是談好地址或走多地址配送的。
   */
  const [ship, setShip] = useState<"宅配" | "711" | typeof MULTI_SHIP>(payLink ? "宅配" : "711");
  /* 多地址配送只給企業付款連結。一般購物車不顯示，避免散客誤選之後沒有地址可寄 */
  const allowMulti = Boolean(payLink);
  const isMulti = ship === MULTI_SHIP;
  /* 收件地址：縣市／鄉鎮市區下拉＋自動郵遞區號（比照主流電商），街道另填 */
  const [city, setCity] = useState("");
  const [dist, setDist] = useState("");
  const zip = (TW_ZIP[city] || {})[dist] || "";
  /*
   * 發票（商店結帳限定；贊助發票另有流程）。順序與預設是站長定的：
   * 捐發票 → 存信箱 → 存載具 → 打統編，一般結帳預設「捐發票」給家扶。
   *
   * 企業付款連結例外，預設「打統編」：那種單本來就是為了報帳而談的。
   * 但四個選項都留著能點——對方也可能不需要抵稅，那就讓他捐。
   *
   * 只有「站長已經先填好統編」的連結才預設 b2b。沒填統編的連結若也預設 b2b，
   * 客人一進來就是一個空的必填統編欄位，不打字就送不出去——等於平白多一道關卡。
   */
  const [inv, setInv] = useState<InvKind>(payLink?.invTaxId ? "b2b" : payLink ? "email" : "donate");
  const [carrierNo, setCarrierNo] = useState("");
  const [taxId, setTaxId] = useState(payLink?.invTaxId || "");
  const [company, setCompany] = useState(payLink?.invCompany || "");
  /* 捐贈碼：預設帶家扶（8585），客人可以改成任何一個財政部清單裡的碼 */
  const [npoban, setNpoban] = useState(DEFAULT_NPOBAN);
  const [npoInfo, setNpoInfo] = useState<{ state: "idle" | "loading" | "ok" | "bad"; name: string; msg: string }>({ state: "idle", name: "", msg: "" });
  /* 統編查經濟部的結果。查不到「不」擋——見下面 useEffect 的說明 */
  const [taxInfo, setTaxInfo] = useState<{ state: "idle" | "loading" | "ok" | "warn" | "bad"; name: string; msg: string }>({ state: "idle", name: "", msg: "" });
  /* 預設勾選：結帳留 Email 本來就是交易必要資料，訂閱可隨時取消（表單上有明講） */
  const [newsletter, setNewsletter] = useState(true);
  /* 結帳最後一格：用 LINE 收通知。預設勾（站長希望大家都用 LINE），沒勾的感謝頁會再問一次 */
  const [lineOptin, setLineOptin] = useState(true);
  const [addon, setAddon] = useState(0);
  /* 自訂加購金額：按了「自訂」出現輸入框，離開欄位才寫進 addon（打字中不跳動） */
  const [addonCustom, setAddonCustom] = useState(false);
  const [addonInput, setAddonInput] = useState("");
  const [codeInput, setCodeInput] = useState("");
  const [discount, setDiscount] = useState<DiscountInfo | null>(null);
  const [codeErr, setCodeErr] = useState("");
  const [err, setErr] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const subtotal = lines.reduce((s, i) => s + i.price * i.qty, 0);
  const discountAmt = !discount
    ? 0
    : discount.kind === "amount"
      ? Math.min(subtotal, discount.value)
      : discount.kind === "percent"
        ? Math.round((subtotal * (100 - Math.min(99, Math.max(1, discount.value)))) / 100)
        : 0;
  /* 運費：與伺服器同一份引擎（lib/freight.ts）。畫面只是預覽，權威金額在 /api/orders 重算 */
  const frLines = lines.map((i) => ({ id: i.id, price: i.price, qty: i.qty }));
  const infoOf = (id: number): OriginInfo => {
    const o = origins[id];
    return { origin: o?.origin ?? 0, originName: o?.name ?? "問爽的本店", temp: o?.temp ?? "ambient", freeAt: o?.freeAt ?? 0 };
  };
  const coldInCart = hasCold(frLines, infoOf);
  /*
   * 購物車裡的超商品牌。夥伴各自有自己的通路（蛋捲走 7-11、許愿的冷凍禮盒只能走全家），
   * 但結帳頁只有一個門市欄位，混買不同通路的話填哪一家都是錯的。
   * 所以混買時直接把超商選項收起來、請客人改宅配或分兩筆——
   * 寧可少一種選擇，也不要讓客人填了 7-11 門市、貨卻從全家寄出。
   */
  const cvsBrands = [...new Set(lines.map((i) => origins[i.id]?.cvs || "7-11"))];
  const cvsBrand: CvsBrand = cvsBrands[0] || "7-11";
  const cvsMixed = cvsBrands.length > 1;
  /*
   * 實際生效的取貨方式。混買不同超商通路時「店到店」那顆按鈕根本不存在，
   * 畫面、金額與送出的值都要立刻以宅配為準——下面那個 useEffect 也會把 state
   * 拉回來，但那是下一格畫面的事，中間會閃出一格填不得的門市欄位。
   */
  const shipEff: "宅配" | "711" | typeof MULTI_SHIP = cvsMixed && ship === "711" ? "宅配" : ship;
  const rateTable: RateTable = rates ?? {
    charge: { "ambient-home": shipFee, "ambient-cvs": cvsFee, "cold-home": 280, "cold-cvs": 145 },
    cost: { "ambient-home": 0, "ambient-cvs": 0, "cold-home": 0, "cold-cvs": 0 },
    free: { "ambient-home": freeShip, "ambient-cvs": freeShip, "cold-home": 3000, "cold-cvs": 3000 },
  };
  /*
   * 兩種取貨方式各算一次：選項上的金額必須是「選了會付的那個數字」。
   * 原本兩顆按鈕都印網站設定的常溫宅配費，冷凍商品實際收 280 卻寫著 $125，
   * 客人是在按下去之後才發現的。
   */
  const quoteWay = (isCvs: boolean) =>
    noShip || subtotal === 0
      ? { groups: [] as ReturnType<typeof computeFreight>["groups"], total: 0, costTotal: 0 }
      : computeFreight(frLines, infoOf, {
          mode: freightMode,
          isCvs,
          rates: rateTable,
          allFree: discount?.kind === "freeship",
        });
  const homeQuote = quoteWay(false);
  const cvsQuote = quoteWay(true);
  const freight = shipEff === "711" ? cvsQuote : homeQuote;
  const shipping = freight.total;
  /* 收件地址那行要講對溫層：混買常溫＋冷凍會分兩包寄，不能只寫「常溫」 */
  const tempsInCart = [...new Set(frLines.map((l) => infoOf(l.id).temp))];
  const tempLabel = tempsInCart.length > 1 ? "常溫與低溫分開寄" : tempsInCart[0] === "cold" ? "低溫" : "常溫";
  /* 免運門檻文案：單一包裹時直接講那一組的門檻（可能是商品自己設的，不是網站設定那個） */
  const freeAtOf = (g?: { freeAt: number }) => (g && Number.isFinite(g.freeAt) && g.freeAt > 0 ? g.freeAt : freeShip);
  const multiParcel = freightMode === "origin" && freight.groups.length > 1;
  const total = subtotal - discountAmt + addon + shipping;
  /*
   * 回頭客記住上次選的發票方式。
   *
   * 「捐發票」是預設，而預設只該套用在第一次來的人身上。已經買過的客人上次
   * 選什麼、這次就還是什麼——否則他下一次會在沒注意的情況下把發票捐掉，
   * 那是「問爽的偷偷捐我的發票」，不是「老闆從小被家扶帶大」。
   *
   * 存在 localStorage 而不是綁會員：多數客人是訪客結帳，綁會員等於幾乎沒人記得住。
   * 在 effect 裡讀而不是 useState 初始值：那樣伺服器與瀏覽器算出來的畫面會不一致
   * （hydration mismatch）。反正購物車本身也是 localStorage 來的，整張表單本來
   * 就要等 hydration 才長出來，這一格跟著一起出現，看不出先後。
   *
   * 企業付款連結不吃這個記憶：那是站長談好的單，預設統編才對。
   */
  useEffect(() => {
    if (payLink) return;
    try {
      const v = localStorage.getItem(INV_KEY);
      if (v === "donate" || v === "email" || v === "carrier" || v === "b2b") setInv(v);
      const c = localStorage.getItem(INV_KEY + "_npoban");
      if (c && npobanFormatOk(c)) setNpoban(c);
    } catch { /* 隱私模式讀不到就算了，照樣用預設 */ }
  }, [payLink]);

  /* 選過就記起來。只記「選擇」與捐贈碼，不記載具與統編——那是個資，
     而且瀏覽器是共用的（家裡的電腦、公司的電腦） */
  useEffect(() => {
    if (payLink) return;
    try {
      localStorage.setItem(INV_KEY, inv);
      if (inv === "donate" && npobanFormatOk(npoban)) localStorage.setItem(INV_KEY + "_npoban", npoban.trim());
    } catch { /* 寫不進去不影響結帳 */ }
  }, [inv, npoban, payLink]);

  /*
   * 捐贈碼即時查名稱。捐贈是不可逆的，客人要在按下付款「之前」看到捐給誰。
   * 光貿其實也會擋錯的碼，但那是收完錢之後才發生，結果是降級補開成寄 Email
   * 的發票——他以為捐了、其實沒捐。
   */
  useEffect(() => {
    if (inv !== "donate") return;
    const code = npoban.trim();
    if (!npobanFormatOk(code)) {
      setNpoInfo({ state: "bad", name: "", msg: code ? "捐贈碼是 3 到 7 位數字" : "請填捐贈碼" });
      return;
    }
    setNpoInfo({ state: "loading", name: "", msg: "" });
    /* 打字中每一鍵都查會既慢又吵，停手 400ms 才問 */
    const id = setTimeout(async () => {
      try {
        const r = await fetch(`/api/npoban?code=${encodeURIComponent(code)}`);
        const d = await r.json();
        if (d.ok) setNpoInfo({ state: "ok", name: d.name, msg: "" });
        else setNpoInfo({ state: "bad", name: "", msg: d.msg || "查不到這個捐贈碼" });
      } catch {
        /* 查不動的時候放行：後端建單時還會再驗一次，不能因為查詢壞掉就讓人結不了帳 */
        setNpoInfo({ state: "idle", name: "", msg: "" });
      }
    }, 400);
    return () => clearTimeout(id);
  }, [inv, npoban]);

  /*
   * 統編查經濟部。這是三個欄位裡唯一「光貿不會擋」的：光貿只驗檢查碼，
   * 不驗存不存在，所以打錯一碼的結果是靜靜開出一張抬頭是空氣的發票。
   *
   * 但查不到「不能擋」：經濟部商工登記只涵蓋公司、商號、分公司。
   * 財團法人、社團法人、學校、政府機關都有統編卻不在裡面——家扶基金會
   * 自己的 52628812 就查不到。擋下來會擋掉一整類真實客戶。所以只警告。
   */
  useEffect(() => {
    if (inv !== "b2b") return;
    const no = taxId.trim();
    if (!/^\d{8}$/.test(no)) {
      setTaxInfo({ state: no ? "bad" : "idle", name: "", msg: no ? "統一編號是 8 位數字" : "" });
      return;
    }
    if (!taxIdChecksumOk(no)) {
      setTaxInfo({ state: "bad", name: "", msg: "這組統一編號的檢查碼不對，請再確認一次" });
      return;
    }
    setTaxInfo({ state: "loading", name: "", msg: "" });
    const id = setTimeout(async () => {
      try {
        const r = await fetch(`/api/taxid?no=${encodeURIComponent(no)}`);
        const d = await r.json();
        if (d.ok) setTaxInfo({ state: "ok", name: d.name, msg: d.kind });
        else if (d.reason === "checksum") setTaxInfo({ state: "bad", name: "", msg: "這組統一編號的檢查碼不對，請再確認一次" });
        else setTaxInfo({ state: "warn", name: "", msg: "經濟部商工登記查不到這組統編。財團法人、學校、機關、協會本來就不在這個資料庫裡，是的話可以直接送出；如果是公司行號，請再確認號碼。" });
      } catch {
        setTaxInfo({ state: "idle", name: "", msg: "" });
      }
    }, 500);
    return () => clearTimeout(id);
  }, [inv, taxId]);

  /* 查到登記名稱就自動帶進抬頭，但客人改過就不要再蓋掉他 */
  const companyTouched = useRef(false);
  useEffect(() => {
    if (inv === "b2b" && taxInfo.state === "ok" && taxInfo.name && !companyTouched.current) setCompany(taxInfo.name);
  }, [inv, taxInfo]);

  /* 混買不同超商通路、取貨方式卻停在超商：自動跳回宅配（後端也會擋，這裡是不讓人白填） */
  useEffect(() => {
    if (cvsMixed && ship === "711") setShip("宅配");
  }, [cvsMixed, ship]);

  async function applyCode() {
    setCodeErr("");
    if (!codeInput.trim()) return;
    const res = await fetch("/api/discount", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: codeInput }),
    });
    const data = await res.json();
    if (!res.ok) {
      setDiscount(null);
      setCodeErr(data.error || "折扣碼無效");
      return;
    }
    setDiscount(data);
  }

  /* TapPay：對既有訂單請款（首刷與重試共用） */
  async function payWithTapPay(orderNo: string, token: string) {
    try {
      /* 原本寫 tpRef.current!，SDK 沒載入完成時會拋 TypeError，
         顧客看到的卻是「付款沒有成功」，只會一直換卡片試。 */
      if (!tpRef.current) {
        throw new Error("刷卡欄位還在載入中，請稍等幾秒再按一次（若持續發生，請重新整理頁面）");
      }
      const prime = await tpRef.current.getPrime();
      const payRes = await fetch("/api/tappay/pay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        /* 權杖一起送：後端要用它確認來人就是下單的人，
           否則任何人猜到訂單編號都能對別人的訂單發動請款、也能探測訂單狀態 */
        body: JSON.stringify({ orderNo, prime, token }),
      });
      const payData = await payRes.json().catch(() => ({}));
      if (!payRes.ok) throw new Error(payData.error || "付款沒有成功");
      if (payData.paymentUrl) {
        window.location.href = payData.paymentUrl; // 銀行 3D 驗證頁
        return;
      }
      clearRetry();
      router.push(`/shop/thanks?no=${orderNo}&pay=paid&k=${token}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "付款沒有成功，請再試一次");
      setSubmitting(false);
    }
  }

  /* 電話填錯時，光在表單底部顯示一行紅字是不夠的：欄位在畫面上方，
     使用者看到訊息也不知道是哪一格。改成欄位本身標紅＋就地說明，
     送出時再把畫面捲回該欄位並聚焦。 */
  const phoneRef = useRef<HTMLInputElement>(null);
  const [phoneBad, setPhoneBad] = useState(false);
  const phoneOk = (v: string) => /^09\d{8}$/.test(v.replace(/[\s-]/g, ""));
  /* 收件人不是我：勾了才展開兩欄，沒勾就送空字串（後端存空＝同訂購人） */
  const [diffRecipient, setDiffRecipient] = useState(false);

  async function placeOrder(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    /* TapPay 重試：訂單已成立（購物車已清空），只重新請款 */
    if (tappayCard && pendingOrderNo) {
      setSubmitting(true);
      setErr("");
      await payWithTapPay(pendingOrderNo, pendingToken);
      return;
    }
    if (lines.length === 0) {
      setErr("購物車是空的");
      return;
    }
    const fd = new FormData(e.currentTarget);
    /* 電話：台灣手機 10 碼（09 開頭），寄件與物流通知都要用 */
    const phoneVal = String(fd.get("phone") || "").replace(/[\s-]/g, "");
    /* 必填掃描：缺什麼直接講，別讓人按了沒動靜自己猜 */
    {
      const form = e.currentTarget;
      const LABELS: Record<string, string> = {
        name: "訂購人全名", phone: "手機號碼", email: "Email", street: "收件地址",
        store_name: "門市名稱", store_no: "門市店號",
        recipient_name: "收件人姓名", recipient_phone: "收件人電話",
      };
      const missing: { el: HTMLElement; label: string }[] = [];
      for (const raw of Array.from(form.elements)) {
        const el = raw as HTMLInputElement | HTMLSelectElement;
        if (!("required" in el) || !el.required || el.disabled) continue;
        if (String(el.value || "").trim()) continue;
        const label = LABELS[el.name] || el.getAttribute("aria-label") || "必填欄位";
        el.classList.add("miss");
        el.addEventListener("input", () => el.classList.remove("miss"), { once: true });
        el.addEventListener("change", () => el.classList.remove("miss"), { once: true });
        missing.push({ el, label });
      }
      if (missing.length > 0) {
        setErr(`還有 ${missing.length} 個欄位沒填：${[...new Set(missing.map((m) => m.label))].join("、")}`);
        missing[0].el.scrollIntoView({ block: "center" });
        (missing[0].el as HTMLElement).focus();
        return;
      }
    }
    if (!phoneOk(phoneVal)) {
      setPhoneBad(true);
      setErr("電話請填 10 碼手機號碼（09 開頭），物流通知才收得到");
      /* 捲回欄位並聚焦，使用者才知道是哪一格出問題 */
      phoneRef.current?.scrollIntoView({ block: "center" });
      phoneRef.current?.focus();
      return;
    }
    /* 收件人電話跟訂購人同一套規則（09 開頭 10 碼）：勾了「不是我」才驗，沒勾就不用管 */
    const recipientPhoneVal = String(fd.get("recipient_phone") || "").replace(/[\s-]/g, "");
    if (diffRecipient && !phoneOk(recipientPhoneVal)) {
      setErr("收件人電話請填 10 碼手機號碼（09 開頭）");
      return;
    }
    if (!noShip && shipEff === "宅配" && (!city || !dist)) {
      setErr("請選擇收件地址的縣市與鄉鎮市區");
      return;
    }
    /* 發票選項驗證（僅站內開票的金流需要） */
    if (selfInvoice && inv === "carrier" && !/^\/[0-9A-Z.+-]{7}$/.test(carrierNo.trim().toUpperCase())) {
      setErr("手機條碼載具格式不對：斜線開頭共 8 碼（例如 /AB12+-.）");
      return;
    }
    if (selfInvoice && inv === "b2b" && !taxIdChecksumOk(taxId.trim())) {
      setErr(/^\d{8}$/.test(taxId.trim()) ? "這組統一編號的檢查碼不對，請再確認一次" : "統一編號請填 8 位數字");
      return;
    }
    /*
     * 捐贈碼查無就擋在這裡。捐贈是不可逆的：放行的話錢會先收，
     * 光貿再退件，系統改開成寄 Email 的發票——客人以為捐了、其實沒捐。
     * 查詢還沒回來（loading）也擋，寧可讓他多等一秒。
     */
    if (selfInvoice && inv === "donate") {
      if (!npobanFormatOk(npoban.trim())) { setErr("捐贈碼是 3 到 7 位數字"); return; }
      if (npoInfo.state === "bad") { setErr(npoInfo.msg || "查不到這個捐贈碼，請確認後再送出"); return; }
      if (npoInfo.state === "loading") { setErr("捐贈碼還在確認中，請稍等一秒再送出"); return; }
    }
    setSubmitting(true);
    setErr("");

    const res = await fetch("/api/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: fd.get("name"),
        phone: phoneVal,
        email: fd.get("email"),
        /* 郵遞區號＋縣市鄉鎮＋街道，一路帶到出貨單與發票 */
        /* 多地址：地址欄留空，實際名單由站長在後台補進 ship_list */
        address: noShip || isMulti ? "" : shipEff === "宅配" ? `${zip} ${city}${dist}${String(fd.get("street") || "").trim()}` : "",
        shipMethod: shipEff,
        storeName: fd.get("store_name"),
        storeNo: fd.get("store_no"),
        /* 沒勾「收件人不是我」就送空字串，後端存空＝同訂購人，舊訂單的行為完全不變 */
        recipientName: diffRecipient ? String(fd.get("recipient_name") || "").trim() : "",
        recipientPhone: diffRecipient ? recipientPhoneVal : "",
        newsletter,
        lineOptin: lineNotify && lineOptin,
        payMethod: pay,
        /* 站內開票（TapPay＋光貿）才收發票選項；PayUni 由其付款頁自行收集 */
        invoiceType: selfInvoice && inv === "b2b" ? "b2b" : "b2c",
        invoiceData: !selfInvoice || inv === "email"
          ? {}
          : inv === "donate"
            ? { npoban: npoban.trim() }
            : inv === "carrier"
              ? { carrierType: "手機條碼", carrierNo: carrierNo.trim().toUpperCase() }
              : { taxId: taxId.trim(), company: company.trim() },
        addon,
        discountCode: discount?.code || "",
        items: lines.map((i) => ({ id: i.id, choice: i.choice, qty: i.qty })),
        payLink: payLink?.token || "",
        /* 純分析用：哪一頁進來的、是不是內建瀏覽器。付款失敗要歸因就靠這兩欄 */
        source: srcPath,
        env: envKind,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      setErr(data.error || "建立訂單失敗");
      setSubmitting(false);
      return;
    }
    if (!payLink) clear();
    if (data.tappay) {
      /* TapPay 站內刷卡：拿 prime → 請款 → 3D 驗證頁或直接完成。
         訂單編號與權杖同時寫進 sessionStorage：購物車在上面已經清空了，
         只存在 React state 的話，顧客一關分頁就找不回這筆待付款訂單，
         得重新把商品加一次，而舊訂單還鎖著庫存。 */
      setPendingOrderNo(data.orderNo);
      setPendingToken(data.token || "");
      saveRetry(data.orderNo, data.token || "");
      await payWithTapPay(data.orderNo, data.token || "");
      return;
    }
    if (data.redirect) {
      /* 後端已經把事辦完（例如 ATM 幕後取號拿到帳號），直接去感謝頁看繳費資訊 */
      window.location.href = data.redirect;
      return;
    }
    if (data.linepay) {
      /* LINE Pay：導去 request 路由建立付款並跳轉 LINE 授權頁 */
      window.location.href = data.linepay;
      return;
    }
    if (data.ecpay) {
      /* 跳轉綠界付款頁（與 PayUni 同一招：自動 POST 隱藏表單） */
      const f = document.createElement("form");
      f.method = "POST";
      f.action = data.ecpay.action;
      for (const [k, v] of Object.entries(data.ecpay.fields as Record<string, string>)) {
        const input = document.createElement("input");
        input.type = "hidden";
        input.name = k;
        input.value = v;
        f.appendChild(input);
      }
      document.body.appendChild(f);
      f.submit();
      return;
    }
    if (data.payuni) {
      /* 跳轉 PayUni 整合支付頁 */
      const f = document.createElement("form");
      f.method = "POST";
      f.action = data.payuni.action;
      for (const [k, v] of Object.entries(data.payuni.fields as Record<string, string>)) {
        const input = document.createElement("input");
        input.type = "hidden";
        input.name = k;
        input.value = v;
        f.appendChild(input);
      }
      document.body.appendChild(f);
      f.submit();
      return;
    }
    if (data.newebpay) {
      /* 跳轉藍新付款頁：跟綠界／PayUni 同一招（自動 POST 隱藏表單） */
      const f = document.createElement("form");
      f.method = "POST";
      f.action = data.newebpay.action;
      for (const [k, v] of Object.entries(data.newebpay.fields as Record<string, string>)) {
        const input = document.createElement("input");
        input.type = "hidden";
        input.name = k;
        input.value = v;
        f.appendChild(input);
      }
      document.body.appendChild(f);
      f.submit();
      return;
    }
    router.push(`/shop/thanks?no=${data.orderNo}${data.token ? `&k=${data.token}` : ""}`);
  }

  return (
    <>
      {/* noValidate：瀏覽器原生的必填氣泡在手機上常常一閃就沒（或根本不出現），
          使用者只覺得按了沒反應。改由下面自己驗：列出缺哪些欄位、標紅、捲過去。 */}
      <form className="box" onSubmit={placeOrder} noValidate>
        <div className="band" />
        <div className="inner">
          <h3 className="f">訂 購 人 資 訊</h3>
          <div className="form-grid">
            <div className="field">
              <label>訂購人（全名） <em>＊</em></label>
              <input type="text" name="name" defaultValue={presets.name} required />
            </div>
            <div className="field">
              <label>電話 <em>＊</em></label>
              <input
                ref={phoneRef}
                className="sans"
                type="tel"
                name="phone"
                defaultValue={presets.phone}
                placeholder="0912345678"
                inputMode="numeric"
                maxLength={10}
                required
                aria-invalid={phoneBad || undefined}
                aria-describedby={phoneBad ? "co-phone-note" : undefined}
                style={phoneBad ? { borderColor: "var(--seal)" } : undefined}
                onBlur={(e) => setPhoneBad(e.target.value.trim() !== "" && !phoneOk(e.target.value))}
                onChange={() => phoneBad && setPhoneBad(false)}
              />
              {phoneBad && (
                <p id="co-phone-note" className="field-err">
                  請填 10 碼手機號碼，09 開頭（例如 0912345678）。物流通知會發到這支號碼。
                </p>
              )}
            </div>
            <div className="field full">
              <EmailField
                defaultValue={presets.email}
                label={<label>Email <em>＊</em>（寄送訂單確認與發票）</label>}
              />
            </div>
            {/* 收件人不是訂購人本人：企業付款連結、免寄送的服務費都不適用，維持原本各自的流程 */}
            {!payLink && !noShip && (
              <div className="field full">
                <div className="soft-chk">
                  <input
                    type="checkbox"
                    checked={diffRecipient}
                    onChange={(e) => setDiffRecipient(e.target.checked)}
                    aria-label="收件人不是我（寄給別人）"
                  />
                  <span>收件人不是我（寄給別人）</span>
                </div>
              </div>
            )}
            {!payLink && !noShip && diffRecipient && (
              <>
                <div className="field">
                  <label>收件人姓名 <em>＊</em></label>
                  <input type="text" name="recipient_name" required />
                </div>
                <div className="field">
                  <label>收件人電話 <em>＊</em></label>
                  <input className="sans" type="tel" name="recipient_phone" placeholder="0912345678" inputMode="numeric" maxLength={10} required />
                </div>
              </>
            )}
            {/* 收服務費那種沒有貨要寄，整塊物流與地址不該出現 */}
            {!noShip && <div className="field full">
              <label>取貨方式 <em>＊</em></label>
              {/* 超商排前面（多數人選它、也是預設），一排排完，運費另起一行（站長 2026-09-03） */}
              <div className="radio-row ship-row">
                {!cvsMixed && (
                  <span className={`r${shipEff === "711" ? " on" : ""}`} onClick={() => setShip("711")}>{cvsBrand} 店到店<small>{cvsQuote.total > 0 ? `運費 $${cvsQuote.total}` : "免運"}</small></span>
                )}
                {cvsMixed && (
                  <span className="r" style={{ opacity: 0.5, cursor: "not-allowed" }}>店到店<small>這單含不同超商通路</small></span>
                )}
                <span className={`r${shipEff === "宅配" ? " on" : ""}`} onClick={() => setShip("宅配")}>宅配到府<small>{homeQuote.total > 0 ? `運費 $${homeQuote.total}` : "免運"}</small></span>
                {allowMulti && (
                  <span className={`r${isMulti ? " on" : ""}`} onClick={() => setShip(MULTI_SHIP)}>寄到多個地址<small>付款後聯繫</small></span>
                )}
              </div>
              {isMulti && (
                <p className="fine" style={{ marginTop: 10, lineHeight: 1.9 }}>
                  這裡不用填地址，直接完成結帳就好。付款完成後我們會與你聯繫，
                  收齊每一位收件人的姓名、電話、地址與盒數之後再安排出貨，每一批寄出都會通知你。
                </p>
              )}
            </div>}
            {noShip || isMulti ? null : shipEff === "宅配" ? (
              <div className="field full">
                <label>收件地址 <em>＊</em>（宅配・{tempLabel}）</label>
                <div className="addr-row">
                  <select value={city} onChange={(e) => { setCity(e.target.value); setDist(""); }} required aria-label="縣市">
                    <option value="">縣市</option>
                    {TW_COUNTIES.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                  <select value={dist} onChange={(e) => setDist(e.target.value)} required disabled={!city} aria-label="鄉鎮市區">
                    <option value="">{city ? "鄉鎮市區" : "先選縣市"}</option>
                    {Object.keys(TW_ZIP[city] || {}).map((d) => <option key={d} value={d}>{d}</option>)}
                  </select>
                  {/* 郵遞區號排最後（站長 2026-09-04：縣市、鄉鎮、郵遞區號） */}
                  <input className="sans addr-zip" value={zip} readOnly placeholder="郵遞區號" aria-label="郵遞區號" tabIndex={-1} />
                  
                </div>
                <input type="text" name="street" defaultValue={presets.address} placeholder="路街巷弄號樓" required style={{ marginTop: 10 }} />
              </div>
            ) : (
              <>
                <div className="field">
                  <label>
                    取貨門市名稱 <em>＊</em>　
                    {/* 門市查詢連結與範例跟著品牌走：填錯超商就是寄不到 */}
                    <a
                      href={storeHint(cvsBrand).site}
                      target="_blank" rel="noopener"
                      style={{ fontSize: 12.5, textDecoration: "underline", textUnderlineOffset: 3 }}
                    >查 {cvsBrand} 門市 ↗</a>
                  </label>
                  <p className="fine" style={{ margin: "0 0 6px", color: "var(--seal)" }}>
                    這筆訂單走 <b>{cvsBrand}</b>，請填 {cvsBrand} 的門市，填成其他超商會寄不到。
                  </p>
                  <input type="text" name="store_name" placeholder={storeHint(cvsBrand).name} required />
                </div>
                <div className="field">
                  <label>門市店號 <em>＊</em>（6 位數字，門市查詢頁上有）</label>
                  <input className="sans" type="text" name="store_no" placeholder="例如：123456" required />
                </div>
              </>
            )}
          </div>

          <h3 className="f">電 子 發 票</h3>
          {selfInvoice ? (
            <>
              {/* 四選項固定順序：捐發票 → 存信箱 → 存載具 → 打統編。
                  手機上兩欄兩列（inv-row），橫向捲的話「打統編」會被捲出畫面，
                  而企業客戶找不到統編欄位是會直接關掉的 */}
              <div className="radio-row inv-row">
                <span className={`r${inv === "donate" ? " on" : ""}`} onClick={() => setInv("donate")}>捐發票</span>
                <span className={`r${inv === "email" ? " on" : ""}`} onClick={() => setInv("email")}>存信箱</span>
                <span className={`r${inv === "carrier" ? " on" : ""}`} onClick={() => setInv("carrier")}>存載具</span>
                <span className={`r${inv === "b2b" ? " on" : ""}`} onClick={() => setInv("b2b")}>打統編</span>
              </div>
              {inv === "donate" && (
                <>
                  {/* 站長自己寫的一句。放在選項正下方：既然預設就選好了，
                      客人第一眼最需要知道的是「為什麼」 */}
                  <p className="fine" style={{ margin: "10px 0 0", lineHeight: 1.95 }}>
                    捐贈發票，可以捐給家扶基金會，我從小受家扶照顧。或者填入你想捐的單位
                  </p>
                  <div className="field" style={{ marginTop: 10, maxWidth: 340 }}>
                    <label>捐贈碼 <em>＊</em></label>
                    <input
                      className="sans"
                      value={npoban}
                      onChange={(e) => setNpoban(e.target.value.replace(/\D/g, "").slice(0, 7))}
                      inputMode="numeric"
                      placeholder="8585"
                      maxLength={7}
                      aria-describedby="npo-note"
                    />
                  </div>
                  {/* 捐贈不可逆，所以受贈單位要在按下付款之前就顯示出來 */}
                  <p id="npo-note" className={npoInfo.state === "bad" ? "field-err" : "fine"} style={{ margin: "6px 0 0", lineHeight: 1.9 }}>
                    {npoInfo.state === "ok" ? <>將捐給 <b>{npoInfo.name}</b></>
                      : npoInfo.state === "loading" ? "查詢中…"
                      : npoInfo.state === "bad" ? npoInfo.msg
                      : "\u00a0"}
                  </p>
                </>
              )}
              {inv === "carrier" && (
                <div className="field" style={{ marginTop: 12, maxWidth: 340 }}>
                  <label>手機條碼 <em>＊</em>（斜線開頭共 8 碼）</label>
                  <input className="sans" value={carrierNo} onChange={(e) => setCarrierNo(e.target.value)} placeholder="/AB12CD3" maxLength={8} />
                </div>
              )}
              {inv === "b2b" && (
                <>
                  <div className="form-grid" style={{ marginTop: 12 }}>
                    <div className="field">
                      <label>統一編號 <em>＊</em>（8 碼）</label>
                      <input className="sans" value={taxId} onChange={(e) => setTaxId(e.target.value.replace(/\D/g, "").slice(0, 8))} placeholder="88528295" inputMode="numeric" maxLength={8} aria-describedby="tax-note" />
                    </div>
                    <div className="field">
                      <label>公司抬頭（選填，未填以統編開立）</label>
                      <input
                        value={company}
                        onChange={(e) => { companyTouched.current = true; setCompany(e.target.value); }}
                        placeholder="例如：於悅商行"
                      />
                    </div>
                  </div>
                  {/* 光貿只驗檢查碼、不驗存不存在，所以這段查詢是唯一會發現打錯的地方。
                      但查不到不擋——財團法人、學校、機關不在經濟部商工登記裡 */}
                  <p id="tax-note" className={taxInfo.state === "bad" ? "field-err" : "fine"} style={{ margin: "6px 0 0", lineHeight: 1.9 }}>
                    {taxInfo.state === "ok" ? <>經濟部登記名稱：<b>{taxInfo.name}</b>（{taxInfo.msg}）　抬頭已幫你帶入，<b>請確認是否正確</b>，可以自己改。</>
                      : taxInfo.state === "loading" ? "查詢中…"
                      : taxInfo.state === "warn" ? <span style={{ color: "var(--seal)" }}>{taxInfo.msg}</span>
                      : taxInfo.state === "bad" ? taxInfo.msg
                      : "\u00a0"}
                  </p>
                </>
              )}
              <p className="fine" style={{ marginTop: 10 }}>
                {inv === "donate"
                  ? "發票由本站依法開立，並填入你指定的捐贈碼。"
                  : "發票由本站依法開立，寄至你填寫的 Email，中獎會另行通知。"}
              </p>
              {/* 站長出的 5%，跟客人捐的發票，是兩件事。不講清楚客人會以為是同一件 */}
              {inv === "donate" && (
                <p className="fine" style={{ marginTop: 6, lineHeight: 1.9 }}>
                  這與商品頁的「提撥 5% 兒童永續教育」是兩件事：5% 是我們出的，發票是你的。
                </p>
              )}
            </>
          ) : (
            /* 跳轉付款的發票資訊由 PayUni 付款頁收集（UPP 無法由本站預帶載具），
                這裡不重複詢問，避免消費者填了卻沒被使用 */
            <p className="fine" style={{ marginTop: 0 }}>
              電子發票由 PayUni 統一金流開立，前往付款時可在付款頁選擇手機條碼載具、自然人憑證、捐贈或公司統編。
            </p>
          )}

          <h3 className="f">付 款 方 式</h3>
          <InAppWarn envKind={envKind} />
          <div className="radio-row pay-row">
            {payList.filter((p) => p !== "多元支付").map((p) => (
              <span key={p} className={`r pay-stack${pay === p ? " on" : ""}`} onClick={() => setPay(p)}>
                {/* 直排：圖示在上、名稱在下，與贊助頁同款；LINE Pay 的圖示本身就是組合字，不再重複文字 */}
                <PayChip name={p} stack />{p === "LINE Pay" ? null : <span className="pay-lab">{p}</span>}
              </span>
            ))}
          </div>
          {/* 多元支付：跟贊助頁同一個長條，五個錢包圖示一排（站長 2026-09-03） */}
          {payList.includes("多元支付") && (
            <div className={`pay multi${pay === "多元支付" ? " on" : ""}`} onClick={() => setPay("多元支付")}>
              <b>多元支付</b>
              <span className="wallets">
                {TWQR_WALLETS.map((w) => (
                  <span key={w} className="wallet"><PayChip name={w} bare />{w}</span>
                ))}
              </span>
            </div>
          )}

          {/* TapPay 站內刷卡：卡號在本頁輸入（TapPay iframe），不跳轉 */}
          {tappayCard && tappay && (
            <TapPayCard
              appId={tappay.appId}
              appKey={tappay.appKey}
              sandbox={tappay.sandbox}
              onReady={setCardReady}
              handleRef={tpRef}
            />
          )}
          {tappayCard && !tappay && (
            <p className="fine" style={{ marginTop: 10, color: "var(--seal)" }}>
              信用卡金流啟用作業中，暫時無法結帳；急用請來信 hi@wensong.tw。
            </p>
          )}

          {/* 加購贊助（贊助功能暫停時整塊隱藏） */}
          {showAddon && (
            <div className="addon-box">
              <p className="lead"><Highlight text={addonPitch} bold /></p>
              <div className="addon-grid">
                <span className={`a${addon === 0 && !addonCustom ? " on" : ""}`} onClick={() => { setAddon(0); setAddonCustom(false); setAddonInput(""); }}>不加購</span>
                {addonTiers.map((t) => (
                  <span key={t} className={`a${addon === t && !addonCustom ? " on" : ""}`} onClick={() => { setAddon(t); setAddonCustom(false); setAddonInput(""); }}>
                    {dollar(t)}
                  </span>
                ))}
                <span className={`a${addonCustom ? " on" : ""}`} onClick={() => { setAddonCustom(true); setAddon(Math.max(0, Math.floor(Number(addonInput)) || 0)); }}>
                  自訂金額
                </span>
              </div>
              {addonCustom && (
                <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 10 }}>
                  <span style={{ fontSize: 14 }}>NT$</span>
                  <input
                    className="sans"
                    type="number"
                    min={1}
                    max={100000}
                    inputMode="numeric"
                    placeholder="輸入金額"
                    value={addonInput}
                    onChange={(e) => {
                      setAddonInput(e.target.value);
                      const n = Math.floor(Number(e.target.value));
                      setAddon(Number.isFinite(n) && n > 0 ? Math.min(n, 100000) : 0);
                    }}
                    style={{ width: 140, border: "2px solid var(--ink)", background: "#FFFDF6", padding: "8px 10px", fontSize: 15 }}
                  />
                  <span className="fine" style={{ margin: 0 }}>金額由你決定，會與訂單一起開立發票</span>
                </div>
              )}
            </div>
          )}

          {/* 連結型結帳不吃折扣碼：談好的價格本來就是折扣，
              再疊一次是重複折讓，而看得到欄位的人就是會試 */}
          {!payLink && <><h3 className="f" style={{ marginTop: 28 }}>折 扣 碼</h3>
          <div className="discount-row">
            <input
              type="text"
              value={codeInput}
              onChange={(e) => setCodeInput(e.target.value)}
              placeholder="有折扣碼請輸入（不分大小寫）"
            />
            <button type="button" onClick={applyCode}>套用</button>
          </div>
          {discount && <p className="discount-ok">✓ 已套用「{discount.code}」：{discount.label}</p>}
          {codeErr && <p className="discount-err">{codeErr}</p>}</>}

          {/* 金額明細 */}
          <div className="totals">
            <div className="row"><span>小計</span><span className="sans">{money(subtotal)}</span></div>
            {discountAmt > 0 && (
              <div className="row" style={{ color: "var(--indigo)" }}>
                <span>折扣（{discount?.code}）</span><span className="sans">− {money(discountAmt)}</span>
              </div>
            )}
            {addon > 0 && (
              <div className="row" style={{ color: "var(--seal)" }}>
                <span>額外贊助 ♥</span><span className="sans">{money(addon)}</span>
              </div>
            )}
            {/* 單一包裹照舊一行；多包裹逐組列（哪個出貨地、什麼溫層、免運與否一目了然） */}
            {!noShip && !multiParcel && <div className="row">
              <span>運費（{shipEff === "711" ? `${cvsBrand} 店到店` : isMulti ? "多地址配送" : freight.groups[0]?.temp === "cold" ? "低溫宅配" : "常溫宅配"}{shipping === 0 && subtotal > 0 ? (discount?.kind === "freeship" ? "・折扣碼免運" : `・滿 ${freeAtOf(freight.groups[0]).toLocaleString()} 免運`) : ""}）</span>
              <span className="sans">{money(shipping)}</span>
            </div>}
            {!noShip && multiParcel && freight.groups.map((g, i) => (
              <div className="row" key={`${g.origin}-${g.temp}`}>
                <span>運費・包裹{["一", "二", "三", "四", "五", "六"][i] || i + 1}（{g.originName}{g.temp === "cold" ? "・低溫" : ""}{g.free ? (discount?.kind === "freeship" ? "・折扣碼免運" : `・滿 ${freeAtOf(g).toLocaleString()} 免運`) : ""}）</span>
                <span className="sans">{money(g.fee)}</span>
              </div>
            ))}
            {!noShip && multiParcel && (
              <p className="fine" style={{ margin: "4px 0 0", textAlign: "right", lineHeight: 1.9 }}>
                你的訂單會由不同出貨地分別寄出，包裹會分批送達，每一批都有出貨通知。
              </p>
            )}
            <div className="row grand"><span>總金額</span><span className="sans">{money(total)}</span></div>
            {/* 金流審核要求（一）：交易金額幣別與含稅之明示 */}
            <p className="fine" style={{ marginTop: 8, textAlign: "right" }}>本站標價均為新臺幣（TWD）含稅價</p>
          </div>

          {/* 新品通知訂閱：預設勾選、文字明講隨時可取消（不勾就不收） */}
          {/* 站長 2026-09-04：灰框透明底灰勾、跟文字同高；不用 label 包，只有按方框本身才切換 */}
          <div className="soft-chk" style={{ marginTop: 20 }}>
            <input type="checkbox" checked={newsletter} onChange={(e) => setNewsletter(e.target.checked)} aria-label="用 Email 收通知" />
            <span>有抽獎用 Email 收到通知，也收到新消息</span>
          </div>
          {lineNotify && (
            <div className="soft-chk" style={{ marginTop: 10 }}>
              <input type="checkbox" checked={lineOptin} onChange={(e) => setLineOptin(e.target.checked)} aria-label="用 LINE 收通知" />
              <span>如有發票中獎通知、出貨與付款、新消息等等，使用 LINE 收到通知</span>
            </div>
          )}

          {err && <p className="msg-err" style={{ marginTop: 18 }}>{err}</p>}
          <div className="center" style={{ marginTop: 26 }}>
            <button id="checkout-submit" className="btn fill" type="submit" disabled={submitting || (tappayCard && !cardReady)}>
              {submitting ? "處理中…" : isTappay ? "確認" : "前往結帳"}
            </button>
          </div>
          {isTappay ? (
            <p className="fine center" style={{ marginTop: 16 }}>
              付款由 TapPay（喬睿科技）金流處理，本站不經手也不儲存你的卡號
            </p>
          ) : gateway === "ecpay" ? (
            <p className="fine center" style={{ marginTop: 16 }}>
              付款由綠界科技（ECPay）／LINE Pay 加密處理，本站不經手也不儲存你的卡號
            </p>
          ) : gateway === "newebpay" ? (
            <p className="fine center" style={{ marginTop: 16 }}>
              付款由藍新科技（NewebPay）加密處理，本站不經手也不儲存你的卡號
            </p>
          ) : (
            <p className="fine center" style={{ marginTop: 16 }}>
              付款由 PayUni 統一金流處理，本站不儲存你的卡號
            </p>
          )}
        </div>
        <div className="band" />
      </form>
    </>
  );
}
