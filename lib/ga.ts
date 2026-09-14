/*
 * GA4 Measurement Protocol：伺服器端直接回報事件。
 * 用在「付款完成」這類發生在伺服器、瀏覽器不一定在場的轉換
 * （ATM 入帳、定期扣款、被瀏覽器擋掉追蹤器的情況全都涵蓋）。
 *
 * 需要環境變數 GA_API_SECRET（GA 後台 → 管理 → 資料串流 → 官網 →
 * Measurement Protocol API 密鑰 → 建立）。未設定時自動略過並記 log，不影響主流程。
 */

/* 與 components/Analytics.tsx 相同的評估 ID（公開資訊，非機密） */
const GA_ID = "G-KHVHFQ1DFP";

/* 從 _ga cookie 取出 client_id（格式 GA1.1.1610744124.1753399224 → 1610744124.1753399224），
   讓伺服器端事件能歸因回訪客原本的工作階段與流量來源 */
export function gaClientIdFromCookie(raw: string | undefined | null): string {
  if (!raw) return "";
  const parts = String(raw).split(".");
  return parts.length >= 4 ? parts.slice(-2).join(".") : "";
}

/*
 * 從 _ga_<容器 ID> cookie 取出 session_id 與 session_number。
 *
 * 這個 cookie 有兩種格式，兩種都要吃：
 *
 *   GS1（舊）  GS1.1.1753399224.3.1.1753399300.0.0.0
 *                    ^sid       ^snum          固定位置取值，以 . 分隔
 *
 *   GS2（新）  GS2.1.s1786660916$o3$g0$t1786660916$j60$l0$h0
 *                    ^sid        ^snum           鍵值對，以 $ 分隔，前綴表意義
 *                    s=session id、o=session number、t=時間戳
 *
 * Google 在 2025 年 5 月未公告就把格式換成 GS2。原本這裡只寫了 GS1 的固定位置解法，
 * 遇到 GS2 會在「至少四段」那一關就回傳空字串，於是 ga_sid 一路存成空值，
 * Measurement Protocol 事件沒帶 session_id，GA4 併不進任何工作階段，
 * 報表的「工作階段來源」全部變成 (not set)。
 *
 * 判斷用「第三段有沒有 $」而不是比對 GS2 這個版本字串：真正決定怎麼解析的是分隔符，
 * 將來若出現 GS3 但沿用鍵值對，這裡不必再改一次。
 */
export const GA_SESSION_COOKIE = `_ga_${GA_ID.replace(/^G-/, "")}`;

export function gaSessionFromCookie(raw: string | undefined | null): { sid: string; snum: string } {
  if (!raw) return { sid: "", snum: "" };
  const parts = String(raw).split(".");
  if (parts.length < 3) return { sid: "", snum: "" };

  const ok = (sid: string, snum: string) =>
    /^\d+$/.test(sid) ? { sid, snum: /^\d+$/.test(snum) ? snum : "1" } : { sid: "", snum: "" };

  /* GS2：第三段之後是 $ 分隔的鍵值對。用 slice(2).join(".") 接回來，
     萬一值裡本身含有點也不會被切掉。 */
  if (parts[2].includes("$")) {
    let sid = "";
    let snum = "";
    for (const seg of parts.slice(2).join(".").split("$")) {
      /* 嚴格比對「單一前綴字母＋純數字」，避免把 s 開頭的其他鍵誤認成 session id */
      const s = /^s(\d+)$/.exec(seg);
      if (s && !sid) { sid = s[1]; continue; }
      const o = /^o(\d+)$/.exec(seg);
      if (o && !snum) snum = o[1];
    }
    return ok(sid, snum);
  }

  /* GS1：固定位置，至少要有 GS1.1.<sid>.<snum> 四段 */
  if (parts.length < 4) return { sid: "", snum: "" };
  return ok(parts[2] || "", parts[3] || "");
}

