#!/usr/bin/env bash
# 問爽的 27 集逐字稿批次跑批。細節見同目錄 README.md。
#
# 逐集流程：下載 mp3（已存在就跳過）→ whisperx 轉錄 → 轉成 out/<key>.md。
# 單集失敗記進 out/failed.txt，繼續跑下一集，不中斷整批。
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

mkdir -p audio out
FAILED_LOG="out/failed.txt"

WHISPERX_BIN="${WHISPERX_BIN:-$HOME/.local/pipx/venvs/whisperx/bin/whisperx}"
MODEL="${WHISPER_MODEL:-medium}"          # 8GB RAM 建議 small 或 medium
COMPUTE_TYPE="${WHISPER_COMPUTE_TYPE:-int8}"
BATCH_SIZE="${WHISPER_BATCH_SIZE:-4}"

if [ ! -x "$WHISPERX_BIN" ]; then
  echo "[run] 找不到 whisperx 執行檔：$WHISPERX_BIN" >&2
  echo "[run] 這台機器應該在 ~/.local/pipx/venvs/whisperx/bin/whisperx，換路徑請設 WHISPERX_BIN" >&2
  exit 1
fi

# 有 HF_TOKEN 才分講者；沒有就是單講者模式（json-to-md.mjs 全部標成 A）。
DIARIZE_ARGS=()
if [ -n "${HF_TOKEN:-}" ]; then
  echo "[run] 偵測到 HF_TOKEN，啟用分講者（--diarize，2~4 人）"
  DIARIZE_ARGS=(--diarize --min_speakers 2 --max_speakers 4 --hf_token "$HF_TOKEN")
else
  echo "[run] 沒有 HF_TOKEN：改用單講者模式，所有段落先標 A，之後人工分維尼／安妮／來賓"
  # ASR（faster-whisper-medium）與對齊模型（wav2vec2 zh）已在本機快取，
  # 不分講者就不需要碰網路，開離線模式避免卡在等逾時。
  export HF_HUB_OFFLINE=1
fi

echo "[run] 讀集數清單（transcript 為空的集數）..."
LIST_JSON="/tmp/wensong-transcribe-episodes.json"
node list-episodes.mjs > "$LIST_JSON"
COUNT=$(node -e "console.log(JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).length)" "$LIST_JSON")
echo "[run] 共 $COUNT 集待跑"

LIST_TSV="/tmp/wensong-transcribe-episodes.tsv"
node -e "
const rows = JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'));
for (const r of rows) process.stdout.write(r.key + '\t' + r.audio_url + '\n');
" "$LIST_JSON" > "$LIST_TSV"

N=0
while IFS=$'\t' read -r KEY AUDIO_URL; do
  [ -z "$KEY" ] && continue
  N=$((N + 1))
  echo ""
  echo "===== [$N/$COUNT] 集數 $KEY ====="

  MP3="audio/$KEY.mp3"
  MD="out/$KEY.md"
  JSON="out/$KEY.json"

  if [ -s "$MD" ]; then
    echo "[run] out/$KEY.md 已存在，跳過"
    continue
  fi

  if [ ! -s "$MP3" ]; then
    echo "[run] 下載音檔..."
    if ! curl -sL --fail -o "$MP3.part" "$AUDIO_URL"; then
      echo "$KEY: 下載失敗" >> "$FAILED_LOG"
      rm -f "$MP3.part"
      continue
    fi
    mv "$MP3.part" "$MP3"
  else
    echo "[run] audio/$KEY.mp3 已存在，跳過下載"
  fi

  echo "[run] 跑 whisperx（model=$MODEL, compute_type=$COMPUTE_TYPE）..."
  if ! "$WHISPERX_BIN" "$MP3" \
      --model "$MODEL" \
      --language zh \
      --compute_type "$COMPUTE_TYPE" \
      --device cpu \
      --batch_size "$BATCH_SIZE" \
      --output_dir out \
      --output_format json \
      --initial_prompt "$(cat glossary/prompt.txt)" \
      ${DIARIZE_ARGS[@]+"${DIARIZE_ARGS[@]}"} \
      > "out/$KEY.log" 2>&1; then
    echo "$KEY: whisperx 執行失敗，見 out/$KEY.log" >> "$FAILED_LOG"
    continue
  fi

  if [ ! -s "$JSON" ]; then
    echo "$KEY: whisperx 沒有產出 $JSON" >> "$FAILED_LOG"
    continue
  fi

  echo "[run] 轉成 md..."
  if ! node json-to-md.mjs "$KEY"; then
    echo "$KEY: json 轉 md 失敗" >> "$FAILED_LOG"
    continue
  fi

  echo "[run] $KEY 完成 -> out/$KEY.md"
done < "$LIST_TSV"

echo ""
echo "[run] 整批跑完。"
if [ -s "$FAILED_LOG" ]; then
  echo "[run] 有集數失敗，見 $FAILED_LOG："
  cat "$FAILED_LOG"
else
  echo "[run] 沒有失敗紀錄。"
fi
