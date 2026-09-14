import { NextRequest, NextResponse } from "next/server";
import db, { setSetting } from "@/lib/db";
import { lineEvent } from "@/lib/line";
import {
  verifyLineSignature, lineEnabled, lineBindingByUser, bindLine, setLineBlocked,
  replyLine, lineTemplate, renderLine, orderNoFromText,
  findLineBinding, oaBindDecision, oaBindCountToday, logOaBindAttempt, LINE_OA_BIND_DAILY_CAP,
} from "@/lib/line";
import { notifyOrderBoundByText } from "@/lib/line-bind-notice";

/*
 * LINE 官方帳號的 webhook（規格 docs/line-notify-spec.md 第三節）。
 * 第一期只處理三件事：加好友（回歡迎語或自動恢復）、封鎖（標記）、傳訂單編號（綁定）。
 * 其他訊息不回，交給官方帳號原本的人工或自動回應。
 *
 * 一定要先驗簽章再處理：這條網址是公開的，不驗的話任何人都能假造「某人綁了某張訂單」。
 * 處理完一律回 200，LINE 收到非 200 會重送，事件會被處理兩次。
 */
export const runtime = "nodejs";

type Ev = {
  type: string;
  replyToken?: string;
  source?: { type: string; userId?: string };
  message?: { type: string; text?: string };
};

export async function POST(req: NextRequest) {
  const raw = await req.text();
  const sig = req.headers.get("x-line-signature") || "";
  if (!lineEnabled() || !verifyLineSignature(raw, sig)) {
    return NextResponse.json({ error: "bad signature" }, { status: 401 });
  }
  setSetting("line_webhook_last", new Date().toISOString());

  let events: Ev[] = [];
  try { events = ((JSON.parse(raw) as { events?: Ev[] }).events) || []; } catch { events = []; }
  const site = (process.env.SITE_URL || "https://www.wensong.tw").replace(/\/$/, "");

  for (const ev of events) {
    const uid = ev.source?.userId || "";
    if (!uid || ev.source?.type !== "user") continue;
    try {
      if (ev.type === "unfollow") {
        setLineBlocked(uid, true);
        lineEvent(uid, "unfollow");
        continue;
      }
      if (ev.type === "follow") {
        lineEvent(uid, "follow");
        const b = lineBindingByUser(uid);
        if (b) {
          /* 加回來就是要收：自動恢復 */
          setLineBlocked(uid, false);
          if (ev.replyToken) await replyLine(ev.replyToken, renderLine(lineTemplate("bound"), { order: b.order_no, url: site, name: "", total: "", info: "", title: "" }));
        }
        /* 還沒綁定的新好友：歡迎訊息交給 LINE 官方帳號後台那則（站長 2026-09-03 指示保留它），系統不再多發一則 */
        continue;
      }
      if (ev.type === "message" && ev.message?.type === "text") {
        const no = orderNoFromText(ev.message.text || "");
        if (!no) {
          /* 不是訂單編號：回一句「這裡不能一一回覆、有事寫信」，順便再教一次傳訂單編號。
             官方帳號後台的自動回應要關掉，不然客人會收到兩則 */
          if (ev.replyToken) await replyLine(ev.replyToken, renderLine(lineTemplate("noreply"), { url: site, order: "", name: "", total: "", info: "", title: "" }));
          continue;
        }
        const o = db.prepare("SELECT order_no,phone,email,name FROM orders WHERE order_no=?").get(no) as
          | { order_no: string; phone: string; email: string; name: string } | undefined;
        if (!o) {
          if (ev.replyToken) await replyLine(ev.replyToken, renderLine(lineTemplate("bind_fail"), { url: `${site}/orders`, order: no, name: "", total: "", info: "", title: "" }));
          continue;
        }
        /*
         * 打編號就綁，中間沒有任何驗證（站長 2026-09-05 決定保留這個方便，不加驗證碼）。
         * 訂單編號是 YD ＋ 日期 ＋ 流水號，猜得到，所以這裡補三道保險，說明見 lib/line.ts。
         * 正常客人一輩子踩不到任何一道；殘留風險是全新 LINE 帳號每天仍可認領 5 張「沒人綁過」的單，
         * 但每一張都會寄信通知本人。
         */
        const decision = oaBindDecision(findLineBinding({ phone: o.phone, email: o.email }), uid);
        if (decision === "already") {
          /* 本人重打自己的編號：維持原本的「綁定完成」回覆，不重綁、不計次、不重複寄信 */
          if (ev.replyToken) await replyLine(ev.replyToken, renderLine(lineTemplate("bound"), { order: o.order_no, url: site, name: "", total: "", info: "", title: "" }));
          continue;
        }
        /* 保險一：同一個 LINE 帳號每天最多 5 次（台北時間），被擋下的也算。
           一定要先於「已被綁走」那道，否則超過上限的人還能無限量探測哪些訂單已經綁了 */
        if (oaBindCountToday(uid) >= LINE_OA_BIND_DAILY_CAP) {
          if (ev.replyToken) await replyLine(ev.replyToken, renderLine(lineTemplate("bind_cap"), { order: o.order_no, url: site, name: "", total: "", info: "", title: "" }));
          continue;
        }
        if (decision === "taken") {
          /* 保險二：已經綁在別人身上的訂單絕不覆蓋。不動 findLineBinding 的排序，改在這裡擋 */
          logOaBindAttempt(uid, o.order_no, "taken");
          if (ev.replyToken) await replyLine(ev.replyToken, renderLine(lineTemplate("bind_taken"), { order: o.order_no, url: site, name: "", total: "", info: "", title: "" }));
          continue;
        }
        logOaBindAttempt(uid, o.order_no, "bound");
        /* 保險三：通知訂單上的信箱。射後不理，寄信失敗不可以害客人收不到 LINE 回覆 */
        void notifyOrderBoundByText(o).catch(console.error);
        if (ev.replyToken) await replyLine(ev.replyToken, renderLine(lineTemplate("bound"), { order: o.order_no, url: site, name: "", total: "", info: "", title: "" }));
      }
    } catch (e) {
      console.error("[line webhook]", ev.type, e);
    }
  }
  return NextResponse.json({ ok: true });
}

/* LINE 後台的「Verify」有時用 GET 探路；回 200 就好 */
export async function GET() {
  return NextResponse.json({ ok: true });
}
