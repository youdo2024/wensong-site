import { redirect } from "next/navigation";

/* 結帳殼頁（快取政策下放後每頁明寫） */
export const dynamic = "force-dynamic";

/* 結帳已併入購物車頁（/cart 一頁完成）；保留此路徑轉址，舊連結與書籤不斷 */
export default function CheckoutPage() {
  redirect("/cart");
}
