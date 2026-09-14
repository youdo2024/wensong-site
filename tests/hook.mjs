import fs from "fs";
import path from "path";
import { pathToFileURL, fileURLToPath } from "url";

/* 讓 node 直接跑 TS 測試：解析 @/ 路徑別名與省略的副檔名 */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export async function resolve(spec, ctx, next) {
  if (spec.startsWith("@/") || spec.startsWith("./") || spec.startsWith("../")) {
    const base = spec.startsWith("@/")
      ? path.join(ROOT, spec.slice(2))
      : path.resolve(path.dirname(fileURLToPath(ctx.parentURL)), spec);
    for (const ext of ["", ".ts", ".tsx", "/index.ts"]) {
      const f = base + ext;
      if (fs.existsSync(f) && fs.statSync(f).isFile()) return next(pathToFileURL(f).href, ctx);
    }
  }
  return next(spec, ctx);
}
