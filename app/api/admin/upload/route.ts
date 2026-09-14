import { NextRequest, NextResponse } from "next/server";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import { DATA_DIR } from "@/lib/db";
import { isAdmin } from "@/lib/auth";

const MAX_SIZE = 8 * 1024 * 1024;
const ALLOWED: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
};

function looksLikeImage(buf: Buffer): boolean {
  if (buf.length < 12) return false;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return true; // JPEG
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return true; // PNG
  if (buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") return true; // WebP
  if (buf.toString("ascii", 0, 3) === "GIF") return true; // GIF
  return false;
}

/* 後台圖片上傳：存進 /data/images（隨 Volume 持久保存），回傳公開網址 */
export async function POST(req: NextRequest) {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File) || file.size === 0)
    return NextResponse.json({ error: "沒有收到檔案" }, { status: 400 });
  if (!ALLOWED[file.type])
    return NextResponse.json({ error: "只能上傳 JPG／PNG／WebP／GIF" }, { status: 400 });
  if (file.size > MAX_SIZE)
    return NextResponse.json({ error: "圖片請小於 8MB" }, { status: 400 });

  const buf = Buffer.from(await file.arrayBuffer());
  if (!looksLikeImage(buf))
    return NextResponse.json({ error: "檔案內容不是有效的圖片" }, { status: 400 });

  const dir = path.join(DATA_DIR, "images");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  /*
   * 落地前先縮到最長邊 2400。
   *
   * 為什麼：這支原本把原始 bytes 直接寫進磁碟，於是相機直出的
   * 6240×4160、7.1MB 的 JPEG 就這樣變成商品主圖，而它在手機上只顯示 276px 寬。
   * /api/images 那邊雖然會產生縮小的衍生檔，但原圖仍是那 7.1MB，
   * 備份信會被它撐大，磁碟也一直被佔著。從源頭擋掉比較乾淨。
   *
   * 2400 是刻意留的餘裕：站上最大的顯示尺寸是 1600，
   * 留到 2400 讓日後想加更大的尺寸時不必重新上傳。
   *
   * GIF 不動：轉檔會失去動畫。
   * sharp 失敗也不擋上傳——寧可存一張大圖，也不要讓站長傳不上去。
   */
  let out: Uint8Array = buf;
  if (file.type !== "image/gif") {
    try {
      const sharp = (await import("sharp")).default;
      const meta = await sharp(buf, { failOn: "none" }).metadata();
      const longest = Math.max(meta.width || 0, meta.height || 0);
      if (longest > 2400) {
        const pipe = sharp(buf, { failOn: "none" }).rotate().resize({ width: 2400, height: 2400, fit: "inside", withoutEnlargement: true });
        const resized = file.type === "image/png" ? await pipe.png().toBuffer() : await pipe.jpeg({ quality: 88 }).toBuffer();
        /* 只有真的變小才採用。極少數情況重新編碼會比原檔大，那就留原檔。 */
        if (resized.length < buf.length) out = resized;
      }
    } catch (e) {
      console.error("[upload] 縮圖失敗，改存原圖", e);
    }
  }

  const name = `img-${Date.now()}-${crypto.randomBytes(4).toString("hex")}${ALLOWED[file.type]}`;
  fs.writeFileSync(path.join(dir, name), out);

  return NextResponse.json({ url: `/api/images/${name}` });
}
