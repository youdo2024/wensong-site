import { NextRequest, NextResponse } from "next/server";
import { setSetting } from "@/lib/db";
import { safeEqual } from "@/lib/safe-equal";
import { rateLimit, clientIp } from "@/lib/ratelimit";
import { upsertGuestImport } from "@/lib/episodes";

/*
 * 本機補完 16 位來賓與主持人資料之後，用這支把 guests 與 settings（host_ 開頭）
 * 灌回正式站。跟 import-transcript 是同一套設計：不走後台登入，因為呼叫端是
 * tools/guests/push-guests.mjs 這種背景腳本，改用固定的 Bearer token 比對。
 *
 * IMPORT_TOKEN 沒設就整支路由當作不存在（回 404），理由同 import-transcript：
 * 不暴露「這裡有一支灌資料用的 API」這件事本身。
 *
 * 兩種 body 形狀：
 *   1. 來賓：{ slug, name, title, intro, photo, links, published?, featured?, sort? }
 *      用 name 對 guests 既有列比對，對到就 UPDATE（slug 也一起更新），
 *      沒對到就 INSERT 一筆新的。
 *   2. 主持人設定：{ settings: { host_1_photo: "...", host_2_intro: "..." } }
 *      只接受 key 開頭是 host_ 的欄位，其餘一律忽略，避免這支 API
 *      被拿去改跟主持人無關的設定。
 */
export async function POST(req: NextRequest) {
  const token = (process.env.IMPORT_TOKEN || "").trim();
  if (!token) return NextResponse.json({ error: "not found" }, { status: 404 });

  if (!rateLimit(`import-guest:${clientIp(req.headers)}`, 60, 60 * 60 * 1000))
    return NextResponse.json({ error: "嘗試太頻繁，請稍後再試" }, { status: 429 });

  const auth = req.headers.get("authorization") || "";
  const m = auth.match(/^Bearer\s+(.+)$/i);
  const given = m ? m[1].trim() : "";
  if (!safeEqual(given, token)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return NextResponse.json({ error: "缺少 body" }, { status: 400 });

  /* 主持人設定：settings 白名單更新，只准 host_ 開頭的鍵 */
  if (body.settings && typeof body.settings === "object" && !Array.isArray(body.settings)) {
    const updated: string[] = [];
    for (const [key, value] of Object.entries(body.settings as Record<string, unknown>)) {
      if (!key.startsWith("host_")) continue;
      if (typeof value !== "string") continue;
      setSetting(key, value);
      updated.push(key);
    }
    if (updated.length === 0) return NextResponse.json({ error: "沒有可更新的 host_ 設定" }, { status: 400 });
    return NextResponse.json({ ok: true, settings: updated });
  }

  /* 來賓：用 slug 當比對 key（見 lib/episodes.ts 的 upsertGuestImport 說明，
     slug 才是 guests 表真正的身分欄，用 name 比對本機同名不同人會互相覆蓋） */
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const slug = typeof body.slug === "string" ? body.slug.trim() : "";
  if (!name || !slug) return NextResponse.json({ error: "缺少 name 或 slug" }, { status: 400 });

  const title = typeof body.title === "string" ? body.title : "";
  const intro = typeof body.intro === "string" ? body.intro : "";
  const photo = typeof body.photo === "string" ? body.photo : "";
  const links =
    typeof body.links === "string"
      ? body.links
      : JSON.stringify(Array.isArray(body.links) ? body.links : []);
  const published = body.published === undefined || body.published === null ? 1 : body.published ? 1 : 0;
  const featured = body.featured ? 1 : 0;
  const sort = typeof body.sort === "number" && Number.isFinite(body.sort) ? body.sort : 0;
  const now = new Date().toISOString();

  const result = upsertGuestImport({ slug, name, title, intro, photo, links, published, featured, sort }, now);
  return NextResponse.json({ ok: true, action: result.action, id: result.id, slug });
}
