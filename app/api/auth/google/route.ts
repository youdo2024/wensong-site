import { NextResponse } from "next/server";
import { googleEnabled, issueOauthState, memberSiteUrl } from "@/lib/member";

/* 導向 Google 登入 */
export async function GET() {
  if (!googleEnabled()) return NextResponse.redirect(`${memberSiteUrl()}/account`);
  const state = await issueOauthState();
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID || "",
    redirect_uri: `${memberSiteUrl()}/api/auth/google/callback`,
    response_type: "code",
    scope: "openid email profile",
    state,
    prompt: "select_account",
  });
  return NextResponse.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
}
