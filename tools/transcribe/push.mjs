#!/usr/bin/env node
/*
 * 把 out/<key>.md 逐字稿推進網站資料庫。
 *
 * 兩種模式：
 *   1. 遠端（預設）：呼叫 SITE_BASE 的 POST /api/admin/import-transcript，
 *      帶 Authorization: Bearer <IMPORT_TOKEN>。用在正式站或跑在別台機器的預覽站。
 *   2. --local：跳過 HTTP，直接開本機 sqlite（DATA_DIR 可覆蓋）UPDATE，
 *      只在 transcript 目前是空字串時才寫，帶 --force 才允許覆蓋非空值。
 *
 * 用法：
 *   node push.mjs 0 13 22              # 只推這幾集（遠端）
 *   node push.mjs --all                # 推 out/ 底下所有 .md
 *   node push.mjs --all --local        # 推所有，直接寫本機 db
 *   node push.mjs 0 --local --force    # 本機、允許覆蓋已有逐字稿
 *
 * 環境變數（遠端模式必填）：SITE_BASE（例如 http://100.118.154.17:3000）、IMPORT_TOKEN
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(scriptDir, "out");

const rawArgs = process.argv.slice(2);
const useLocal = rawArgs.includes("--local");
const useForce = rawArgs.includes("--force");
const useAll = rawArgs.includes("--all");
const keys = rawArgs.filter((a) => !a.startsWith("--"));

function keysToProcess() {
  if (useAll) {
    if (!fs.existsSync(outDir)) return [];
    return fs
      .readdirSync(outDir)
      .filter((f) => f.endsWith(".md") && !f.endsWith(".fixed.md"))
      .map((f) => f.slice(0, -3));
  }
  return keys;
}

function readMd(key) {
  /* 有 fix.mjs 修過的版本就用修過的（glossary/替換表.tsv），沒有才用原始輸出 */
  const fixed = path.join(outDir, `${key}.fixed.md`);
  const p = fs.existsSync(fixed) ? fixed : path.join(outDir, `${key}.md`);
  if (!fs.existsSync(p)) {
    console.error(`[push] 找不到 ${p}，略過`);
    return null;
  }
  const content = fs.readFileSync(p, "utf8");
  if (!content.trim()) {
    console.error(`[push] ${key}.md 是空的，略過`);
    return null;
  }
  return content;
}

async function pushRemote(key, transcript) {
  const base = (process.env.SITE_BASE || "").replace(/\/$/, "");
  const token = process.env.IMPORT_TOKEN || "";
  if (!base || !token) {
    console.error("[push] 遠端模式需要 SITE_BASE 與 IMPORT_TOKEN 環境變數");
    process.exit(1);
  }
  const res = await fetch(`${base}/api/admin/import-transcript`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ key, transcript }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error(`[push] ${key} 失敗（${res.status}）：${JSON.stringify(body)}`);
    return false;
  }
  console.log(`[push] ${key} 已推上 ${base}`);
  return true;
}

function pushLocal(db, key, transcript) {
  const row = db.prepare("SELECT transcript FROM episodes WHERE key = ?").get(key);
  if (!row) {
    console.error(`[push] 本機資料庫找不到 key=${key}，略過`);
    return false;
  }
  if (row.transcript && row.transcript.trim() && !useForce) {
    console.error(`[push] ${key} 已經有逐字稿，未加 --force 不覆蓋`);
    return false;
  }
  db.prepare("UPDATE episodes SET transcript = ?, updated_at = ? WHERE key = ?").run(
    transcript,
    new Date().toISOString(),
    key
  );
  console.log(`[push] ${key} 已寫入本機資料庫`);
  return true;
}

async function main() {
  const targets = keysToProcess();
  if (targets.length === 0) {
    console.error("[push] 沒有要推的集數。用法：node push.mjs <key...> | --all，可加 --local --force");
    process.exit(1);
  }

  let db = null;
  if (useLocal) {
    const Database = require("better-sqlite3");
    const siteRoot = path.join(scriptDir, "../..");
    const dataDir = process.env.DATA_DIR || path.join(siteRoot, "data");
    db = new Database(path.join(dataDir, "site.db"));
  }

  let ok = 0;
  let fail = 0;
  for (const key of targets) {
    const transcript = readMd(key);
    if (transcript === null) {
      fail++;
      continue;
    }
    const success = useLocal ? pushLocal(db, key, transcript) : await pushRemote(key, transcript);
    if (success) ok++;
    else fail++;
  }

  if (db) db.close();
  console.log(`[push] 完成：成功 ${ok} 集，失敗／略過 ${fail} 集`);
  /* 只要有集失敗就要用非零退出碼，不能只在「全部失敗」時才算失敗：
     部分失敗（有些成功、有些失敗）如果被其他腳本鏈依賴退出碼判斷整批
     是否成功，exit 0 會被誤判成整批順利。 */
  if (fail > 0) process.exit(1);
}

main();
