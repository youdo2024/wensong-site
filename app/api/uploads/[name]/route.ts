import { NextRequest, NextResponse } from "next/server";
import path from "path";
import fs from "fs";
import { DATA_DIR } from "@/lib/db";
import { isAdmin } from "@/lib/auth";

const MIME: Record<string, string> = {
  ".jpg": "image/jpeg", ".png": "image/png", ".webp": "image/webp",
  ".heic": "image/heic", ".gif": "image/gif",
};

/* 投稿照片（僅後台可看） */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ name: string }> }) {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { name } = await ctx.params;
  /* 防路徑跳脫 */
  if (!/^[a-z0-9.-]+$/i.test(name) || name.includes("..")) return new NextResponse("bad name", { status: 400 });
  const file = path.join(DATA_DIR, "uploads", name);
  if (!fs.existsSync(file)) return new NextResponse("not found", { status: 404 });
  const buf = fs.readFileSync(file);
  return new NextResponse(new Uint8Array(buf), {
    headers: { "Content-Type": MIME[path.extname(name).toLowerCase()] || "application/octet-stream" },
  });
}
