import { NextRequest, NextResponse } from "next/server";
import db from "@/lib/db";
import { safeEqual } from "@/lib/safe-equal";
import { rateLimit, clientIp } from "@/lib/ratelimit";

/*
 * 本機批次跑完 WhisperX 逐字稿之後，用這支把 Markdown 灌回集數資料表。
 * 不走後台登入（isAdmin/session），因為呼叫端是 tools/transcribe/push.mjs 這種
 * 背景腳本，不會有瀏覽器 cookie。改用固定的 Bearer token 比對，
 * 跟後台帳密系統完全分開、互不影響。
 *
 * IMPORT_TOKEN 沒設就整支路由當作不存在（回 404 而不是 401/403），
 * 避免暴露「這個網站有一支灌逐字稿用的 API」這件事本身。
 */
export async function POST(req: NextRequest) {
  const token = (process.env.IMPORT_TOKEN || "").trim();
  if (!token) return NextResponse.json({ error: "not found" }, { status: 404 });

  if (!rateLimit(`import-transcript:${clientIp(req.headers)}`, 30, 60 * 60 * 1000))
    return NextResponse.json({ error: "嘗試太頻繁，請稍後再試" }, { status: 429 });

  const auth = req.headers.get("authorization") || "";
  const m = auth.match(/^Bearer\s+(.+)$/i);
  const given = m ? m[1].trim() : "";
  if (!safeEqual(given, token)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const key = typeof body?.key === "string" ? body.key.trim() : "";
  if (!key) return NextResponse.json({ error: "缺少 key" }, { status: 400 });

  const row = db.prepare("SELECT id FROM episodes WHERE key = ?").get(key) as { id: number } | undefined;
  if (!row) return NextResponse.json({ error: "找不到這個 key 的集數" }, { status: 404 });

  /* 只更新有給的欄位：呼叫端可能只想補 transcript，不動 notes/summary */
  const fields: string[] = [];
  const values: unknown[] = [];
  if (typeof body?.transcript === "string") {
    fields.push("transcript = ?");
    values.push(body.transcript);
  }
  if (typeof body?.notes === "string") {
    fields.push("notes = ?");
    values.push(body.notes);
  }
  if (typeof body?.summary === "string") {
    fields.push("summary = ?");
    values.push(body.summary);
  }
  if (fields.length === 0) return NextResponse.json({ error: "沒有可更新的欄位" }, { status: 400 });

  fields.push("updated_at = ?");
  values.push(new Date().toISOString());
  values.push(key);

  db.prepare(`UPDATE episodes SET ${fields.join(", ")} WHERE key = ?`).run(...values);

  return NextResponse.json({ ok: true, key });
}
