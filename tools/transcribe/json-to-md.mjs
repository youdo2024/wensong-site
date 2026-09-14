#!/usr/bin/env node
/*
 * 把 whisperx 產出的 out/<key>.json 轉成 out/<key>.md。
 *
 * 格式：每個 segment 一行「**講者X**：內容」，段落間空一行，開頭不加任何標題。
 * 有跑 --diarize 時 segment 會帶 speaker 欄位（SPEAKER_00/01/...），
 * 依「第一次出現的順序」對應成 A/B/C，方便站長之後人工對成維尼／安妮／來賓。
 * 沒有 diarize（單講者模式，這個站目前沒有 HF token）時，speaker 欄位不存在，
 * 全部段落一律標成 A，字幕本身完全沒受影響，只有前面那個標籤是佔位。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const key = process.argv[2];
if (!key) {
  console.error("用法：node json-to-md.mjs <key>");
  process.exit(1);
}

const jsonPath = path.join(scriptDir, "out", `${key}.json`);
const mdPath = path.join(scriptDir, "out", `${key}.md`);

if (!fs.existsSync(jsonPath)) {
  console.error(`找不到 ${jsonPath}`);
  process.exit(1);
}

const data = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
const segments = Array.isArray(data.segments) ? data.segments : [];

const speakerLabel = (() => {
  const seen = new Map(); // speaker id -> A/B/C...
  const letters = "ABCDEFGHIJ";
  return (rawSpeaker) => {
    if (!rawSpeaker) return "A"; // 單講者模式：沒有 speaker 欄位一律標 A
    if (!seen.has(rawSpeaker)) seen.set(rawSpeaker, letters[seen.size] || "?");
    return seen.get(rawSpeaker);
  };
})();

const lines = [];
for (const seg of segments) {
  const text = String(seg.text || "").trim();
  if (!text) continue;
  const label = speakerLabel(seg.speaker);
  lines.push(`**${label}**：${text}`);
}

fs.writeFileSync(mdPath, lines.join("\n\n") + (lines.length ? "\n" : ""));
console.log(`寫入 ${mdPath}（${lines.length} 段）`);
