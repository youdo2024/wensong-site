import fs from "fs";
import path from "path";
import zlib from "zlib";
import crypto from "crypto";
import { execFile } from "child_process";
import { promisify } from "util";
import db, { DATA_DIR, getSetting, setSetting } from "./db";
import { sendMail, wrapOwnerMail, mailEnabled } from "./mail";

/*
 * 每日自動備份：把整個 data/（site.db ＋ 後台上傳的圖片）打包寄到站長信箱。
 * Zeabur 這顆磁碟一旦故障、誤刪或服務中止，資料就沒了；程式碼在 GitHub 上，
 * 唯獨這份資料沒有第二份。訂單與贊助憑證依稅法須保存 5～7 年，這是必要的保險。
 *
 * 設計取捨：
 * - 用 tar 打包整個 data/（容器是 debian-slim，tar 內建）；tar 失敗時退回只壓資料庫，
 *   確保「最重要的那份」在任何情況下都寄得出去。
 * - 資料沒變就不寄（比對內容雜湊），避免每天塞一封一模一樣的信。
 * - 附件過大時（信箱多半限制 25MB）只寄資料庫並在信裡說明。
 */

const execFileP = promisify(execFile);
const MAX_ATTACH = 20 * 1024 * 1024; // 20MB，留餘裕給信件編碼膨脹

export type BackupResult = {
  ok: boolean;
  skipped?: "unchanged" | "no-mail" | "no-recipient";
  filename?: string;
  bytes?: number;
  mode?: "full" | "db-only";
  msg?: string;
};

