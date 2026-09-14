# 問爽的逐字稿批次工具

把 27 集《問爽的 WenSong》mp3 用本機 WhisperX 轉成逐字稿，再推進網站資料庫（`episodes.transcript`）。

## 這台機器的 WhisperX 在哪

沿用 Creator OS／免剪剪輯系統裝好的那套，不是新裝的：

- 執行檔：`~/.local/pipx/venvs/whisperx/bin/whisperx`（pipx 裝的獨立虛擬環境）
- 模型快取：`~/.cache/huggingface/hub`，已經有 `Systran/faster-whisper-medium`（語音辨識）與
  `jonatasgrosman/wav2vec2-large-xlsr-53-chinese-zh-cn`（WhisperX 中文對齊模型，剛好是
  WhisperX 內建 zh 的預設對齊模型），VAD 模型是 WhisperX 套件自帶的資產檔，不必額外下載。
- **沒有 HF_TOKEN**：翻遍 shell rc 檔、免剪的 `.env`、`~/.cache/huggingface` 都沒找到。分講者
  （diarization）要用的 `pyannote/speaker-diarization-*` 是 gated model，沒 token 抓不下來，
  所以**這批全部用單講者模式**：`out/<key>.md` 裡每一段都先標成「**A**」，之後要靠人工聽出來
  分維尼／安妮／來賓，改法是直接在 md 裡把 `**A**` 換成對的名字。
  之後如果要補 diarization：申請 https://huggingface.co/pyannote/speaker-diarization-community-1
  的使用授權、`huggingface-cli login` 或設 `HF_TOKEN` 環境變數，`run.sh` 偵測到 `HF_TOKEN`
  就會自動加 `--diarize --min_speakers 2 --max_speakers 4`。

## 怎麼跑

```bash
cd tools/transcribe

# 1. 先跑最短的一集（EP0 試播集，key "0"，14.8 分鐘）驗證輸出格式
bash -c '
  node list-episodes.mjs   # 確認清單長相
  ./run.sh                 # 會照 duration 由短到長跑，第一集就是 0
'

# 2. 確認 out/0.md 格式沒問題之後，整批丟進 tmux 背景跑（不要用一般背景工作，
#    對話一結束伺服器類的東西會死，但這支腳本無所謂；仍建議用 tmux + caffeinate
#    以防機器閒置睡著，且方便隨時用手機／MacBook 透過 Tailscale 連回來看進度）：
tmux new -s wensong-transcribe -d \
  "cd '$(pwd)' && caffeinate -dimsu bash run.sh"

# 看進度
tmux attach -t wensong-transcribe   # Ctrl-b d 離開不中斷
# 或不進去，只看有沒有新檔案：
ls -la out/*.md

# 停止
tmux kill-session -t wensong-transcribe
```

`run.sh` 是可重跑的：已經有 `out/<key>.md` 的集數會跳過，已經下載的 `audio/<key>.mp3` 也不會
重抓，中途中斷再跑一次就會接著沒做完的集數繼續。

## 要多久

Mac mini 是 Apple M2、8GB RAM，跑法是 `--model medium --compute_type int8 --device cpu`
（CPU 而非 GPU；`faster-whisper`／`ctranslate2` 在 Apple Silicon 上不吃 Metal/ANE，只能用 CPU）。
27 集音檔總長約 27 小時（`SUM(duration)` = 97,116 秒）。CPU int8 轉錄＋對齊抓不到穩定的
「幾倍速」，粗抓後面整批跑完大概是抓一個晚上到一整天的量級，實際數字看 EP0 那次實跑（見下段，
`out/0.log` 有完整記錄，`ps` 抓到的 wall time 可以回推速度倍率）。

如果嫌慢，可以把 `WHISPER_MODEL=small` 丟到環境變數再跑 `run.sh`（`faster-whisper-small`
沒快取過，第一次跑會先下載），準確度會下降但速度快不少，中文台語混雜的內容可能得靠
`medium` 才聽得準人名與台語詞。

## 輸出在哪

- 下載的音檔：`tools/transcribe/audio/<key>.mp3`
- whisperx 原始輸出：`tools/transcribe/out/<key>.json`（含逐字時間戳）
- 轉好的逐字稿：`tools/transcribe/out/<key>.md`，格式是每段一行
  `**講者A**：內容`，段落間空一行，開頭不加標題。
- 單集執行 log：`tools/transcribe/out/<key>.log`
- 失敗清單：`tools/transcribe/out/failed.txt`（有失敗才會有這檔，內容是「key: 原因」）

## 怎麼推進網站

`out/<key>.md` 只是本機檔案，不會自動進資料庫，要手動（或人工校對過後）推：

```bash
# 遠端（正式站或跑在 Tailscale 上的預覽站）
SITE_BASE=http://100.118.154.17:3000 IMPORT_TOKEN=xxx node push.mjs 0 13 22
SITE_BASE=http://100.118.154.17:3000 IMPORT_TOKEN=xxx node push.mjs --all

# 本機直接寫 sqlite，不經過 HTTP／API
node push.mjs 0 --local
node push.mjs --all --local          # 只寫 transcript 目前是空字串的集數
node push.mjs 0 --local --force      # 允許覆蓋已經有逐字稿的集數
```

`IMPORT_TOKEN` 對應網站的 `app/api/admin/import-transcript/route.ts`，環境變數沒設
（`.env` 裡的 `IMPORT_TOKEN`）那支 API 直接回 404，跟後台帳密系統完全分開。

## 建議流程

1. `run.sh` 整批跑完（背景，不用等）。
2. 打開 `out/<key>.md`，把 `**A**` 換成 `**維尼**` / `**安妮**` / `**來賓**`（單講者模式沒有
   自動分講者，這步是人工聽音檔判斷，或依內容脈絡猜）。
3. Claude Code 過一輪輕校對（人名、地名、台語用詞常常聽錯）。
4. `node push.mjs <key> --local`（本機先驗證）或走 `--local` 直接進 `data/site.db`，
   之後照正常流程部署／同步到正式站。
