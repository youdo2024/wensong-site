import { NextRequest, NextResponse } from "next/server";
import { rateLimit, clientIp } from "@/lib/ratelimit";
import { createThrottle, isNoise, sanitizeCspUrl, violationKey } from "@/lib/csp-noise";

/*
 * CSP 違規回報。
 *
 * Report-Only 的 CSP 不擋任何東西，只把「如果改成強制會擋掉什麼」
 * 回報過來。沒有這支端點的話，違規只出現在訪客自己的 console，
 * 站長永遠看不到，Report-Only 就白掛了。
 *
 * 只寫進伺服器記錄，不進資料庫：這是觀察用的資料，不是業務資料。
 * 要看就去 Zeabur 的 Runtime Logs 搜 [csp]。
 *
 * 2026-08-27 加降噪（lib/csp-noise.ts）。原因是實測一小時的回報幾乎全是
 * 訪客端注入的第三方追蹤，一天幾千條會把 Runtime Logs 灌到之後找別的錯誤
 * 得先撥開它。降噪之後同種違規每 6 小時只記一次，新種類仍然立刻現形。
 *
 * 限流從 20 放寬到 60：原本設緊是因為每一筆都會寫一行 log，
 * 現在寫不寫由去重決定，限流只剩「別讓人拿這支端點灌流量」這個職責。
 * 設太緊反而有害，一個訪客的擴充功能先吐 20 條雜訊把額度用光，
 * 後面真正該看到的違規就被擋在門外了。
 */

/* 每個程序一份，重新部署歸零。6 小時的視窗夠讓站長一天看兩次都不漏新東西。 */
const throttle = createThrottle(6 * 60 * 60 * 1000, 500);

export async function POST(req: NextRequest) {
  if (!rateLimit(`csp:${clientIp(req.headers)}`, 60, 60 * 60 * 1000)) {
    return new NextResponse(null, { status: 204 });
  }
  try {
    const text = (await req.text()).slice(0, 4000);
    const body = JSON.parse(text) as Record<string, unknown>;
    /* 兩種格式都收：舊的 report-uri 包在 csp-report 底下，新的 Reporting API 是陣列 */
    const r = (body["csp-report"] || (Array.isArray(body) ? body[0] : body)) as Record<string, unknown>;
    const dir = String(r["violated-directive"] || r["effectiveDirective"] || "?");
    /* 查詢字串裡可能夾著訂單金鑰與付款 token，記錄前一律洗掉（見 sanitizeCspUrl） */
    const blocked = sanitizeCspUrl(String(r["blocked-uri"] || r["blockedURL"] || "?")).slice(0, 200);
    const page = sanitizeCspUrl(String(r["document-uri"] || r["documentURL"] || "?")).slice(0, 200);
    if (isNoise(blocked)) return new NextResponse(null, { status: 204 });
    const { log, suppressed } = throttle.check(violationKey(dir, blocked), Date.now());
    if (log) {
      const tail = suppressed > 0 ? `（前一輪另有 ${suppressed} 次相同的沒記）` : "";
      console.warn(`[csp] ${dir} 擋到 ${blocked} ＠ ${page}${tail}`);
    }
  } catch {
    /* 格式不對就算了，這端點的失敗不值得任何人被吵 */
  }
  return new NextResponse(null, { status: 204 });
}
