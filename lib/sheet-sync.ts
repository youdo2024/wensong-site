import { getSetting, setSetting } from "./db";
import { runSheetSync, sheetCsvUrl, SYNC_KEY_DAY } from "./subscriber-import";

/*
 * 訂閱名單每日自動同步（2026-09-07）。
 *
 * 形狀完全照 lib/backup.ts 的 startBackupLoop()：module 層的計時器旗標讓同一個
 * process 只註冊一次、台北時間的時間窗、一個「最後成功的日期」設定值讓它一天只跑一次。
 *
 * 時間窗選凌晨 3 點是為了避開備份（4 到 6 點）。兩件事都會讀寫資料庫也都會對外連線，
 * 疊在一起的話備份撈到的是同步跑到一半的資料庫，而且失敗訊息會混在一起難查。
 */

/* 一天的哪一個小時跑。改這裡就好，別散在兩個地方 */
export const SYNC_HOUR = 3;
/* 檢查間隔。時間窗只有一小時，所以一天最多試兩次 */
export const SYNC_TICK_MS = 30 * 60 * 1000;

/*
 * 「現在該不該跑」抽成純函式，跟時間、網路、資料庫都脫鉤，測試直接餵參數就能驗。
 * 會出事的判斷就是這四個條件，值得有測試盯著。
 */
export function shouldSyncNow(x: { hour: number; today: string; lastDay: string; hasUrl: boolean }): boolean {
  /* 沒設試算表網址就整個功能不存在，不記錄也不報錯 */
  if (!x.hasUrl) return false;
  if (x.hour !== SYNC_HOUR) return false;
  /* 今天已經成功過就不再跑 */
  if (x.lastDay === x.today) return false;
  return true;
}

const g = globalThis as unknown as {
  __yoSheetSyncTimer?: ReturnType<typeof setInterval>;
  __yoSheetSyncBusy?: boolean;
};

export function startSheetSyncLoop(): void {
  /* 比照 backup／recurring：同一個 process 只註冊一次，免得排程被掛上好幾份 */
  if (g.__yoSheetSyncTimer) return;

  const tick = async () => {
    try {
      const now = new Date(Date.now() + 8 * 3600 * 1000);
      const today = now.toISOString().slice(0, 10);
      if (!shouldSyncNow({
        hour: now.getUTCHours(),
        today,
        lastDay: getSetting(SYNC_KEY_DAY, ""),
        hasUrl: Boolean(sheetCsvUrl()),
      })) return;
      /* 同一個 process 內不重入。跨 process 不必上鎖：重複匯入是冪等的
         （已存在只會加到 existed），最壞情況是多抓一次試算表 */
      if (g.__yoSheetSyncBusy) return;
      g.__yoSheetSyncBusy = true;
      try {
        const r = await runSheetSync("auto");
        /*
         * 失敗不標記「今天做過了」，理由跟 backup 那邊記過的一樣但結論相反一半：
         * 這件事沒有「寄出去收不回來」的風險，重跑一次頂多是再抓一次 CSV，
         * 所以失敗就讓它留在未完成，時間窗內下一個 tick 會再試。
         * 又因為只有 tick 會呼叫它，重試最密也就是 30 分鐘一次，不會變成連環打。
         * 時間窗過了還是失敗的話今天就到此為止，失敗原因已經寫進 sheet_sync_last_error，
         * 後台匯入區印得出來，站長看得到、可以自己按那顆鈕。
         */
        if (r.ok) setSetting(SYNC_KEY_DAY, today);
        else console.error("[sheet-sync] 自動同步失敗，時間窗內會再試：", r.msg);
      } finally {
        g.__yoSheetSyncBusy = false;
      }
    } catch (e) {
      /* 排程的例外絕不能往外丟：這裡丟出去會變成沒有人接的 rejection */
      console.error("[sheet-sync loop]", e);
    }
  };

  /* unref：比照其他排程，計時器不該讓 process 無法自然結束 */
  g.__yoSheetSyncTimer = setInterval(tick, SYNC_TICK_MS);
  g.__yoSheetSyncTimer.unref?.();
  /* 開機後晚一點跑第一次，避開部署當下的忙碌；跟備份的 60 秒錯開 */
  setTimeout(tick, 90 * 1000).unref?.();
}
