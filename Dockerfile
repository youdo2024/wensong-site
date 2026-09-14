# 問爽的官網：Next.js + better-sqlite3（需要原生編譯工具）
#
# 基礎映像走 mirror.gcr.io 而不是 Docker Hub。
# 2026-08-30 深夜整晚部署不了就是為了這件事：Docker Hub 對匿名拉取有額度，
# 而 Zeabur 建置機的 IP 是共用的，別人先把額度用掉，我們的 build 就在第 2 步
# 「load metadata for docker.io/library/node:22-slim」收到 429 Too Many Requests，
# 兩秒鐘死掉，連我們的程式碼都還沒複製進去。重試會好，但下次還會再中。
#
# mirror.gcr.io 是 Google 對 Docker Hub 官方映像的快取，同一張映像、不必登入、
# 沒有這個額度問題。要換回去的話把兩行的 mirror.gcr.io/ 拿掉即可。
FROM mirror.gcr.io/library/node:22-slim AS builder
WORKDIR /app
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
# 2026-09-06 建置失敗就是死在這一行：npm error network，建置機連不到 npm registry。
# 程式沒問題，純粹是一次性的網路抖動，但整個部署會整個失敗，要人工再推一次才會重來。
# 所以把重試次數與逾時拉大，再包一層「整段失敗就隔十五秒重跑一次」，把抖動吃掉。
ENV npm_config_fetch_retries=6 \
    npm_config_fetch_retry_mintimeout=10000 \
    npm_config_fetch_retry_maxtimeout=120000
RUN npm ci --no-audit --no-fund || (echo "npm ci 第一次失敗，十五秒後重試" && sleep 15 && npm ci --no-audit --no-fund)
COPY . .
RUN npm run build

FROM mirror.gcr.io/library/node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app ./
EXPOSE 3000
CMD ["npm", "start"]

# 2026-08-31 部署觸發測試：Zeabur 從下午起收不到 main 的推送。
# 有部署成功與沒部署的 commit 檔案分布一模一樣（都只動 app/ lib/），
# 所以不是 watch paths 只比對根目錄的問題。這一行動的是根目錄檔案，
# 用來排除「watch paths 過濾掉子目錄」這個可能。

# 2026-09-06 補記：用「空 commit」重新觸發部署是沒有用的，Zeabur 看的是檔案變更，
# 空 commit 動不到任何檔案，它不會開始新的建置（那次的 Deployment ID 完全沒變）。
# 要重新觸發就動一個真的檔案，或到 Zeabur 面板按「重新部署」。
