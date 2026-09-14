import { permanentRedirect } from "next/navigation";

/* 「通知文案」已經併進設定・通知（ia.md §1 舊網址、§2）。理由同 /admin/copy，網址留著轉址 */
export default function AdminNotifyCopyMoved() {
  permanentRedirect("/admin/settings/notify");
}
