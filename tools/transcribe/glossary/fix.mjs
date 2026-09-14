#!/usr/bin/env node
/*
 * 讀 glossary/替換表.tsv，對 out/<key>.md 做字串替換，輸出 out/<key>.fixed.md（不覆蓋原檔）。
 * 印出每條規則命中次數，方便校對時知道哪些規則真的有用到。
 *
 * 用法：
 *   node fix.mjs 0        單集，key 是 0（對應 out/0.md）
 *   node fix.mjs --all    跑 out/ 底下所有 *.md（排除已經是 *.fixed.md 的檔案）
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(scriptDir, "..", "out");
const tsvPath = path.join(scriptDir, "替換表.tsv");

function loadRules() {
  const raw = fs.readFileSync(tsvPath, "utf8");
  const rules = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.replace(/\r$/, "");
    if (!trimmed.trim()) continue;
    const [wrong, right] = trimmed.split("\t");
    if (!wrong || !right) {
      console.error(`[fix] 忽略格式不對的行：${JSON.stringify(line)}`);
      continue;
    }
    rules.push({ wrong, right });
  }
  return rules;
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function fixOne(key, rules) {
  const mdPath = path.join(outDir, `${key}.md`);
  if (!fs.existsSync(mdPath)) {
    console.error(`[fix] 找不到 out/${key}.md，跳過`);
    return;
  }
  const original = fs.readFileSync(mdPath, "utf8");
  let text = original;
  const hits = [];

  for (const { wrong, right } of rules) {
    const re = new RegExp(escapeRegExp(wrong), "g");
    const count = (text.match(re) || []).length;
    if (count > 0) {
      text = text.replace(re, right);
      hits.push({ wrong, right, count });
    }
  }

  const fixedPath = path.join(outDir, `${key}.fixed.md`);
  fs.writeFileSync(fixedPath, text, "utf8");

  console.log(`\n===== ${key} =====`);
  if (hits.length === 0) {
    console.log("  沒有規則命中");
  } else {
    for (const { wrong, right, count } of hits) {
      console.log(`  ${wrong} -> ${right}：${count} 次`);
    }
    const total = hits.reduce((sum, h) => sum + h.count, 0);
    console.log(`  小計：${hits.length} 條規則命中，共 ${total} 處`);
  }
  console.log(`  輸出：out/${key}.fixed.md`);
}

function listAllKeys() {
  return fs
    .readdirSync(outDir)
    .filter((f) => f.endsWith(".md") && !f.endsWith(".fixed.md"))
    .map((f) => f.slice(0, -3));
}

const arg = process.argv[2];
if (!arg) {
  console.error("用法：node fix.mjs <key> | node fix.mjs --all");
  process.exit(1);
}

const rules = loadRules();
console.log(`[fix] 載入 ${rules.length} 條替換規則`);

if (arg === "--all") {
  const keys = listAllKeys();
  console.log(`[fix] out/ 底下共 ${keys.length} 個 .md，逐一處理`);
  for (const key of keys) fixOne(key, rules);
} else {
  fixOne(arg, rules);
}
