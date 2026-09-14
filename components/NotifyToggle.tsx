import { toggleProductNotify } from "@/app/admin/actions";

/* 商品「購買通知」開關：開啟的商品有人付款就寄信到通知信箱 */
export default function NotifyToggle({ id, notify }: { id: number; notify: boolean }) {
  return (
    <form action={toggleProductNotify} style={{ display: "inline" }}>
      <input type="hidden" name="id" value={id} />
      <button type="submit" className="btn sm" title={notify ? "點一下關閉購買通知" : "點一下開啟購買通知"}>
        {notify ? "🔔 通知中" : "通知關"}
      </button>
    </form>
  );
}
