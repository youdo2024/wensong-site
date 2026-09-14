import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import db from "@/lib/db";
import { rateLimit, clientIp } from "@/lib/ratelimit";
import { newsletterBlock } from "@/lib/site-config";

/* 首頁電子報訂閱（第 8 塊）。站長模式關著時這支也不收，免得有人直接打 API 塞名單 */
export async function POST(req: NextRequest) {
  if (!newsletterBlock()) return NextResponse.json({ ok: false, error: "closed" }, { status: 404 });
  if (!rateLimit(`subscribe:${clientIp(req.headers)}`, 5, 60 * 60 * 1000)) return NextResponse.json({ ok: false }, { status: 429 });
  const form = await req.formData().catch(() => null);
  const email = String(form?.get("email") || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 120) return NextResponse.redirect(new URL("/?subscribed=0", req.url), 303);
  db.prepare("INSERT OR IGNORE INTO subscribers (email,name,source,created_at,unsub_token) VALUES (?,?,?,?,?)").run(
    email, "", "home", new Date().toISOString(), crypto.randomBytes(12).toString("base64url")
  );
  return NextResponse.redirect(new URL("/?subscribed=1", req.url), 303);
}
