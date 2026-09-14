import { permanentRedirect } from "next/navigation";

/*
 * 「文案信件」已經併進設定・內容（ia.md §1 舊網址、§2）。
 *
 * 網址留著只做轉址：站長的書籤、之前寄出去的後台連結、瀏覽器的自動完成都還記得這一條，
 * 直接刪掉會變成 404，而 404 看起來就像「後台壞了」。
 * 用 permanentRedirect（308）不是 redirect（307）：這是永久搬家，讓瀏覽器自己記住。
 */
export default function AdminCopyMoved() {
  permanentRedirect("/admin/settings/content");
}
