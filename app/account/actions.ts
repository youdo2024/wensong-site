"use server";
import { redirect } from "next/navigation";
import db from "@/lib/db";
import { destroyMemberSession, getMember } from "@/lib/member";

export async function memberLogout() {
  await destroyMemberSession();
  redirect("/");
}

/* 新品通知開關（同步進訂閱名單） */
export async function toggleNewsletter() {
  const m = await getMember();
  if (!m) redirect("/account");
  const next = m.newsletter ? 0 : 1;
  db.prepare("UPDATE users SET newsletter=? WHERE id=?").run(next, m.id);
  if (next && m.email) {
    db.prepare("INSERT INTO subscribers (email,name,source,created_at) VALUES (?,?,?,?) ON CONFLICT(email) DO NOTHING")
      .run(m.email.toLowerCase(), m.name, "會員中心", new Date().toISOString());
  }
  if (!next && m.email) {
    db.prepare("DELETE FROM subscribers WHERE email=?").run(m.email.toLowerCase());
  }
  redirect("/account");
}

/* 2026-09-05 移除「自己補 Email」：任何人都能填別人的 Email，填完就看得到那個人的訂單與收件地址。
   訂單一律只認登入服務（Google、LINE）給的 Email，或訂單確認信裡帶 token 的 LINE 綁定連結寫入的 Email。 */
