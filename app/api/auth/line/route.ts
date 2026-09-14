import { NextRequest, NextResponse } from "next/server";
import { issueOauthState, lineEnabled, memberSiteUrl } from "@/lib/member";
import { lineNotifyOn as messagingEnabled, lineCollectEmail } from "@/lib/line";

/*
 * 導向 LINE 登入。
 * bot_prompt：Messaging API 有設定時，登入畫面順便問要不要加官方帳號好友（Login channel 要先在
 * LINE Developers 連結官方帳號，且兩者同一個 Provider）。
 *   一般登入用 normal（同意畫面裡一個勾選）；為了綁定通知而來的（?bind=1）用 aggressive，
 *   同意之後再跳一頁專門問加好友，這一步就是綁定成功與否的關鍵。
 */
export async function GET(req: NextRequest) {
  if (!lineEnabled()) return NextResponse.redirect(`${memberSiteUrl()}/account`);
  const bind = req.nextUrl.searchParams.get("bind") === "1";
  const state = await issueOauthState();
  const params = new URLSearchParams({
    response_type: "code",
    client_id: process.env.LINE_CHANNEL_ID || "",
    redirect_uri: `${memberSiteUrl()}/api/auth/line/callback`,
    state,
    scope: lineCollectEmail() ? "profile openid email" : "profile openid",
  });
  if (messagingEnabled()) params.set("bot_prompt", bind ? "aggressive" : "normal");
  return NextResponse.redirect(`https://access.line.me/oauth2/v2.1/authorize?${params}`);
}
