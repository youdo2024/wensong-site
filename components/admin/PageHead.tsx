import Link from "next/link";
import Ico from "./Ico";

/*
 * 每一頁的頁首：返回、標題、一句話說明，右邊最多一顆主動作。
 *
 * 站長的第一條原則是「一頁只做一件事」，副標就是那句話。
 * 主動作只給一顆是刻意的：兩顆以上代表這頁其實在做兩件事，該拆頁而不是加鈕。
 */
export default function PageHead({
  title, sub, back, action,
}: {
  title: React.ReactNode;
  sub?: React.ReactNode;
  /* 返回上一層。沒有上一層就不要放，麵包屑不是裝飾 */
  back?: { href: string; label: string };
  action?: React.ReactNode;
}) {
  return (
    <div className="ad-head">
      <div>
        {back && (
          <Link href={back.href} className="back">
            <Ico n="left" size={14} />{back.label}
          </Link>
        )}
        <h1>{title}</h1>
        {sub && <p className="sub">{sub}</p>}
      </div>
      {action}
    </div>
  );
}
