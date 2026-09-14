import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  /* 裸網域 wensong.tw 一律 301 轉到正式的 www.wensong.tw（SEO 只認一個網址） */
  async redirects() {
    return [
      {
        source: "/:path*",
        has: [{ type: "host", value: "wensong.tw" }],
        destination: "https://www.wensong.tw/:path*",
        permanent: true,
      },
    ];
  },
  async rewrites() {
    /* IndexNow 標準金鑰位置：/{32碼hex}.txt → 由 API 端點供應 */
    return [{ source: "/:key([0-9a-f]{32}).txt", destination: "/api/indexnow-key" }];
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          /* 嵌入控制：只允許自己把本站放進 iframe。這條 CSP 刻意只有 frame-ancestors 一個指令 */
          { key: "Content-Security-Policy", value: "frame-ancestors 'self'" },
          /*
           * 完整版 CSP，掛在 Report-Only：不擋任何東西，只回報到 /api/csp-report。
           * 觀察至少一週、Zeabur logs 搜 [csp] 沒有誤擋，再改成強制。
           * 名單依據（全部是程式碼實際用到的）：
           *   media/img  SoundOn 的音檔與集數封面（files.soundon.fm、rss.soundon.fm）
           *   script     GA(gtag)；'unsafe-inline' 是 Next 的行內啟動碼與 JSON-LD
           *   connect    GA 收數據
           *   form       綠界／統一金流／LINE Pay 的跳轉付款頁（第 3 段接藍新時要補 core.newebpay.com 與 ccore.newebpay.com）
           */
          {
            key: "Content-Security-Policy-Report-Only",
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' https://www.googletagmanager.com",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: blob: https://*.soundon.fm https://i.ytimg.com",
              "media-src 'self' https://*.soundon.fm",
              "font-src 'self' data:",
              "connect-src 'self' https://www.google-analytics.com https://region1.google-analytics.com https://www.googletagmanager.com",
              "frame-src https://www.youtube-nocookie.com",
              "object-src 'none'",
              "base-uri 'self'",
              "form-action 'self' https://payment-stage.ecpay.com.tw https://payment.ecpay.com.tw https://sandbox-web-pay.line.me https://web-pay.line.me https://api.payuni.com.tw https://sandbox-api.payuni.com.tw https://core.newebpay.com https://ccore.newebpay.com",
              "report-uri /api/csp-report",
            ].join("; "),
          },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          ...(process.env.NODE_ENV === "production"
            ? [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }]
            : []),
        ],
      },
    ];
  },
};

export default nextConfig;