/* 商店訂單付款完成 → GA4 標準 purchase 事件（帶品項明細，之後可用 GA 電商報表） */
export function gaPurchaseEvent(order: {
  ga_cid?: string | null;
  ga_sid?: string | null;
  ga_snum?: string | null;
  order_no: string;
  total: number;
  shipping: number;
  items: string;
}): void {
  let items: { item_id: string; item_name: string; item_variant?: string; price: number; quantity: number }[] = [];
  try {
    const parsed = JSON.parse(order.items || "[]") as { id: number; name: string; choice: string | null; price: number; qty: number }[];
    items = parsed.map((i) => ({
      item_id: String(i.id),
      item_name: i.name,
      ...(i.choice ? { item_variant: i.choice } : {}),
      price: i.price,
      quantity: i.qty,
    }));
  } catch {}
  gaServerEvent(order.ga_cid, "purchase", {
    transaction_id: order.order_no,
    value: order.total,
    currency: "TWD",
    shipping: order.shipping,
    items,
  }, { sid: order.ga_sid, snum: order.ga_snum });
}

/* 後台「送 GA 測試事件」用：等結果回來並回報成敗，順便驗證密鑰設定是否正確。
   GA 的 /debug/mp/collect 會回傳驗證訊息（不會真的記錄），先用它檢查格式與密鑰，
   通過後再送一筆真事件，讓事件名出現在 GA 清單裡可以標記為重要事件。 */
export async function gaTestEvent(name: string, params: Record<string, unknown>): Promise<{ ok: boolean; msg: string }> {
  const secret = process.env.GA_API_SECRET || "";
  if (!secret) return { ok: false, msg: "GA_API_SECRET 未設定（請到主機的環境變數新增後重新部署）" };
  const cid = `${Math.floor(Math.random() * 1e9)}.${Math.floor(Date.now() / 1000)}`;
  const body = JSON.stringify({
    client_id: cid,
    events: [{ name, params: { ...params, engagement_time_msec: 100 } }],
  });
  const url = (base: string) => `${base}?measurement_id=${GA_ID}&api_secret=${encodeURIComponent(secret)}`;
  try {
    const dbg = await fetch(url("https://www.google-analytics.com/debug/mp/collect"), { method: "POST", body, signal: AbortSignal.timeout(15_000) });
    const j = (await dbg.json().catch(() => ({}))) as { validationMessages?: { description?: string }[] };
    const bad = j.validationMessages?.[0]?.description;
    if (bad) return { ok: false, msg: `GA 退回：${bad}` };
    const r = await fetch(url("https://www.google-analytics.com/mp/collect"), { method: "POST", body, signal: AbortSignal.timeout(15_000) });
    if (!r.ok) return { ok: false, msg: `送出失敗（HTTP ${r.status}），請確認密鑰是否正確` };
    return { ok: true, msg: `已送出 ${name}` };
  } catch (e) {
    return { ok: false, msg: `連線失敗：${e instanceof Error ? e.message : "unknown"}` };
  }
}

export function gaServerEvent(
  clientId: string | null | undefined,
  name: string,
  params: Record<string, unknown>,
  session?: { sid?: string | null; snum?: string | null }
): void {
  const secret = process.env.GA_API_SECRET || "";
  if (!secret) {
    console.log(`[ga skip - GA_API_SECRET 未設定] ${name}`, JSON.stringify(params));
    return;
  }
  /* 沒抓到訪客 cid 時用隨機 id：事件照樣計數，只是來源歸為 direct */
  const cid = clientId || `${Math.floor(Math.random() * 1e9)}.${Math.floor(Date.now() / 1000)}`;
  /* 帶上 session_id 才能併回訪客原本的工作階段，否則報表的來源會是 (not set) */
  const sessionParams: Record<string, unknown> = session?.sid
    ? { session_id: session.sid, session_number: Number(session.snum || 1) }
    : {};
  void fetch(`https://www.google-analytics.com/mp/collect?measurement_id=${GA_ID}&api_secret=${encodeURIComponent(secret)}`, {
    method: "POST",
    body: JSON.stringify({
      client_id: cid,
      events: [{ name, params: { ...params, ...sessionParams, engagement_time_msec: 100 } }],
    }),
  })
    .then((r) => {
      if (!r.ok) console.error(`[ga] HTTP ${r.status} ${name}`);
      else console.log(`[ga sent] ${name}`, JSON.stringify(params));
    })
    .catch((e) => console.error("[ga]", e));
}
