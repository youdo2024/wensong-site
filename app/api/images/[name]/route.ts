import { NextRequest, NextResponse } from "next/server";
import path from "path";
import fs from "fs";
import fsp from "fs/promises";
import { DATA_DIR } from "@/lib/db";
import { deriveImage, pickFormat, pickWidth, MIME_OF } from "@/lib/image-derive";

const MIME: Record<string, string> = {
  ".jpg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".gif": "image/gif",
};

/*
 * 網站圖片（公開）。
 *
 * 兩件事在這支裡發生：
 *
 * 一、?w= 指定寬度時送縮小過的 WebP／AVIF，沒指定就送原圖。
 *    原圖一張都不會被改到，衍生檔另存在 images/.cache/（見 lib/image-derive.ts）。
 *    轉檔失敗、sharp 載不起來、原圖是 GIF——任何一種情況都退回原圖，
 *    使用者頂多看到「圖比較大」，不會看到破圖。
 *
 * 二、改用非同步讀檔。
 *    原本是 fs.readFileSync：那張 7.1MB 的圖每被要一次，
 *    就把 Node 唯一那條執行緒卡住整個讀檔時間。電子報一發、幾百人同時進來，
 *    卡住的不只是圖片，是同一時間所有人的結帳與贊助請求。
 *
 * 快取標頭維持 immutable 一年（檔名含時間戳不會重複），
 * 但要加 Vary: Accept——同一個網址會依瀏覽器支援度送 AVIF 或 WebP，
 * 少了它，CDN 可能把 AVIF 餵給不支援的瀏覽器。
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ name: string }> }) {
  const { name } = await ctx.params;
  if (!/^[a-z0-9.-]+$/i.test(name) || name.includes("..")) return new NextResponse("bad name", { status: 400 });

  const file = path.join(DATA_DIR, "images", name);
  if (!fs.existsSync(file)) return new NextResponse("not found", { status: 404 });

  const ext = path.extname(name).toLowerCase();
  const width = pickWidth(req.nextUrl.searchParams.get("w"));
  const fmt = pickFormat(req.headers.get("accept"));

  /* GIF 不轉：動圖轉成靜態的 WebP 會失去動畫，那是壞掉不是最佳化 */
  if (width && fmt && ext !== ".gif") {
    const derived = await deriveImage(name, width, fmt);
    if (derived) {
      const buf = await fsp.readFile(derived);
      return new NextResponse(new Uint8Array(buf), {
        headers: {
          "Content-Type": MIME_OF[fmt],
          "Cache-Control": "public, max-age=31536000, immutable",
          Vary: "Accept",
        },
      });
    }
    /* 走到這裡代表轉檔沒成功，往下送原圖 */
  }

  const buf = await fsp.readFile(file);
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": MIME[ext] || "application/octet-stream",
      "Cache-Control": "public, max-age=31536000, immutable",
      Vary: "Accept",
    },
  });
}
