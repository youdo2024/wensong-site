#!/usr/bin/env node
/*
 * 列出「還沒有逐字稿」的集數，供 run.sh 逐一處理。
 * 輸出：JSON 陣列 [{key, title, audio_url, duration}, ...]，只列 transcript 為空的集數。
 *
 * 讀資料庫路徑跟 lib/db.ts 同一套規則：DATA_DIR 環境變數優先，
 * 沒設就用專案根目錄下的 data/（這支腳本在 site/tools/transcribe/，往上兩層才是專案根）。
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const siteRoot = path.join(scriptDir, "../..");
const dataDir = process.env.DATA_DIR || path.join(siteRoot, "data");
const dbPath = path.join(dataDir, "site.db");

const db = new Database(dbPath, { readonly: true, fileMustExist: true });

const rows = db
  .prepare(
    `SELECT key, title, audio_url, duration
     FROM episodes
     WHERE TRIM(transcript) = ''
     ORDER BY CASE WHEN key = '0' THEN -1 ELSE duration END ASC`
  )
  .all();

db.close();

process.stdout.write(JSON.stringify(rows, null, 2) + "\n");
