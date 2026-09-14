import { NextRequest, NextResponse } from "next/server";
import { verifyWebhookSignature, newsleopardKey } from "@/lib/newsleopard";
import { blockMail } from "@/lib/mail";
import { rateLimit, clientIp } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";

/*
 * 電子豹的事件通知（delivery／open／click／bounce／complaint）。
 *
 * 目前只處理會造成後果的兩種：
 *   bounce（退信）   → 把信箱標記成寄不到，之後不再寄
 *   complaint（抱怨）→ 對方按了「這是垃圾郵件」，更要立刻停止寄送。
 *                      繼續寄給檢舉過的人，傷的是整個網域的信譽，
 *                      連帶讓其他顧客的訂單信也開始進垃圾桶。
 *
 * open／click 先不記。要記就得設計一張事件表與保留期限，
 * 而那是個資（誰在什麼時候開了信），沒有明確用途之前不要先收。
 */
export async function POST(req: NextRequest) {
  /* 這支端點公開可打，先擋流量。正常事件量遠低於這個數字 */
  if (!rateLimit(`nlhook:${clientIp(req.headers)}`, 600, 60 * 60 * 1000))
    return new NextResponse("too many requests", { status: 429 });
  if (!newsleopardKey()) return new NextResponse("disabled", { status: 400 });

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return new NextResponse("bad request", { status: 400 });

  const id = String(body.id || "");
  const event = String(body.event || "");
  const sig = req.headers.get("x-surenotify-signature") || "";

  /*
   * 驗簽不過就拒絕。
   *
   * 不驗的話，任何人送一包 {"event":"bounce","to":"某位顧客"} 就能把那個人的
   * 信箱標記成寄不到，他之後再也收不到訂單通知，而且沒有人會發現。
   * 這是這支端點唯一的門。
   */
  if (!verifyWebhookSignature(id, event, sig)) {
    console.warn("[電子豹 webhook] 簽章不符，已忽略", event, id.slice(0, 30));
    return new NextResponse("invalid signature", { status: 401 });
  }

  /* to 的格式可能是「bob <bob@gmail.com>」，取角括號裡的才是信箱 */
  const raw = String(body.to || body.recipient || "");
  const m = raw.match(/<([^>]+)>/);
  const email = (m ? m[1] : raw).trim().toLowerCase();

  if ((event === "bounce" || event === "complaint") && email.includes("@")) {
    blockMail(email, event === "bounce" ? "電子豹回報退信" : "電子豹回報被檢舉為垃圾郵件");
    console.log(`[電子豹 webhook] ${event} → 已標記 ${email}`);
  }

  /* 一律回 200：非 200 會讓對方重送，而我們對其他事件本來就沒有動作 */
  return new NextResponse("OK");
}
