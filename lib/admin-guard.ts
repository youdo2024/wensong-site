import { redirect } from "next/navigation";
import { isAdmin } from "./auth";

/*
 * 後台頁面的守門，每一個 page 自己呼叫一次。
 *
 * 為什麼不能只靠 (panel)/layout.tsx：
 * layout 裡的 redirect() 擋得住瀏覽器的一般導覽，但擋不住帶 RSC 標頭的請求。
 * App Router 在處理 RSC flight 請求時，page 元件仍然會被渲染、資料仍然會被
 * 序列化進回應，於是 layout 丟出的 NEXT_REDIRECT 沒有阻止資料外流。
 *
 * 實測（2026-08-19 正式站）：
 *   curl -H "RSC: 1" https://www.wensong.tw/admin/leads
 * 不帶任何 cookie 就回 200，內容含 274 個 Email 與 19 支手機。
 * 訂單、贊助、會員、待聯絡各頁同樣外洩。
 *
 * 所以認證不能只放在 layout。這支放在每一個 page 的第一行，
 * 與 proxy.ts 的攔截構成兩層，任何一層失效另一層還在。
 */
export async function requireAdmin(): Promise<void> {
  if (!(await isAdmin())) redirect("/admin/login");
}
