import crypto from "crypto";
import { getSetting, setSetting } from "./db";
import { SEO } from "./seo";

/*
 * IndexNow（P3-4）：文章發布或更新時主動通知 Bing 等搜尋引擎。
 * ChatGPT 搜尋的底層是 Bing，這是讓內容最快被 AI 引用的通道。
 * 金鑰第一次用到時自動產生存 settings，驗證檔由 /api/indexnow-key 供應。
 */

export function indexNowKey(): string {
  let k = getSetting("indexnow_key", "");
  if (!k) {
    k = crypto.randomBytes(16).toString("hex");
    setSetting("indexnow_key", k);
  }
  return k;
}

export async function pingIndexNow(paths: string[]): Promise<void> {
  try {
    const key = indexNowKey();
    const body = {
      host: SEO.siteUrl.replace(/^https?:\/\//, ""),
      key,
      keyLocation: `${SEO.siteUrl}/${key}.txt`,
      urlList: paths.map((p) => `${SEO.siteUrl}${p.startsWith("/") ? p : `/${p}`}`),
    };
    await fetch("https://api.indexnow.org/indexnow", {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (e) {
    console.error("[indexnow] ping 失敗（不影響主流程）", e);
  }
}
