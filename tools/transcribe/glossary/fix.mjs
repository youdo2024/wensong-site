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
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(scriptDir, "..", "out");
const tsvPath = path.join(scriptDir, "替換表.tsv");

export function loadRules(tsvContent) {
  const rules = [];
  for (const line of tsvContent.split("\n")) {
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

export function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/*
 * 套用整份替換規則，單一 pass 做完，不逐條依序 replace。
 *
 * 舊寫法是對每一條規則各自呼叫一次 text.replace()，逐條依序套用；如果某條
 * 規則的「正確」字串（right）恰好包含後面某條規則的「錯誤」字串（wrong），
 * 後面那條規則會二次命中已經修正過的文字，造成連鎖誤替換，沒有任何防重入
 * 檢查。改成把所有規則的「錯誤」字串組成一個大的交替（alternation）正則，
 * 對原始文字跑單一次 .replace()：JS 的 String.replace 搭配 /g 旗標在同一次
 * 呼叫裡是對原始字串做不重疊掃描，不會拿前一個替換結果再重新掃一次，
 * 天生就不會連鎖誤替換。同一個位置有多條規則都能吃到時，依「錯的」字串
 * 長度由長到短排序，讓長字串規則優先命中，不會被短字串規則搶先截斷。
 */
export function applyGlossaryFixes(text, rules) {
  if (rules.length === 0) return { text, hits: [] };
  const sorted = [...rules].sort((a, b) => b.wrong.length - a.wrong.length);
  const byWrong = new Map(sorted.map((r) => [r.wrong, r]));
  const combined = new RegExp(sorted.map((r) => escapeRegExp(r.wrong)).join("|"), "g");
  const counts = new Map();
  const fixed = text.replace(combined, (matched) => {
    counts.set(matched, (counts.get(matched) || 0) + 1);
    return byWrong.get(matched).right;
  });
  /* hits 依原始規則順序輸出，方便對照替換表.tsv 逐條檢查 */
  const hits = rules
    .filter((r) => counts.has(r.wrong))
    .map((r) => ({ wrong: r.wrong, right: r.right, count: counts.get(r.wrong) }));
  return { text: fixed, hits };
}

function fixOne(key, rules) {
  const mdPath = path.join(outDir, `${key}.md`);
  if (!fs.existsSync(mdPath)) {
    console.error(`[fix] 找不到 out/${key}.md，跳過`);
    return;
  }
  const original = fs.readFileSync(mdPath, "utf8");
  const { text, hits } = applyGlossaryFixes(original, rules);

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

/* 只有直接執行這支檔案（node fix.mjs ...）才跑 CLI 流程；被其他程式
   import（例如冒煙測試要測 applyGlossaryFixes）時不能因為沒有 argv[2]
   就 process.exit(1) 或去讀還沒建立的 out/ 目錄。
   用 pathToFileURL 而不是手動拼 `file://${process.argv[1]}`：這個 repo 的
   路徑本身就帶空白與中文字（iCloud 資料夾），import.meta.url 一定是
   percent-encoded，手動拼字串比對永遠對不上，判斷式會靜默失效。 */
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const arg = process.argv[2];
  if (!arg) {
    console.error("用法：node fix.mjs <key> | node fix.mjs --all");
    process.exit(1);
  }

  const rules = loadRules(fs.readFileSync(tsvPath, "utf8"));
  console.log(`[fix] 載入 ${rules.length} 條替換規則`);

  if (arg === "--all") {
    const keys = listAllKeys();
    console.log(`[fix] out/ 底下共 ${keys.length} 個 .md，逐一處理`);
    for (const key of keys) fixOne(key, rules);
  } else {
    fixOne(arg, rules);
  }
}
