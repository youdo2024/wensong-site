import { NextRequest, NextResponse } from "next/server";
import { THEMES } from "@/lib/themes";

/*
 * 風格切換（本機選稿用）：/theme/bubble 種一顆 cookie 然後回首頁，layout 讀 cookie 決定 data-theme。
 * 正式站也能用，但只有 THEME_PICKER=1 時畫面才會出現切換列；定稿後把沒選上的 CSS 刪掉，這支也一起刪。
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const back = req.nextUrl.searchParams.get("back") || "/";
  /* 相對 Location：用 req.url 組絕對網址會變成 localhost（Tailscale 預覽實測），瀏覽器自己會接上目前的網域 */
  const res = new NextResponse(null, { status: 303, headers: { Location: back.startsWith("/") && !back.startsWith("//") ? back : "/" } });
  if (THEMES.some((t) => t.key === name)) {
    res.cookies.set("ws_theme", name, { path: "/", maxAge: 60 * 60 * 24 * 30, sameSite: "lax" });
  } else {
    res.cookies.delete("ws_theme");
  }
  return res;
}
