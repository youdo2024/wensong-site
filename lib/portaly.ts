import crypto from "crypto";
import { getSetting, setSetting } from "./db";
import { payItemName } from "./item-name";

/*
 * Portaly Payment 串接（贊助專用；商店金流仍走 PayUni）
 * 規格對照官方 skill（github.com/portaly-ai/portaly-skills → portaly-payment v0.5.5）：
 *  - Bearer 認證，金鑰 pcs_live_* / pcs_test_*（模式由金鑰決定）
 *  - 每月定額＝fixed monthly plan；單筆＝dynamic one-time plan（金額開 session 時帶）
 *  - 回呼驗簽：HMAC-SHA256(secret, `${timestamp}.${stableJson(payload)}`)，鍵以 localeCompare 排序
 *  - 目前實作約定：subscriptionId === sessionId
 */

export const PORTALY_HOST = process.env.PORTALY_API_HOST || "https://portaly.ai";

function apiKey(): string {
  return (process.env.PORTALY_API_KEY || "").trim();
}

export function portalyEnabled(): boolean {
  return apiKey().startsWith("pcs_") && Boolean((process.env.PORTALY_CALLBACK_SECRET || "").trim());
}

export function portalyTestMode(): boolean {
  return apiKey().startsWith("pcs_test_");
}

async function callPortaly(
  path: string,
  init?: { method?: string; body?: Record<string, unknown> }
): Promise<{ ok: boolean; status: number; data: Record<string, unknown>; error: string; code: string }> {
  const res = await fetch(`${PORTALY_HOST}/api/creator-subscription${path}`, {
    method: init?.method || "GET",
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
    },
    ...(init?.body ? { body: JSON.stringify(init.body) } : {}),
    signal: AbortSignal.timeout(30_000),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return {
    ok: res.ok,
    status: res.status,
    data: (json.data as Record<string, unknown>) || {},
    error: String(json.error || ""),
    code: String(json.code || ""),
  };
}

/* ── 方案自動建置：需要時查既有方案（merchantPlanId 比對），沒有才建立，plan id 存 settings 快取 ── */

type PlanRow = { id: string; merchantPlanId?: string; status: string };

async function findPlanByMerchantId(merchantPlanId: string): Promise<string> {
  const res = await callPortaly("/plans");
  if (!res.ok) return "";
  const plans = (res.data as unknown as PlanRow[] | undefined) || [];
  const list = Array.isArray(plans) ? plans : [];
  const hit = list.find((p) => p.merchantPlanId === merchantPlanId && p.status === "active");
  return hit?.id || "";
}

async function ensurePlan(opts: {
  cacheKey: string;
  merchantPlanId: string;
  name: string;
  description: string;
  billingPeriod: "monthly" | "one-time";
  amount?: number;
}): Promise<string> {
  const cached = getSetting(opts.cacheKey, "");
  if (cached) return cached;

  let planId = await findPlanByMerchantId(opts.merchantPlanId);
  if (!planId) {
    const res = await callPortaly("/plans", {
      method: "POST",
      body: {
        name: opts.name,
        description: opts.description,
        currency: "TWD",
        billingPeriod: opts.billingPeriod,
        status: "active",
        merchantPlanId: opts.merchantPlanId,
        ...(opts.billingPeriod === "one-time"
          ? { pricingType: "dynamic" }
          : { pricingType: "fixed", amount: opts.amount }),
      },
    });
    if (!res.ok) throw new Error(`Portaly 建立方案失敗：${res.code || res.error}`);
    planId = String(res.data.id || "");
  }
  if (!planId) throw new Error("Portaly 方案 id 取得失敗");
  setSetting(opts.cacheKey, planId);
  return planId;
}

/* 單筆贊助：動態金額的一次性方案（共用一個） */
export async function ensureOncePlan(): Promise<string> {
  return ensurePlan({
    cacheKey: "portaly_plan_once",
    merchantPlanId: "yo-support-once",
    name: payItemName("once"),
    description: "一次性支持「問爽的」Podcast 的節目內容，金額自訂",
    billingPeriod: "one-time",
  });
}

/* 每月定額：每個金額一個固定方案 */
export async function ensureMonthlyPlan(amount: number): Promise<string> {
  return ensurePlan({
    cacheKey: `portaly_plan_monthly_${amount}`,
    merchantPlanId: `yo-support-monthly-${amount}`,
    name: `${payItemName("monthly")} NT$${amount.toLocaleString()}`,
    description: "每月自動支持「問爽的」Podcast 的節目內容，隨時可取消",
    billingPeriod: "monthly",
    amount,
  });
}

/* ── 結帳 session ── */

export async function createCheckoutSession(opts: {
  planId: string;
  amount?: number;
  merchantOrderNumber: string;
  metadata?: Record<string, string>;
  successRedirectUrl: string;
  cancelRedirectUrl: string;
  callbackUrl: string;
}): Promise<{ sessionId: string; checkoutUrl: string }> {
  const res = await callPortaly("/checkout-sessions", {
    method: "POST",
    body: {
      planId: opts.planId,
      ...(opts.amount ? { amount: opts.amount } : {}),
      merchantOrderNumber: opts.merchantOrderNumber,
      ...(opts.metadata ? { metadata: opts.metadata } : {}),
      successRedirectUrl: opts.successRedirectUrl,
      cancelRedirectUrl: opts.cancelRedirectUrl,
      callbackUrl: opts.callbackUrl,
    },
  });
  if (!res.ok) throw new Error(`Portaly 建立結帳失敗：${res.code || res.error}`);
  const sessionId = String(res.data.sessionId || "");
  const checkoutUrl = String(res.data.checkoutUrl || "");
  if (!sessionId || !checkoutUrl) throw new Error("Portaly 回應缺少 sessionId 或 checkoutUrl");
  return { sessionId, checkoutUrl };
}

/* ── 訂閱取消（信中「停止贊助」連結用） ── */

export async function cancelSubscription(subscriptionId: string): Promise<boolean> {
  const res = await callPortaly(`/subscriptions/${subscriptionId}/cancel`, {
    method: "POST",
    body: { reason: "customer_requested", reasonNote: "贊助者透過信件連結自行取消" },
  });
  return res.ok;
}

/* ── 回呼驗簽（照官方 sign_callback.mjs，鍵排序必須用 localeCompare） ── */

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((v) => stableJson(v)).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function verifyPortalyCallback(payload: unknown, timestamp: string, signature: string): boolean {
  const secret = (process.env.PORTALY_CALLBACK_SECRET || "").trim();
  if (!secret || !timestamp || !signature) return false;
  /* 逾時 5 分鐘的回呼一律拒收（防重放；timestamp 為 ISO 字串） */
  const ts = Date.parse(timestamp);
  if (!Number.isFinite(ts) || Math.abs(Date.now() - ts) > 5 * 60 * 1000) return false;
  const expected = crypto
    .createHmac("sha256", secret)
    .update(`${timestamp}.${stableJson(payload)}`)
    .digest("hex");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(signature, "utf8");
  return a.byteLength === b.byteLength && crypto.timingSafeEqual(a, b);
}
