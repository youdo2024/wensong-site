import { NextRequest, NextResponse } from "next/server";
import { consumeOauthState, createMemberSession, memberSiteUrl, upsertUser } from "@/lib/member";

/* Google 登入回呼：換 token、取使用者資料、建 session */
export async function GET(req: NextRequest) {
  const site = memberSiteUrl();
  try {
    const code = req.nextUrl.searchParams.get("code") || "";
    const state = req.nextUrl.searchParams.get("state") || "";
    if (!code || !(await consumeOauthState(state))) {
      return NextResponse.redirect(`${site}/account?error=login`);
    }

    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: process.env.GOOGLE_CLIENT_ID || "",
        client_secret: process.env.GOOGLE_CLIENT_SECRET || "",
        redirect_uri: `${site}/api/auth/google/callback`,
        grant_type: "authorization_code",
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const token = (await tokenRes.json()) as { access_token?: string };
    if (!token.access_token) return NextResponse.redirect(`${site}/account?error=login`);

    const infoRes = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
      headers: { Authorization: `Bearer ${token.access_token}` },
      signal: AbortSignal.timeout(15_000),
    });
    const info = (await infoRes.json()) as { sub?: string; email?: string; email_verified?: boolean; name?: string; picture?: string };
    if (!info.sub) return NextResponse.redirect(`${site}/account?error=login`);

    /* Email 要 Google 自己說驗證過才採用：訂單是靠 Email 對起來的，未驗證的 Email
       等於沒有證明持有，會讓人拿別人的 Email 去看訂單。沒驗證就當作沒有 Email，登入照樣讓他進來。 */
    const email = info.email_verified === true ? info.email || "" : "";

    const id = upsertUser({
      provider: "google",
      providerId: info.sub,
      email,
      name: info.name || "",
      avatar: info.picture || "",
    });
    await createMemberSession(id);
    return NextResponse.redirect(`${site}/account`);
  } catch (e) {
    console.error("[google oauth]", e);
    return NextResponse.redirect(`${site}/account?error=login`);
  }
}
