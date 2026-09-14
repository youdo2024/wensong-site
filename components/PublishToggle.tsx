import { togglePublished } from "@/app/admin/actions";

/* 後台清單的顯示/隱藏一鍵切換 */
export default function PublishToggle({
  table,
  id,
  published,
  onLabel = "顯示中",
  offLabel = "已隱藏",
}: {
  table: "articles" | "products" | "episodes" | "guests";
  id: number;
  published: boolean;
  onLabel?: string;
  offLabel?: string;
}) {
  return (
    <form action={togglePublished} style={{ display: "inline" }}>
      <input type="hidden" name="table" value={table} />
      <input type="hidden" name="id" value={id} />
      <button type="submit" className="btn sm" title={published ? "點一下隱藏" : "點一下顯示"}>
        {published ? onLabel : offLabel}
      </button>
    </form>
  );
}
