import { toggleArticleCta } from "@/app/admin/actions";

/* 文章列表：文末 CTA 兩顆一鍵切換（支持商品、小額支持），每篇各自獨立，預設都開 */
export default function CtaToggle({ id, shop, support }: { id: number; shop: boolean; support: boolean }) {
  const btn = (which: "shop" | "support", onState: boolean, label: string) => (
    <form action={toggleArticleCta} style={{ display: "inline" }}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="which" value={which} />
      <button type="submit" className={`btn sm${onState ? " blue" : ""}`} title={onState ? "點一下關掉" : "點一下打開"}>
        {label}{onState ? " 開" : " 關"}
      </button>
    </form>
  );
  return (
    <span style={{ display: "inline-flex", gap: 6, flexWrap: "wrap" }}>
      {btn("shop", shop, "商品")}
      {btn("support", support, "支持")}
    </span>
  );
}
