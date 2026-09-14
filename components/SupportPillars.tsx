/*
 * 「你的支持會變成」四格圖示卡：取代信件裡整段文字敘述（資料整理／產地拜訪／
 * 田野調查／兒童教育），一眼看完、不佔版面。圖示為手繪風細線 SVG，用印章紅。
 */

const STROKE = { fill: "none", stroke: "var(--seal)", strokeWidth: 1.6, strokeLinecap: "round", strokeLinejoin: "round" } as const;

const ITEMS: { title: string; desc: string; icon: React.ReactNode }[] = [
  {
    title: "錄音後製",
    desc: "設備、剪接與混音",
    icon: (
      <svg viewBox="0 0 24 24" {...{ width: 34, height: 34 }}>
        <path {...STROKE} d="M6 3.5h9l3 3v14H6z" />
        <path {...STROKE} d="M15 3.5v3h3" />
        <path {...STROKE} d="M9 11h6M9 14.5h4" />
      </svg>
    ),
  },
  {
    title: "來賓邀約",
    desc: "把想問的人請進來",
    icon: (
      <svg viewBox="0 0 24 24" {...{ width: 34, height: 34 }}>
        <path {...STROKE} d="M12 21c-4-4.6-6-7.8-6-10.6C6 7 8.7 4.5 12 4.5s6 2.5 6 5.9C18 13.2 16 16.4 12 21z" />
        <circle {...STROKE} cx="12" cy="10.3" r="2.2" />
      </svg>
    ),
  },
  {
    title: "逐字稿整理",
    desc: "辨識、校對、上站",
    icon: (
      <svg viewBox="0 0 24 24" {...{ width: 34, height: 34 }}>
        <circle {...STROKE} cx="10.5" cy="10.5" r="6" />
        <path {...STROKE} d="M15 15l5 5" />
        <path {...STROKE} d="M8 10.5h5M10.5 8v5" />
      </svg>
    ),
  },
  {
    title: "節目筆記",
    desc: "每一集聽完還能看",
    icon: (
      <svg viewBox="0 0 24 24" {...{ width: 34, height: 34 }}>
        <path {...STROKE} d="M12 5 2.8 9.2 12 13.4l9.2-4.2z" />
        <path {...STROKE} d="M6.5 11.6v4.2c0 1.3 2.5 2.7 5.5 2.7s5.5-1.4 5.5-2.7v-4.2" />
        <path {...STROKE} d="M21.2 9.2v5" />
      </svg>
    ),
  },
];

export default function SupportPillars({ caption }: { caption?: string }) {
  return (
    <div className="sup-pillars">
      <div className="sp-head">
        <span>◆</span>　你 的 支 持 會 變 成　<span>◆</span>
      </div>
      <div className="sp-grid">
        {ITEMS.map((it) => (
          <div className="sp-card" key={it.title}>
            {it.icon}
            <b>{it.title}</b>
            <small>{it.desc}</small>
          </div>
        ))}
      </div>
      {caption && <p className="sp-caption">{caption}</p>}
    </div>
  );
}
