#!/usr/bin/env node
/*
 * 把本機 data/site.db 補好的 16 位來賓與主持人（settings 的 host_ 開頭鍵）
 * 推到正式站，呼叫 POST /api/admin/import-guest（見 app/api/admin/import-guest/route.ts）。
 *
 * 用法：
 *   node tools/guests/push-guests.mjs            # 推全部 16 位來賓 + 2 位主持人設定
 *   node tools/guests/push-guests.mjs --guests    # 只推來賓
 *   node tools/guests/push-guests.mjs --hosts     # 只推主持人設定
 *
 * 環境變數（必填）：
 *   SITE_BASE    正式站網址，例如 https://www.wensong.tw
 *   IMPORT_TOKEN 跟站上 .env 的 IMPORT_TOKEN 一致
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const siteRoot = path.resolve(scriptDir, "..", "..");
const dataDir = process.env.DATA_DIR || path.join(siteRoot, "data");
const dbPath = path.join(dataDir, "site.db");

const args = process.argv.slice(2);
const onlyGuests = args.includes("--guests");
const onlyHosts = args.includes("--hosts");
const doGuests = onlyHosts ? false : true;
const doHosts = onlyGuests ? false : true;

function requireEnv() {
  const base = (process.env.SITE_BASE || "").replace(/\/$/, "");
  const token = process.env.IMPORT_TOKEN || "";
  if (!base || !token) {
    console.error("[push-guests] 需要 SITE_BASE 與 IMPORT_TOKEN 環境變數");
    process.exit(1);
  }
  return { base, token };
}

async function postImport(base, token, body) {
  const res = await fetch(`${base}/api/admin/import-guest`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, json };
}

async function pushGuests(db, base, token) {
  const rows = db
    .prepare("SELECT slug, name, title, intro, photo, links, published, featured, sort FROM guests ORDER BY id")
    .all();
  let ok = 0;
  let fail = 0;
  for (const row of rows) {
    const body = {
      slug: row.slug,
      name: row.name,
      title: row.title,
      intro: row.intro,
      photo: row.photo,
      links: row.links,
      published: row.published,
      featured: row.featured,
      sort: row.sort,
    };
    const res = await postImport(base, token, body);
    if (res.ok) {
      ok++;
      console.log(`[push-guests] 來賓 ${row.name}（${row.slug}） -> ${res.json.action}`);
    } else {
      fail++;
      console.error(`[push-guests] 來賓 ${row.name} 失敗（${res.status}）：${JSON.stringify(res.json)}`);
    }
  }
  console.log(`[push-guests] 來賓完成：成功 ${ok}，失敗 ${fail}`);
}

async function pushHosts(db, base, token) {
  const rows = db.prepare("SELECT key, value FROM settings WHERE key LIKE 'host_%'").all();
  if (rows.length === 0) {
    console.log("[push-guests] 沒有 host_ 開頭的設定，略過");
    return;
  }
  const settings = {};
  for (const r of rows) settings[r.key] = r.value;
  const res = await postImport(base, token, { settings });
  if (res.ok) {
    console.log(`[push-guests] 主持人設定 -> 已更新 ${res.json.settings.join(", ")}`);
  } else {
    console.error(`[push-guests] 主持人設定失敗（${res.status}）：${JSON.stringify(res.json)}`);
  }
}

async function main() {
  const { base, token } = requireEnv();
  const db = new Database(dbPath, { readonly: true });
  try {
    if (doGuests) await pushGuests(db, base, token);
    if (doHosts) await pushHosts(db, base, token);
  } finally {
    db.close();
  }
}

main().catch((err) => {
  console.error("[push-guests] 發生錯誤：", err);
  process.exit(1);
});
