import { moveItem } from "@/app/admin/actions";

/* 後台清單的上移/下移箭頭 */
export default function SortButtons({
  table,
  id,
  isFirst,
  isLast,
}: {
  table: "articles" | "products" | "episodes" | "guests";
  id: number;
  isFirst: boolean;
  isLast: boolean;
}) {
  return (
    <div className="row-tools">
      <form action={moveItem}>
        <input type="hidden" name="table" value={table} />
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="dir" value="up" />
        <button type="submit" className="ibtn" disabled={isFirst} title="上移">▲</button>
      </form>
      <form action={moveItem}>
        <input type="hidden" name="table" value={table} />
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="dir" value="down" />
        <button type="submit" className="ibtn" disabled={isLast} title="下移">▼</button>
      </form>
    </div>
  );
}