function ymdTaipei(): string {
  const d = new Date(Date.now() + 8 * 3600 * 1000);
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}-${String(d.getUTCHours()).padStart(2, "0")}${String(d.getUTCMinutes()).padStart(2, "0")}`;
}

function recipients(): string[] {
  return getSetting("owner_notify_emails", "")
    .split(/[,，;\s]+/)
    .map((s) => s.trim())
    .filter((s) => s.includes("@"));
}

/* SQLite 熱備份：直接複製檔案可能抓到寫入中的狀態，用 VACUUM INTO 產出一致的快照 */
function snapshotDb(tmpPath: string) {
  if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
  db.prepare("VACUUM INTO ?").run(tmpPath);
}

function dirSize(dir: string): number {
  let total = 0;
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile()) total += fs.statSync(p).size;
    }
  };
  try { walk(dir); } catch {}
  return total;
}

export async function runBackup(opts: { force?: boolean } = {}): Promise<BackupResult> {
  if (!mailEnabled()) return { ok: false, skipped: "no-mail", msg: "SMTP 未設定，無法寄出備份" };
  const to = recipients();
  if (to.length === 0) return { ok: false, skipped: "no-recipient", msg: "站長通知信箱未設定" };

  const tmpDb = path.join(DATA_DIR, `.backup-snapshot.db`);
  let payload: Buffer;
  let filename: string;
  let mode: "full" | "db-only" = "full";
  const stamp = ymdTaipei();

  try {
    snapshotDb(tmpDb);
    const imagesDir = path.join(DATA_DIR, "images");
    const imagesBytes = fs.existsSync(imagesDir) ? dirSize(imagesDir) : 0;
    const dbBytes = fs.statSync(tmpDb).size;

    /* 圖片本身已是壓縮格式，加上資料庫壓縮後仍過大時，只寄資料庫 */
    const tooBig = dbBytes / 3 + imagesBytes > MAX_ATTACH;
    if (!tooBig && fs.existsSync(imagesDir)) {
      try {
        const tarPath = path.join(DATA_DIR, `.backup-${stamp}.tar.gz`);
        /* 排除 images/.cache：那裡面是 /api/images 依需求產生的縮圖，
           原圖還在就一定生得回來，備份它只會讓附件變大、更容易撞到信箱的 25MB 上限。 */
        await execFileP("tar", ["-czf", tarPath, "--exclude", ".cache", "-C", DATA_DIR, path.basename(tmpDb), "images"]);
        payload = fs.readFileSync(tarPath);
        fs.unlinkSync(tarPath);
        filename = `wensong-backup-${stamp}.tar.gz`;
      } catch {
        mode = "db-only";
        payload = zlib.gzipSync(fs.readFileSync(tmpDb));
        filename = `wensong-db-${stamp}.db.gz`;
      }
    } else {
      mode = "db-only";
      payload = zlib.gzipSync(fs.readFileSync(tmpDb));
      filename = `wensong-db-${stamp}.db.gz`;
    }

    /* 資料沒變就不寄（雜湊只看資料庫內容，圖片增減也會反映在資料庫的引用上） */
    const hash = crypto.createHash("sha256").update(fs.readFileSync(tmpDb)).digest("hex");
    if (!opts.force && getSetting("backup_last_hash", "") === hash) {
      return { ok: true, skipped: "unchanged", msg: "資料與上次備份相同，這次不寄信" };
    }

    /* 會員的資料表叫 users，不是 members。原本寫錯的那個名字查不到表，
       整句被 try/catch 吞掉，備份信上就默默少一行，看信的人不會發現會員數從來沒出現過 */
    const counts = ["articles", "products", "orders", "sponsorships", "chefs", "users", "subscribers"]
      .map((t) => {
        try { return `${t} ${(db.prepare(`SELECT COUNT(*) c FROM "${t}"`).get() as { c: number }).c}`; } catch { return ""; }
      })
      .filter(Boolean)
      .join("・");

    const kb = Math.round(payload.length / 1024);
    const html = wrapOwnerMail(
      "網站每日備份",
      `<p style="font-size:15px;line-height:2;">附件是 ${stamp.slice(0, 8)} 的網站完整資料備份，請保留這封信（或另存到雲端硬碟）。</p>
       <p style="font-size:13.5px;color:#7C7060;line-height:2;">
         檔案：${filename}（${kb.toLocaleString()} KB）<br>
         內容：${mode === "full" ? "資料庫 ＋ 後台上傳的圖片" : "僅資料庫（圖片過大，未含在內）"}<br>
         資料筆數：${counts}
       </p>
       <p style="font-size:13px;color:#7C7060;line-height:1.9;">
         還原方式：解開附件後把 site.db 放回主機的 data/ 目錄（檔名改回 site.db），圖片放回 data/images/，重新啟動即可。
         程式碼本身在 GitHub，換任何一家主機都能重新部署。
       </p>`
    );

    let sent = false;
    for (const addr of to) {
      /*
       * 附件直接給 Buffer，不要先轉 base64 字串。
       *
       * 2026-09-05 之前寄出去的每一封備份信都是雙層 base64：這裡先把 gz 轉成
       * base64 字串，nodemailer 9 又把那串字當成 UTF-8 純文字再編一次，
       * 於是解開附件拿到的是 "H4sIAAAAAAAA..." 這串 ASCII 文字，而不是 gzip 的
       * 開頭位元組 1f 8b，直接 gunzip 一定失敗。
       *
       * 要救舊備份：把附件解 base64 兩次再 gunzip。指令示意
       *   base64 -d < 附件檔 | base64 -d > site.db.gz && gunzip site.db.gz
       * （第一次解的是信件本身的 base64 傳輸編碼，多數信件軟體另存附件時已經幫你做掉了，
       *   那種情況只要再對存下來的檔案做一次 base64 -d 就好。）
       */
      const ok = await sendMail(addr, `網站備份 ${stamp.slice(0, 8)}｜問爽的`, html, [
        { filename, content: payload, contentType: "application/gzip" },
      ], { kind: "owner" });
      if (ok) sent = true;
    }
    if (sent) {
      setSetting("backup_last_hash", hash);
      setSetting("backup_last_at", new Date().toISOString());
    }
    return { ok: sent, filename, bytes: payload.length, mode, msg: sent ? "備份已寄出" : "寄送失敗" };
  } catch (e) {
    return { ok: false, msg: e instanceof Error ? e.message : "備份失敗" };
  } finally {
    try { if (fs.existsSync(tmpDb)) fs.unlinkSync(tmpDb); } catch {}
  }
}

/* 當天最多寄幾次。
   1 次太少：真的遇到網路抽風就整天沒備份。
   無上限則是 2026-08-14 那天的狀況：一個早上連寄五封，每半小時一封。 */
const MAX_TRIES_PER_DAY = 2;

function failsToday(today: string): number {
  if (getSetting("backup_fail_day", "") !== today) return 0;
  return Number(getSetting("backup_fail_count", "0")) || 0;
}

/* 失敗與成功時的狀態轉換抽出來，一來排程裡讀起來乾淨，二來可以直接測。
   會出事的就是這段，值得有測試盯著。 */
export function recordBackupFailure(today: string, why: string): { fails: number; stopped: boolean } {
  const fails = failsToday(today) + 1;
  const stopped = fails >= MAX_TRIES_PER_DAY;
  setSetting("backup_fail_day", today);
  setSetting("backup_fail_count", String(fails));
  setSetting("backup_last_error", `${today} 第 ${fails} 次失敗：${why}`);
  /* 還有額度就把當天標記清掉讓半小時後重試，用完了就標成今天做過，停到隔天 */
  setSetting("backup_last_day", stopped ? today : "");
  return { fails, stopped };
}

export function clearBackupFailure(): void {
  setSetting("backup_fail_count", "0");
  setSetting("backup_last_error", "");
}

/* 每日備份排程：台北時間凌晨 4 到 6 點之間跑，每天成功一次為止 */
const g = globalThis as unknown as { __yoBackupTimer?: ReturnType<typeof setInterval> };
export function startBackupLoop() {
  /* 比照 recurring：同一個 process 只註冊一次，免得排程被掛上好幾份 */
  if (g.__yoBackupTimer) return;

  const tick = async () => {
    const now = new Date(Date.now() + 8 * 3600 * 1000);
    const today = now.toISOString().slice(0, 10);
    const hour = now.getUTCHours();
    if (hour < 4 || hour > 6) return;
    if (getSetting("backup_last_day", "") === today) return;

    /*
     * 失敗處理的來歷，值得寫清楚免得又改回去。
     *
     * 最早的版本在跑之前就標記「今天做過了」，失敗也照標，於是那天不再試，
     * 而失敗只進 console，站長不會知道備份已經斷了。
     * 改成失敗就把標記放回去、當天可以重試之後，換成另一個問題：
     * 寄信「回報失敗但信其實已經送達」時，它會每半小時重寄一次，一路寄到六點。
     * 2026-08-14 就這樣寄了五封一模一樣的備份信。
     *
     * 現在兩邊都收：失敗照樣重試，但當天有次數上限，用完就停到隔天，
     * 並把原因寫進 backup_last_error，後台看得到，不會安靜地斷掉。
     */
    let claimed = false;
    const markFailed = (why: string) => {
      const { fails, stopped } = recordBackupFailure(today, why);
      if (stopped) console.error(`[backup] ⚠️ 今天已失敗 ${fails} 次，停止自動重試。原因：${why}`);
      else console.error("[backup] ⚠️ 備份失敗，半小時後再試：", why);
    };

    try {
      /* 先佔位，避免同一個時間窗內重複觸發 */
      setSetting("backup_last_day", today);
      claimed = true;
      const r = await runBackup();
      console.log("[backup]", JSON.stringify(r));
      /* skipped 是「不需要寄」（資料沒變、沒設信箱、沒設 SMTP），那不算失敗 */
      if (r.ok || r.skipped) {
        clearBackupFailure();
        return;
      }
      markFailed(r.msg || "未知原因");
    } catch (e) {
      const why = e instanceof Error ? e.message : String(e);
      console.error("[backup loop]", e);
      /* 例外一樣計入次數，否則丟例外的路徑會變成無上限重試 */
      if (claimed) markFailed(why);
    }
  };

  /* unref：比照其他排程，計時器不該讓 process 無法自然結束 */
  g.__yoBackupTimer = setInterval(tick, 30 * 60 * 1000); // 每半小時檢查一次
  g.__yoBackupTimer.unref?.();
  setTimeout(tick, 60 * 1000).unref?.();
}
