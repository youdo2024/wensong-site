import { NextRequest, NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import { mailLogById } from "@/lib/mail-log";

/*
 * 寄件紀錄「看內容」：把當時存下的整封 HTML 開在新分頁。
 *
 * 不直接把那段 HTML 當文件吐出來，而是包在 sandbox 的 iframe 裡（srcdoc，沒有 allow-scripts、
 * 沒有 allow-same-origin）：信裡就算混進 script 也跑不起來，也拿不到後台的 cookie。
 * 這樣不用賭 next.config 的全站 CSP 會不會蓋掉這裡設的 CSP。
 * 只有手寫信存了內容；其他種類這裡會回 404。登入後台才看得到。
 */
function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!(await isAdmin())) return new NextResponse("unauthorized", { status: 401 });
  const { id } = await ctx.params;
  const row = mailLogById(Number(id) || 0);
  if (!row || !row.body) return new NextResponse("這筆紀錄沒有存內容（只有手寫信會存）", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  const page = `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>${esc(row.subject)}</title>
<style>html,body{margin:0;height:100%;background:#FFF6EA;}
.bar{font:13px/1.6 -apple-system,system-ui,sans-serif;color:#33271F;background:#FBF6EA;border-bottom:1px solid #FFE3BF;padding:8px 12px;word-break:break-all;}
iframe{display:block;width:100%;height:calc(100% - 42px);border:0;}</style></head>
<body><div class="bar">寄給 ${esc(row.to_addr)}　${esc(row.created_at.slice(0, 16).replace("T", " "))}（UTC）　主旨：${esc(row.subject)}</div>
<iframe sandbox="" referrerpolicy="no-referrer" srcdoc="${esc(row.body)}"></iframe></body></html>`;
  return new NextResponse(page, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    },
  });
}
