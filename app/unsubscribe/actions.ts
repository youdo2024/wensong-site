"use server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import db from "@/lib/db";
import { rateLimit, clientIp } from "@/lib/ratelimit";
import { unsubUrl, unsubscribeByToken } from "@/lib/newsletter";
import { sendMail, wrapMail } from "@/lib/mail";

/*
 * 沒帶權杖進到退訂頁的人（多半是從收件軟體標題列的「取消訂閱」點進來，那條連結整批共用）：
 * 留下信箱，我們把他專屬的退訂連結寄過去。
 * 不直接用 email 退訂：email 可枚舉，任何人都能退掉別人的訂閱。
 * 不管信箱有沒有訂閱都回同一句話，不透露名單。
 */
export async function requestUnsubLink(formData: FormData) {
  const email = String(formData.get("email") || "").trim().toLowerCase();
  const ip = clientIp(await headers());
  if (!rateLimit(`unsub:${ip}`, 5, 60 * 60 * 1000)) redirect("/unsubscribe?sent=1");
  if (email.includes("@")) {
    const row = db.prepare("SELECT 1 FROM subscribers WHERE email=? AND COALESCE(unsubscribed_at,'')=''").get(email);
    if (row) {
      const url = unsubUrl(email);
      const html = wrapMail(
        "取消訂閱電子報",
        `<p style="font-size:15px;line-height:2;">你要求取消訂閱問爽的的電子報。按下面這個按鈕就完成，不用登入。</p>
         <p style="margin:18px 0 0;"><a href="${url}" style="display:inline-block;padding:12px 24px;font-size:15px;border:2px solid #3A3226;background:#EFE3C4;color:#3A3226;text-decoration:none;">取消訂閱</a></p>
         <p style="font-size:13px;color:#7C7060;line-height:2;margin-top:14px;">如果不是你要求的，忽略這封信就好，什麼都不會改變。</p>`
      );
      await sendMail(email, "取消訂閱電子報｜問爽的 WenSong", html);
    }
  }
  redirect("/unsubscribe?sent=1");
}

/*
 * 真正的退訂動作，只走 POST。
 *
 * 原本 GET 帶著權杖進來就直接退訂，問題是那條連結印在信裡：
 * 企業郵件的防毒掃描、Gmail 與各家收件軟體的連結預覽、Slack 貼上時的展開，
 * 都會替使用者把每一條連結點過一遍，於是人根本沒看到信就被退訂了，
 * 而且他不會知道，只會覺得「怎麼沒收到電子報」。
 *
 * 那些自動掃描不會送出表單，所以改成 GET 只畫確認畫面、按鈕送 POST 才退訂。
 * 對真的想退訂的人只多按一下，退訂依舊不用登入、不用填任何東西。
 */
export async function confirmUnsub(formData: FormData) {
  const t = String(formData.get("t") || "").trim();
  const done = t ? unsubscribeByToken(t) : false;
  redirect(done ? "/unsubscribe?done=1" : "/unsubscribe?bad=1");
}
