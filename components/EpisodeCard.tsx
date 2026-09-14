import Link from "next/link";
import { displayTitle, epLabel, fmtDuration, type EpisodeRow } from "@/lib/episodes";
import { fmtDate } from "@/lib/format";

export type EpisodeCardRow = Pick<EpisodeRow, "id" | "key" | "series" | "ep_no" | "title" | "short_title" | "pub_date" | "duration" | "image" | "cover" | "summary">;

/* 集數卡片：首頁、集數列表、來賓頁、相關集數共用同一套標記與樣式 */
export default function EpisodeCard({ e, fallbackCover = "", style }: { e: EpisodeCardRow; fallbackCover?: string; style?: React.CSSProperties }) {
  const cover = e.cover || e.image || fallbackCover;
  return (
    <Link className="ep-card" href={`/ep/${e.key}`} data-reveal style={style}>
      <div className="cover">
        {cover ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img src={cover} alt="" loading="lazy" />
        ) : (
          <div className="ph">?</div>
        )}
        <span className="ep-no sans">{epLabel(e.series, e.ep_no)}</span>
      </div>
      <div className="body">
        <h3>{displayTitle(e)}</h3>
        {e.summary && <p>{e.summary}</p>}
        <div className="meta sans">
          {e.pub_date && <span>{fmtDate(e.pub_date)}</span>}
          {e.duration > 0 && <span>{fmtDuration(e.duration)}</span>}
        </div>
      </div>
    </Link>
  );
}
