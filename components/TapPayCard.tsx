"use client";
import { useEffect, useRef, useState } from "react";
import Script from "next/script";

/*
 * TapPay Fields 站內刷卡欄位：卡號／效期／後三碼是三個 host 在 TapPay 的 iframe，
 * 卡號不經過我們的程式碼與伺服器。SDK 文件與範例：
 * https://js.tappaysdk.com/sdk/tpdirect/v5.24.0（TapPay 官方 CDN）
 * github.com/TapPay/tappay-web-example（TapPay_Fields 範例）
 */

const SDK_URL = "https://js.tappaysdk.com/sdk/tpdirect/v5.24.0";

type TPDirect = {
  setupSDK: (appId: number, appKey: string, env: "sandbox" | "production") => void;
  card: {
    setup: (cfg: unknown) => void;
    onUpdate: (cb: (u: { canGetPrime: boolean; cardType: string }) => void) => void;
    getPrime: (cb: (r: { status: number; msg: string; card: { prime: string } }) => void) => void;
  };
};

declare global {
  interface Window { TPDirect?: TPDirect }
}

/* 取得 prime 的函式由父層透過 ref 呼叫（按下付款鈕時） */
export type TapPayCardHandle = { getPrime: () => Promise<string> };

export default function TapPayCard({
  appId,
  appKey,
  sandbox,
  onReady,
  handleRef,
}: {
  appId: number;
  appKey: string;
  sandbox: boolean;
  onReady: (canGetPrime: boolean) => void;
  handleRef: React.MutableRefObject<TapPayCardHandle | null>;
}) {
  const [sdkLoaded, setSdkLoaded] = useState(false);
  const setupDone = useRef(false);

  useEffect(() => {
    if (!sdkLoaded || setupDone.current) return;
    const TP = window.TPDirect;
    if (!TP) return;
    setupDone.current = true;
    TP.setupSDK(appId, appKey, sandbox ? "sandbox" : "production");
    TP.card.setup({
      fields: {
        number: { element: "#tp-card-number", placeholder: "**** **** **** ****" },
        expirationDate: { element: "#tp-card-exp", placeholder: "MM / YY" },
        ccv: { element: "#tp-card-ccv", placeholder: "後三碼" },
      },
      styles: {
        input: { color: "#3A3226", "font-size": "16px" },
        ".valid": { color: "#2F5D3A" },
        ".invalid": { color: "#A33B2A" },
      },
      isMaskCreditCardNumber: true,
      maskCreditCardNumberRange: { beginIndex: 6, endIndex: 11 },
    });
    TP.card.onUpdate((u) => onReady(u.canGetPrime));
    handleRef.current = {
      getPrime: () =>
        new Promise((resolve, reject) => {
          window.TPDirect!.card.getPrime((r) => {
            if (r.status !== 0) reject(new Error(r.msg || "卡片資料有誤，請再確認一次"));
            else resolve(r.card.prime);
          });
        }),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sdkLoaded]);

  return (
    <div className="tp-fields">
      <Script src={SDK_URL} strategy="afterInteractive" onLoad={() => setSdkLoaded(true)} />
      <div className="field full">
        <label>卡號 <em>＊</em></label>
        <div className="tp-input" id="tp-card-number" />
      </div>
      <div className="tp-row">
        <div className="field">
          <label>有效期限 <em>＊</em></label>
          <div className="tp-input" id="tp-card-exp" />
        </div>
        <div className="field">
          <label>安全碼 <em>＊</em></label>
          <div className="tp-input" id="tp-card-ccv" />
        </div>
      </div>
      <p className="fine" style={{ marginTop: 6 }}>
        卡號輸入格由 TapPay 提供（PCI-DSS 認證），本站不經手也不儲存你的卡號；付款將進行銀行 3D 驗證。
      </p>
    </div>
  );
}
