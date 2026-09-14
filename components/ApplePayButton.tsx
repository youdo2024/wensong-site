"use client";
import { useEffect, useState } from "react";

/*
 * Apple Pay 幕後支付按鈕：只在 window.ApplePaySession 且 canMakePayments() 為真時渲染
 * （呼叫端通常已經先濾過一次付款方式清單，這裡是最後一道保險：不渲染一顆按不動的
 * 按鈕，比渲染出來又失敗更乾淨）。
 *
 * 目前後端 /api/newebpay/applepay/pay（與 /session）一律回「尚未開放」——藍新沒有公開
 * Apple Pay 幕後支付 API 的技術文件，查證細節見 lib/newebpay-applepay.ts 開頭的長註解。
 * 也就是說按下這顆按鈕，Apple Pay 授權流程會正常跑起來（Face ID／Touch ID 都會出現），
 * 但最後一步一定會失敗並顯示訊息，不會假裝扣款成功。先把殼做好，等站長跟藍新拿到
 * 串接文件、lib/newebpay-applepay.ts 換成真正的實作之後，這支元件不用改。
 *
 * 樣式：Apple 官方規定 Apple Pay 按鈕要用 -webkit-appearance:-apple-pay-button，
 * 定義在 app/podcast.css 的 .apple-pay-button（React 的 style 物件無法可靠傳遞這種
 * 瀏覽器專屬的自訂外觀屬性，所以走 CSS class 而不是 inline style）。
 */
type ApplePayPaymentPayload = { token: unknown };
type ApplePayValidateMerchantEvent = { validationURL: string };
type ApplePayPaymentAuthorizedEvent = { payment: ApplePayPaymentPayload };

type ApplePaySessionInstance = {
  begin: () => void;
  abort: () => void;
  completeMerchantValidation: (session: unknown) => void;
  completePayment: (status: number) => void;
  onvalidatemerchant: ((event: ApplePayValidateMerchantEvent) => void) | null;
  onpaymentauthorized: ((event: ApplePayPaymentAuthorizedEvent) => void) | null;
  oncancel: (() => void) | null;
};

type ApplePaySessionCtor = {
  new (version: number, request: Record<string, unknown>): ApplePaySessionInstance;
  canMakePayments?: () => boolean;
  STATUS_SUCCESS: number;
  STATUS_FAILURE: number;
};

function getApplePaySessionCtor(): ApplePaySessionCtor | null {
  const w = window as unknown as { ApplePaySession?: ApplePaySessionCtor };
  return w.ApplePaySession || null;
}

export default function ApplePayButton({
  kind,
  id,
  token,
  amount,
  label,
  onFail,
}: {
  /* order＝商店訂單（id 是訂單編號）；sponsor＝贊助（id 是贊助 id 字串） */
  kind: "order" | "sponsor";
  id: string;
  /* 建單時拿到的權杖（orders.token 或 sponsorships.pay_token），/pay 會驗這個 */
  token: string;
  amount: number;
  /* Apple Pay 付款面板顯示的品項名稱 */
  label: string;
  onFail?: (message: string) => void;
}) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      const Ctor = getApplePaySessionCtor();
      setReady(Boolean(Ctor && Ctor.canMakePayments && Ctor.canMakePayments()));
    } catch {
      setReady(false);
    }
  }, []);

  if (!ready) return null;

  function start() {
    const Ctor = getApplePaySessionCtor();
    if (!Ctor) {
      onFail?.("此裝置不支援 Apple Pay，請改用其他付款方式");
      return;
    }
    const request = {
      countryCode: "TW",
      currencyCode: "TWD",
      supportedNetworks: ["visa", "masterCard", "amex", "jcb"],
      merchantCapabilities: ["supports3DS"],
      total: { label, amount: amount.toFixed(2) },
    };
    let session: ApplePaySessionInstance;
    try {
      session = new Ctor(3, request);
    } catch {
      onFail?.("Apple Pay 無法啟動，請改用其他付款方式");
      return;
    }

    session.onvalidatemerchant = async (event) => {
      try {
        const res = await fetch("/api/newebpay/applepay/session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ validationURL: event.validationURL }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "Apple Pay 驗證失敗");
        session.completeMerchantValidation(data);
      } catch (e) {
        session.abort();
        onFail?.(e instanceof Error ? e.message : "Apple Pay 尚未開放，請改用其他付款方式");
      }
    };

    session.onpaymentauthorized = async (event) => {
      try {
        const res = await fetch("/api/newebpay/applepay/pay", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ kind, id, token, paymentToken: event.payment.token }),
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok && data.ok) {
          session.completePayment(Ctor.STATUS_SUCCESS);
          if (data.redirect) window.location.href = data.redirect;
        } else {
          session.completePayment(Ctor.STATUS_FAILURE);
          onFail?.(data.error || "付款失敗，請改用其他付款方式");
        }
      } catch (e) {
        session.completePayment(Ctor.STATUS_FAILURE);
        onFail?.(e instanceof Error ? e.message : "付款失敗，請改用其他付款方式");
      }
    };

    session.begin();
  }

  return (
    <button
      type="button"
      className="apple-pay-button"
      onClick={start}
      aria-label="使用 Apple Pay 付款"
    />
  );
}
