import { NextRequest, NextResponse } from "next/server";
import db from "@/lib/db";
import { consumeOauthState, createMemberSession, memberSiteUrl, upsertUser } from "@/lib/member";
import { lineNotifyOn as messagingEnabled, bindLine, lineBindingByUser, pushLine, composeLine, notifyOrderLine, orderStatusUrl } from "@/lib/line";
import { BIND_COOKIE, parseBindCookie } from "@/lib/line-bind";

/*
 * LINE 登入回呼：換 token 後用官方 verify 端點解 id_token（Email 需在 LINE Developers 申請權限才拿得到）。
 *
 * 2026-09 起多做三件事（規格 docs/line-notify-spec.md）：
 *   1. 舊 Login channel 換新之後 userId 全變：同一個 email 的舊 LINE 會員先接回來，不要變成新會員。
 *   2. 問 LINE 這個人有沒有加官方帳號好友（friendship API）。
 *   3. 帶著綁定 cookie 來的（從感謝頁、信件、簡訊按「用 LINE 收通知」）：把訂單綁到這個 userId，回感謝頁。
 *      一般登入且已加好友的會員：自動綁定（email 對訂單）。
 */
export async function GET(req: NextRequest) {
  const site = memberSiteUrl();
  const bind = parseBindCookie(req.cookies.get(BIND_COOKIE)?.value);
  const back = (url: string) => {
    const res = NextResponse.redirect(url);
    if (bind) res.cookies.set(BIND_COOKIE, "", { path: "/", maxAge: 0 });
    return res;
  };
  /* 綁定來源兩種：訂單（orderNo 是 YD 編號）或贊助（orderNo 是 SP:編號） */
  const spBind = bind && bind.orderNo.startsWith("SP:") ? Number(bind.orderNo.slice(3)) || 0 : 0;
  const spThanks = (sp: { id: number; mode: string; pay_token: string; status?: string }) =>
    `${site}/support/thanks?mode=${sp.mode}&pay=${sp.status === "pending" ? "pending" : "paid"}&sid=${sp.id}&t=${encodeURIComponent(sp.pay_token)}`;
  const fail = () =>
    back(
      spBind
        ? `${site}/support/thanks?mode=once&pay=paid&sid=${spBind}&t=${encodeURIComponent(bind!.token)}&line=fail`
        : bind
          ? `${site}/shop/thanks?no=${encodeURIComponent(bind.orderNo)}&k=${encodeURIComponent(bind.token)}&line=fail`
          : `${site}/account?error=login`
    );

  try {
    const code = req.nextUrl.searchParams.get("code") || "";
    const state = req.nextUrl.searchParams.get("state") || "";
    if (!code || !(await consumeOauthState(state))) return fail();

    const tokenRes = await fetch("https://api.line.me/oauth2/v2.1/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: `${site}/api/auth/line/callback`,
        client_id: process.env.LINE_CHANNEL_ID || "",
        client_secret: process.env.LINE_CHANNEL_SECRET || "",
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const token = (await tokenRes.json()) as { id_token?: string; access_token?: string };
    if (!token.id_token) return fail();

    const verifyRes = await fetch("https://api.line.me/oauth2/v2.1/verify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ id_token: token.id_token, client_id: process.env.LINE_CHANNEL_ID || "" }),
      signal: AbortSignal.timeout(15_000),
    });
    const info = (await verifyRes.json()) as { sub?: string; email?: string; name?: string; picture?: string };
    if (!info.sub) return fail();
    const email = (info.email || "").trim().toLowerCase();

    /* 舊 channel 的 LINE 會員接回來：同 email、provider 是 line、但 provider_id 不同 → 換成新 id */
    if (email) {
      const old = db.prepare("SELECT id,provider_id FROM users WHERE provider='line' AND email=? AND provider_id<>?").get(email, info.sub) as
        | { id: number; provider_id: string } | undefined;
      const dup = db.prepare("SELECT id FROM users WHERE provider='line' AND provider_id=?").get(info.sub);
      if (old && !dup) {
        db.prepare("UPDATE users SET provider_id=? WHERE id=?").run(info.sub, old.id);
        /* 舊 userId 的綁定（如果有）也跟著換 */
        db.prepare("UPDATE line_bindings SET line_user_id=? WHERE line_user_id=? AND NOT EXISTS (SELECT 1 FROM line_bindings WHERE line_user_id=?)")
          .run(info.sub, old.provider_id, info.sub);
      }
    }

    const id = upsertUser({ provider: "line", providerId: info.sub, email, name: info.name || "", avatar: info.picture || "" });
    await createMemberSession(id);

    /* 有沒有加官方帳號好友：只有 Messaging API 設好、且 Login channel 連結了官方帳號才查得到 */
    let friend = false;
    if (messagingEnabled() && token.access_token) {
      try {
        const fr = await fetch("https://api.line.me/friendship/v1/status", {
          headers: { Authorization: `Bearer ${token.access_token}` },
          signal: AbortSignal.timeout(10_000),
        });
        const fj = (await fr.json()) as { friendFlag?: boolean };
        friend = Boolean(fj.friendFlag);
      } catch (e) {
        console.error("[line oauth] friendship 查詢失敗", e);
      }
    }

    if (spBind && messagingEnabled()) {
      const sp = db.prepare("SELECT id,mode,pay_token,phone,email,status,amount,COALESCE(atm_bank,'') atm_bank,COALESCE(atm_vaccount,'') atm_vaccount,COALESCE(atm_expire,'') atm_expire FROM sponsorships WHERE id=?").get(spBind) as
        | { id: number; mode: string; pay_token: string; phone: string; email: string; status: string; amount: number; atm_bank: string; atm_vaccount: string; atm_expire: string } | undefined;
      if (!sp || !sp.pay_token || sp.pay_token !== bind!.token) return fail();
      bindLine({ lineUserId: info.sub, phone: sp.phone, email: sp.email, userId: id, source: bind!.src, orderNo: `SP${sp.id}` });
      /* LINE 沒給 Email（權限還沒過或客人沒勾）就用贊助時填的，會員才對得起來 */
      if (!email && sp.email) db.prepare("UPDATE users SET email=? WHERE id=? AND email=''").run(sp.email.toLowerCase(), id);
      if (!friend) {
        db.prepare("UPDATE line_bindings SET status='nofriend', updated_at=? WHERE line_user_id=?").run(new Date().toISOString(), info.sub);
        return back(`${spThanks(sp)}&line=nofriend`);
      }
      /* 待繳費的贊助：綁定當下就把繳費資訊推過去，不用再回信箱找 */
      if (sp.status === "pending" && sp.atm_vaccount) {
        void pushLine({
          lineUserId: info.sub,
          text: composeLine(`綁定完成。你的支持 NT$${sp.amount} 繳費資訊：\n銀行代碼 ${sp.atm_bank}　帳號 ${sp.atm_vaccount}\n${sp.atm_expire ? `請於 ${sp.atm_expire} 前完成。` : ""}入帳後會在這裡通知你。`),
          kind: "atm", orderNo: `SP${sp.id}`,
        }).catch((e) => console.error("[line] sponsor atm", e));
      }
      return back(`${spThanks(sp)}&line=bound`);
    }

    if (bind && messagingEnabled()) {
      const o = db.prepare("SELECT order_no,token,phone,email,status,name,total,pay_note FROM orders WHERE order_no=?").get(bind.orderNo) as
        | { order_no: string; token: string; phone: string; email: string; status: string; name: string; total: number; pay_note: string } | undefined;
      if (!o || o.token !== bind.token) return fail();
      const thanks = `${site}/shop/thanks?no=${encodeURIComponent(o.order_no)}&k=${encodeURIComponent(o.token)}`;
      bindLine({ lineUserId: info.sub, phone: o.phone, email: o.email, userId: id, source: bind.src, orderNo: o.order_no });
      if (!email && o.email) db.prepare("UPDATE users SET email=? WHERE id=? AND email=''").run(o.email.toLowerCase(), id);
      /* 待付款且已取號的訂單：綁定當下把繳費資訊推過去（取號時還沒綁，那一則沒推成） */
      if (friend && o.status === "pending" && (o.pay_note || "").includes("ATM 轉帳：")) {
        void notifyOrderLine("atm", o, { info: o.pay_note, url: orderStatusUrl(o.order_no, o.token) }).catch((e) => console.error("[line] bind atm", e));
      }
      if (!friend) {
        /* 登入了但在加好友那一步按了略過：記成 nofriend，感謝頁給加好友連結再試 */
        db.prepare("UPDATE line_bindings SET status='nofriend', updated_at=? WHERE line_user_id=?").run(new Date().toISOString(), info.sub);
        return back(`${thanks}&line=nofriend`);
      }
      return back(`${thanks}&line=bound`);
    }

    /* 一般登入：已加好友就自動綁（用會員 email 對訂單）。
       2026-09-05 拿掉「補上 Email」功能（任何人都能填別人的 Email 看訂單），所以不再帶 need=email；
       「收集 Email」那個設定只剩一個意思：LINE 登入要不要多要 email 權限。 */
    const q = (...parts: string[]) => { const p = parts.filter(Boolean); return p.length ? `?${p.join("&")}` : ""; };
    if (friend) {
      bindLine({ lineUserId: info.sub, email, userId: id, source: "login" });
      return back(`${site}/account${q("line=bound")}`);
    }
    if (messagingEnabled() && lineBindingByUser(info.sub)) return back(`${site}/account`);
    return back(`${site}/account${q(messagingEnabled() ? "line=nofriend" : "")}`);
  } catch (e) {
    console.error("[line oauth]", e);
    return fail();
  }
}
