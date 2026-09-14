/*
 * cookie 的 Secure 旗標。
 *
 * 正式站一律 Secure（https）。唯一的例外是本機 Tailscale 預覽：
 * 站長人在外面用 http://100.x.x.x:3000 驗收，Secure cookie 存不進瀏覽器，
 * 後台與工作台的登入會靜靜失敗（輸入密碼後彈回登入頁，看起來像密碼錯）。
 * 設 INSECURE_PREVIEW=1 才關閉 Secure——這個變數只准出現在本機 tmux 的啟動指令，
 * 絕不可設進 Zeabur。正式站沒設它，行為與過去完全相同。
 */
export function cookieSecure(): boolean {
  return process.env.NODE_ENV === "production" && process.env.INSECURE_PREVIEW !== "1";
}
