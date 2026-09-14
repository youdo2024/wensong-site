export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    /* 集數同步：每小時醒一次，距上次超過 23 小時才抓；表是空的（第一次部署）立刻抓 */
    const { startEpisodeSyncLoop } = await import("./lib/episodes");
    startEpisodeSyncLoop();
    const { startRecurringLoop } = await import("./lib/recurring");
    startRecurringLoop();
    /* 每日資料備份（台北凌晨 4 到 6 點寄到站長信箱） */
    const { startBackupLoop } = await import("./lib/backup");
    startBackupLoop();
    /* 訂閱名單每日自動同步（台北凌晨 3 點） */
    const { startSheetSyncLoop } = await import("./lib/sheet-sync");
    startSheetSyncLoop();
    /* 自動對帳（每 15 分鐘主動去問金流商，待付款到底付了沒） */
    const { startReconcileLoop } = await import("./lib/reconcile");
    startReconcileLoop();
    /* 電子報續寄（每 20 秒推一批） */
    const { startNewsletterLoop } = await import("./lib/newsletter");
    startNewsletterLoop();
  }
}
