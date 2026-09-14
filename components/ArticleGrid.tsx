import Link from "next/link";
import { json } from "@/lib/db";

/* 文章卡片列表：與 /articles 的卡片完全同一套標記與樣式，分類頁／標籤頁／作者頁共用 */
export type ArticleCard = {
  id: number; slug: string; title: string; category: string;
  tags: string; date: string; summary: string; author: string; cover: string;
};

export default function ArticleGrid({ list }: { list: ArticleCard[] }) {
  return (
    <div className="art-grid">
      {list.length === 0 && <div className="empty">這裡還沒有文章</div>}
      {list.map((a) => (
        <Link className="card" key={a.id} href={`/articles/${a.slug}`}>
          <span className="cat-tag">{a.category}</span>
          {a.cover ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={a.cover} alt={a.title} className="cover img-fill" style={{ borderBottom: "2px solid var(--ink)" }} loading="lazy" />
          ) : (
            <div className="cover ph">封面圖</div>
          )}
          <div className="body">
            <h2>{a.title}</h2>
            <p>{a.summary}</p>
            <div className="meta">
              <div className="tt">
                {json<string[]>(a.tags, []).map((t) => (
                  <span key={t}>{t}</span>
                ))}
              </div>
              <span>{a.author || "問爽的"}</span>
            </div>
          </div>
        </Link>
      ))}
    </div>
  );
}
