import type { Metadata } from "next";
import Link from "next/link";
import db from "@/lib/db";
import PublishToggle from "@/components/PublishToggle";
import SortButtons from "@/components/SortButtons";
import { requireAdmin } from "@/lib/admin-guard";
import PageHead from "@/components/admin/PageHead";
import Empty from "@/components/admin/Empty";

export const metadata: Metadata = { title: "來賓管理" };

type Row = { id: number; slug: string; name: string; title: string; photo: string; intro: string; published: number; featured: number; views: number; n: number };

/* 來賓列表：同步時從標題自動建的來賓只有名字，這裡看得出哪幾位還沒補資料 */
export default async function AdminGuests() {
  await requireAdmin();
  const list = db
    .prepare(
      `SELECT g.*, COUNT(eg.episode_id) AS n FROM guests g LEFT JOIN episode_guests eg ON eg.guest_id=g.id
       GROUP BY g.id ORDER BY g.sort, g.id`
    )
    .all() as Row[];
  const bare = list.filter((g) => !g.intro && !g.photo).length;

  return (
    <>
      <PageHead
        title="來 賓"
        sub={<>{list.length} 位{bare > 0 && <>，{bare} 位還沒有簡介或照片</>}</>}
        action={<Link className="btn fill" href="/admin/guests/new">新增來賓</Link>}
      />
      {list.length === 0 ? (
        <Empty>還沒有來賓。集數同步時會從標題的 feat. 自動建，或按右上角手動新增。</Empty>
      ) : (
        <>
          <div className="ad-rows">
            {list.map((g) => (
              <div className="ad-row withbtn" key={g.id} data-tone={g.published ? (g.intro || g.photo ? "ok" : "pending") : "muted"}>
                <span className="ad-l">
                  <span className="ad-nm">
                    <Link href={`/admin/guests/${g.id}`}>{g.name}</Link>
                    <span className="no">　{g.title || "（沒有頭銜）"}{!g.intro && !g.photo ? "・待補資料" : ""}{g.featured ? "・精選" : ""}</span>
                  </span>
                  <span className="ad-tm sans">/guests/{g.slug}・{g.n} 集</span>
                </span>
                <span className="ad-r">
                  <span className="ad-amt sans">{(g.views || 0).toLocaleString()}</span>
                  <span className="ad-rowbtn">
                    <PublishToggle table="guests" id={g.id} published={g.published === 1} onLabel="顯示中" offLabel="隱藏中" />
                  </span>
                </span>
              </div>
            ))}
          </div>
          <div className="ad-tablebox">
            <div className="adm-table-wrap">
              <table className="adm-table">
                <thead><tr><th>順序</th><th>名字</th><th>頭銜</th><th className="sans num">集數</th><th className="sans num">觀看</th><th>狀態</th><th></th></tr></thead>
                <tbody>
                  {list.map((g, i) => (
                    <tr key={g.id}>
                      <td className="acts"><SortButtons table="guests" id={g.id} isFirst={i === 0} isLast={i === list.length - 1} /></td>
                      <td data-label="名字"><Link href={`/admin/guests/${g.id}`}>{g.name}</Link></td>
                      <td data-label="頭銜">{g.title}</td>
                      <td className="sans num">{g.n}</td>
                      <td className="sans num">{(g.views || 0).toLocaleString()}</td>
                      <td className="acts"><PublishToggle table="guests" id={g.id} published={g.published === 1} onLabel="顯示中" offLabel="隱藏中" /></td>
                      <td className="acts"><a href={`/guests/${g.slug}`} target="_blank">預覽 ↗</a></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </>
  );
}
