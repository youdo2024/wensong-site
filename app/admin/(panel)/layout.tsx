import "./admin.css";
import { redirect } from "next/navigation";
import { isAdmin, adminPasswordIsDefault } from "@/lib/auth";
import AdminNav from "@/components/AdminNav";
import ViewToggle from "@/components/admin/ViewToggle";
import { adminTodo } from "@/lib/admin-todo";
import { lineEnabled, lineNotifyOn, lineTestMode, lineTestUserIds } from "@/lib/line";
import { notifyPaused, notifyDryRun } from "@/lib/remind";

export const dynamic = "force-dynamic";

export const metadata = { robots: { index: false, follow: false } };

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  if (!(await isAdmin())) redirect("/admin/login");
  /* 待辦數：側欄徽章與手機底部列用。layout 每次請求都跑，數字永遠是現況 */
  const todo = adminTodo();
  const badges: Record<string, number> = {
    /* 訂單徽章只算「要處理」的：待付款、付款失敗、待聯絡、可疑款項。待出貨不算（看總覽的卡） */
    "/admin/orders": todo.attention + todo.contact + todo.suspect,
    "/admin/partners": todo.lateWeeks,
  };
  return (
    <div className="adm">
      <AdminNav badges={badges} />
      <main className="adm-main">
        {/* 手機：卡片／表格切換放在內容最上面一列，不再浮在畫面上擋東西 */}
        <div className="adm-viewbar"><ViewToggle /></div>
        {/*
          後台密碼還是預設值的警告。
          放在 layout 而不是設定頁，因為會漏設的人本來就不常去設定頁；
          放這裡代表每一頁都躲不掉，看到煩了就會去把它設掉——那正是目的。
          adminPasswordIsDefault() 定義了很久卻從來沒有人呼叫，形同沒做。
        */}
        {/* 通知整合：暫停或 dry run 時每頁提示，免得忘了關 */}
        {notifyPaused() && <p className="msg-err">自動提醒暫停中：待付款提醒、失敗通知、扣款失敗通知一律不寄。到網站設定關掉「暫停所有自動提醒」才會恢復。</p>}
        {!notifyPaused() && notifyDryRun() && <p className="msg-ok">通知目前是「只記錄不寄」：提醒中心看得到本來會寄給誰，一封都不會真的寄。確認沒問題後到網站設定關掉這個開關。</p>}
        {adminPasswordIsDefault() && (
          <p className="msg-err narrow">
            ⚠️ 主機沒有設定 <b className="sans">ADMIN_PASSWORD</b>，後台目前用的是原始碼裡的預設密碼。
            任何知道網址的人都進得來，看得到全部訂單、贊助者與收件地址。
            請到 Zeabur 的環境變數設一組新密碼後重新部署。
          </p>
        )}
        {lineEnabled() && lineNotifyOn() && lineTestMode() && (
          <p className="msg-err narrow">
            <b>LINE 測試模式中</b>：只推給白名單的 {lineTestUserIds().length} 個 userId，其他客人走 Email 與簡訊。測完到「網站設定」清空白名單。
          </p>
        )}
        {children}
      </main>
    </div>
  );
}
