"use server";
import { redirect } from "next/navigation";
import { isAdmin } from "@/lib/auth";
import { setSetting } from "@/lib/db";
import { COPY_EVENTS, type CopyField } from "@/lib/notify-copy";

/* 與 app/admin/actions.ts 同一套守門：不是站長就丟回登入頁 */
async function guard() {
  if (!(await isAdmin())) redirect("/admin/login");
}

const FIELDS: CopyField[] = ["subject", "p1", "btn", "btn2", "line", "sms"];

/*
 * 通知文案（docs/notify-spec.md 第七章）。
 * 每一格存成 ncopy_<事件>_<格>，空字串＝用 lib/notify-copy 的預設。
 * 表單裡沒有的欄位不動（舊分頁按儲存不會把新欄位清掉，同 saveCopy 的做法）。
 */
export async function saveNotifyCopy(formData: FormData) {
  await guard();
  for (const ev of COPY_EVENTS) {
    for (const f of FIELDS) {
      const v = formData.get(`ncopy_${ev.key}_${f}`);
      if (v !== null) setSetting(`ncopy_${ev.key}_${f}`, String(v).trim());
    }
  }
  redirect("/admin/settings/notify?saved=1");
}
