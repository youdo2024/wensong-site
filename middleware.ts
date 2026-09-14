import { NextRequest, NextResponse } from "next/server";

/*
 * 網址正規化（P0-1）：路徑含大寫字母時 301 轉小寫，
 * 避免 /Articles、/ARTICLES 之類的網址各自存在。
 * 只處理純 ASCII 大寫；中文與編碼字元不動。API 與靜態資源跳過。
 */
/*
 * 大小寫有意義的路徑：權杖不是網址的一部分，是資料。
 * /pay/<token> 的權杖是 base64url，大小寫不同就是不同的權杖，
 * 轉成小寫等於把連結轉成一條查無此單的網址（幾乎每一條都會中）。
 */
/*
 * 短網址的碼也一樣（2026-09-07）：8 碼取自 0-9 a-z A-Z 的 56 個字元，
 * 大小寫是資料的一部分，TZk9TiJy 與 tzk9tijy 是兩組不同的碼。
 * 這裡少一條，站長寄出去的每一封簡訊都會先被 301 轉成小寫、再變成「查無此單」。
 */
const CASE_SENSITIVE = [/^\/pay\//, /^\/l\//];

/*
 * 後台守門（第一層）。
 *
 * 為什麼要在這裡再擋一次：(panel)/layout.tsx 的 redirect() 擋得住瀏覽器的
 * 一般導覽，但擋不住帶 RSC 標頭的請求——那種請求下 page 元件仍會被渲染、
 * 資料仍會被序列化進 flight 回應。實測正式站曾經因此外洩全部顧客個資。
 *
 * 這一層只認 cookie 在不在，不驗簽章：middleware 跑在 Edge 執行環境，
 * 讀不到 better-sqlite3 裡的簽章金鑰。真正的驗簽由每個 page 的
 * requireAdmin() 負責（lib/admin-guard.ts）。兩層各擋一種情況：
 * 這一層讓沒有 cookie 的請求連渲染都不會開始，那一層擋偽造的 cookie。
 */
function blockAdmin(req: NextRequest): NextResponse | null {
  const { pathname } = req.nextUrl;
  if (!pathname.startsWith("/admin") || pathname.startsWith("/admin/login")) return null;
  if (req.cookies.get("yo_admin")?.value) return null;
  const url = req.nextUrl.clone();
  url.pathname = "/admin/login";
  url.search = "";
  /* RSC 請求不能回 redirect（用戶端會照樣拿到 flight），直接回 401 空內容 */
  if (req.headers.get("rsc") === "1" || req.headers.get("next-router-prefetch")) {
    return new NextResponse("401", { status: 401, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }
  return NextResponse.redirect(url, 307);
}

/*
 * 審核用測試站的門（REVIEW_SITE=1）。
 *
 * 整站 Basic Auth，包含首頁。理由是實際發生過的事：2026-08-13 審核人員說
 * 「我按到首頁還是會出現」——用網址參數當預覽金鑰只擋得住那一頁，
 * 擋不住從那一頁點出去的整個網站。要嘛整站擋，要嘛等於沒擋。
 *
 * 帳密只從環境變數讀，程式碼裡不留任何預設值：沒設就整站 401，
 * 不會因為忘了設定而整個測試站變成公開的。
 *
 * 放在最前面，比後台守門還早：測試站上連 /admin/login 都不該被外人看到。
 */
const REVIEW_COOKIE = "yo_review";

/*
 * 擋下來的回應一定要帶 Content-Type 與 body。
 *
 * 原本回 new NextResponse(null, { status: 404 })——沒有 body 也沒有型別，
 * Safari 會把它當成一個「不知道是什麼的檔案」，跳出「要允許在 xxx 上下載嗎？」
 * 然後畫面一片黑。實際踩到了。
 */
function notFound(): NextResponse {
  return new NextResponse("404 Not Found", {
    status: 404,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
}

function reviewGate(req: NextRequest): NextResponse | null {
  if (process.env.REVIEW_SITE !== "1") return null;
  const { pathname } = req.nextUrl;
  const isAdminPath = pathname.startsWith("/admin") || pathname.startsWith("/api/admin");

  /*
   * 一次性通行連結：?rk=<REVIEW_KEY> 種一顆 cookie 之後就一路暢通。
   *
   * 為什麼不用 Basic Auth 當主要的門：那個瀏覽器原生對話框會在網址列下方
   * 寫著「review.wensong.tw:443」，每開一個新分頁就提醒對方一次
   * 「你在看的不是正式站」。審核要的是「逛起來就是正式站」，
   * 一個登入框會讓整件事的說服力打折。
   *
   * 站長八月已經對同一位審核人員用過這個模式（/api/shop-preview?k=…），
   * 對方接受，所以不是新發明。
   */
  /*
   * REVIEW_OPEN=1：前台對所有人開放，網址直接給對方就能看，不必帶任何參數。
   * 後台仍然要 Basic Auth——公開的是「像正式站的前台」，不是後台。
   *
   * 這是站長明確選的：審核人員直接開 https://review.wensong.tw 就好，
   * 一條要複製貼上的長網址對他來說仍然是「這不是正式站」的提醒。
   *
   * 代價與已經做掉的補償：
   *   搜尋引擎收錄 → 全站 noindex（meta）＋ robots.txt 全站 Disallow ＋ sitemap 回空
   *   真客人誤入下單 → 信一律轉寄站長且主旨標「［測試站］」、發票強制測試環境，
   *                     所以不會產生正式發票，也不會通知夥伴出貨
   *   有人刷到真錢 → 只要這台不設正式金流金鑰就不可能，開站前務必確認
   *
   * 明確用一個獨立旗標而不是「沒設 REVIEW_KEY 就開放」：後者會讓
   *「忘記設定」變成「整站公開」，那是最不該用預設值決定的事。
   */
  if (process.env.REVIEW_OPEN === "1") {
    if (!isAdminPath) return null;
    /*
     * 後台要不要多包一層由站長決定：
     *   有設 REVIEW_ADMIN_USER／PASS → 兩層（外面這層讓登入頁對外根本不存在）
     *   沒設                        → 一層，跟正式站一樣，交給網站自己的登入頁
     *
     * 沒設就放行而不是一律擋：不然站長把那兩個變數刪掉之後，
     * 會把自己鎖在後台外面，而且看不出為什麼。
     */
    if (!process.env.REVIEW_ADMIN_USER || !process.env.REVIEW_ADMIN_PASS) return null;
  }

  const key = process.env.REVIEW_KEY || "";
  const given = req.nextUrl.searchParams.get("rk") || "";
  if (key && given && given === key) {
    const url = req.nextUrl.clone();
    url.searchParams.delete("rk");
    /* 立刻把金鑰從網址上抹掉再導回：不要讓它留在對方的瀏覽紀錄與分享連結裡 */
    const res = NextResponse.redirect(url, 307);
    /* secure 跟著實際協定走。寫死 true 的話，本機用 http 預覽時瀏覽器
       依規定不會存這顆 cookie，站長自己測會一直失敗卻找不出原因。
       正式站在 Zeabur 反向代理後面，內部是 http，所以要看 x-forwarded-proto。 */
    const proto = req.headers.get("x-forwarded-proto") || req.nextUrl.protocol.replace(":", "");
    res.cookies.set(REVIEW_COOKIE, key, {
      httpOnly: true,
      sameSite: "lax",
      secure: proto === "https",
      path: "/",
      maxAge: 60 * 60 * 24 * 90,
    });
    return res;
  }
  /* 有 cookie＝審核人員，前台隨便逛，後台當作不存在 */
  if (key && req.cookies.get(REVIEW_COOKIE)?.value === key) {
    return isAdminPath ? notFound() : null;
  }

  /*
   * 沒有通行證時：前台回 404（看起來這個網域沒有東西），後台才跳登入框。
   *
   * 前台不回 401 的理由跟上面一樣——不要讓陌生訪客看到登入框，
   * 那反而昭告「這裡有一個藏起來的站」。
   */
  const deny = isAdminPath
    ? new NextResponse("Restricted", {
        status: 401,
        headers: { "WWW-Authenticate": 'Basic realm="Admin", charset="UTF-8"' },
      })
    : notFound();

  const header = req.headers.get("authorization") || "";
  if (!header.startsWith("Basic ")) return deny;
  let decoded = "";
  try { decoded = atob(header.slice(6)); } catch { return deny; }
  const i = decoded.indexOf(":");
  if (i < 0) return deny;
  const u = decoded.slice(0, i);
  const p = decoded.slice(i + 1);

  const match = (user?: string, pass?: string) => Boolean(user && pass && u === user && p === pass);
  /* 站長那組：全站包含後台 */
  if (match(process.env.REVIEW_ADMIN_USER, process.env.REVIEW_ADMIN_PASS)) return null;
  /* 審核人員那組：只能看前台 */
  if (match(process.env.REVIEW_USER, process.env.REVIEW_PASS)) {
    /*
     * 後台對審核人員回 404 而不是 403。
     *
     * 403 等於告訴對方「這裡有東西，只是你沒權限」，他就知道有後台可以試；
     * 404 則是這條路根本不存在，點來點去不會發現登入頁。
     * 審核看的是前台，後台的存在對他沒有意義，也不該讓他知道。
     *
     * 這只是第一層。真正的後台仍然要 ADMIN_PASSWORD 才登得進去，
     * 而且審核站的那組本來就該跟正式站不同——審核站的帳密會躺在
     * 對方的通訊軟體紀錄裡。
     */
    return isAdminPath ? notFound() : null;
  }
  return deny;
}

/*
 * 網域與 REVIEW_SITE 必須一致，不一致就整站停掉。
 *
 * 這一道不是防外人，是防我們自己。兩種設定錯誤的後果差很多：
 *
 *   審核站忘了設 REVIEW_SITE=1
 *     → 沒有 Basic Auth（整站公開）、會開正式發票、會寄真信給真顧客、
 *       會被搜尋引擎收錄成正式站的重複內容。而且外觀跟正式站一樣，
 *       你點進去完全看不出哪裡不對。
 *
 *   正式站誤設 REVIEW_SITE=1
 *     → 所有顧客的信被改寄到同一個信箱、發票全部變成測試發票、GA 停止記錄。
 *       同樣沒有任何畫面上的徵兆。
 *
 * 兩種都是「靜靜地壞掉」，可能三天後才發現，而那三天的訂單沒有發票、
 * 顧客沒收到信。相較之下整站 503 你五分鐘內就會知道。所以寧可大聲壞掉。
 *
 * 只在網域結尾是 wensong.tw 時檢查：本機預覽、IP、zeabur.app 一律放行，
 * 否則開發環境會被自己擋住。
 */
function domainGuard(req: NextRequest): NextResponse | null {
  const host = (req.headers.get("host") || "").toLowerCase().split(":")[0];
  if (!host.endsWith("wensong.tw")) return null;
  const flag = process.env.REVIEW_SITE === "1";
  const reviewHost = host.startsWith("review.");
  if (reviewHost === flag) return null;
  const msg = reviewHost
    ? "審核站設定錯誤：這個網域需要環境變數 REVIEW_SITE=1。到 Zeabur 補上並重新部署。"
    : "正式站設定錯誤：這個網域不該有環境變數 REVIEW_SITE。到 Zeabur 移除並重新部署。";
  return new NextResponse(msg, {
    status: 503,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const mismatch = domainGuard(req);
  if (mismatch) return mismatch;
  const gate = reviewGate(req);
  if (gate) return gate;
  const blocked = blockAdmin(req);
  if (blocked) return blocked;
  if (CASE_SENSITIVE.some((re) => re.test(pathname))) return NextResponse.next();
  if (/[A-Z]/.test(pathname)) {
    const url = req.nextUrl.clone();
    url.pathname = pathname.toLowerCase();
    return NextResponse.redirect(url, 301);
  }
  return NextResponse.next();
}

export const config = {
  /*
   * 兩組 matcher：
   *   第一組是原本的網址正規化與後台守門，排除 Next 內部資源、API、
   *   以及帶副檔名的靜態檔（/api 不在這裡擋，因為 admin API 各自有 isAdmin()）。
   *   第二組只為了測試站的 Basic Auth：那道門必須連 /api 與圖片都擋，
   *   否則測試站的 API 與上傳的圖片是公開的，等於門開著只鎖了客廳。
   *   非測試站時 reviewGate 第一行就 return null，成本只有一次字串比較。
   */
  matcher: ["/((?!_next).*)"],
};
