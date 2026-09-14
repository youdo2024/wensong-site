import { NextResponse } from "next/server";

/*
 * 舊的「一次寄出各種交易信範本」端點，已經退休。
 *
 * 原本是 GET /api/admin/test-mails?to=…，一個 GET 就真的寄出 7 封信。
 * 後台 cookie 是 SameSite=Lax，網址列的跳轉照樣會帶上，所以站長只要在別的網站
 * 點到一條做好的連結，我們的 SMTP 就替對方朝任意信箱送信，寄件人是本站，
 * 退信與被列黑名單的後果也算在本站頭上。會改變狀態的動作不能掛在 GET。
 *
 * 現在改走後台「網站設定 → 寄範本測試信」的 server action（POST，且會檢查收件信箱），
 * 見 app/admin/actions.ts 的 sendTemplateTestMails。
 * 這支路由留著只為了讓舊書籤看到一句講得清楚的話，不再做任何事。
 */
export function GET() {
  return NextResponse.json(
    { error: "這支端點已停用，請到後台的「網站設定 → 寄範本測試信」" },
    { status: 405 },
  );
}
