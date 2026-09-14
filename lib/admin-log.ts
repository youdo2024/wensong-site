import db from "./db";
import { currentAdmin } from "./auth";

/*
 * 後台修改記錄（第 2 段：3 帳號各自登入，要記得住誰改了什麼）。
 *
 * app/admin/actions.ts 裡真的會動資料的 action 存完檔之後呼叫一次。
 * 登入者名字直接讀 currentAdmin()（session cookie 裡帶的），讀不到就記「站長」，
 * 不要因為身分讀不到就讓整個存檔動作跟著失敗。
 */
export async function logAdmin(action: string, target = "", detail = ""): Promise<void> {
  let name = "站長";
  try {
    const admin = await currentAdmin();
    if (admin?.name) name = admin.name;
  } catch {
    /* 讀不到登入者不影響要不要記，記錄本身比精準的署名重要 */
  }
  try {
    db.prepare("INSERT INTO admin_log (user_name,action,target,detail,created_at) VALUES (?,?,?,?,?)").run(
      name,
      action,
      target,
      detail,
      new Date().toISOString()
    );
  } catch (e) {
    console.error("[admin-log] 寫入失敗", e);
  }
}
