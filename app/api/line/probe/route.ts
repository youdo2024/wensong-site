import { NextRequest, NextResponse } from "next/server";
import { rateLimit, clientIp } from "@/lib/ratelimit";
import { lineEnabled, lineNotifyOn, lineOaId, lineToken, lineSecret } from "@/lib/line";

/*
 * LINE Messaging API 連線探測（公開、唯讀、限流）：用 access token 問 LINE「這個官方帳號是誰」（/v2/bot/info），
 * 不推任何訊息、不算額度。只回官方帳號名稱與 basicId、金鑰格式線索，不回金鑰內容。
 */
export const dynamic = "force-dynamic";
export async function GET(req: NextRequest) {
  if (!rateLimit(`lnprobe:${clientIp(req.headers)}`, 5, 60_000)) return NextResponse.json({ error: "too many" }, { status: 429 });
  const shape = { tokenLen: lineToken().length, secretLen: lineSecret().length, oaId: lineOaId(), hasWhitespace: /\s/.test(process.env.LINE_MESSAGING_ACCESS_TOKEN || "") || /\s/.test(process.env.LINE_MESSAGING_CHANNEL_SECRET || "") };
  if (!lineEnabled()) return NextResponse.json({ ok: false, enabled: false, notifyOn: false, message: "LINE_MESSAGING_ACCESS_TOKEN／LINE_MESSAGING_CHANNEL_SECRET 未設定", shape });
  try {
    const r = await fetch("https://api.line.me/v2/bot/info", { headers: { Authorization: `Bearer ${lineToken()}` }, signal: AbortSignal.timeout(15_000) });
    const d = (await r.json().catch(() => ({}))) as { basicId?: string; displayName?: string; message?: string };
    const ok = r.ok && Boolean(d.basicId);
    return NextResponse.json({
      ok, enabled: true, notifyOn: lineNotifyOn(), status: r.status,
      bot: ok ? { basicId: d.basicId, displayName: d.displayName } : null,
      oaIdMatches: ok ? (!lineOaId() || lineOaId().replace(/^@/, "") === String(d.basicId || "").replace(/^@/, "")) : null,
      message: ok ? "" : d.message || `HTTP ${r.status}`, shape,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ ok: false, enabled: true, notifyOn: lineNotifyOn(), message: e instanceof Error ? e.message : String(e), shape });
  }
}
