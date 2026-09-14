/*
 * 後台圖示：一律是線條 SVG，不用 emoji（站長 2026-09-05）。
 *
 * 為什麼不用 emoji：每支手機、每個系統畫出來的長相都不一樣，顏色也吃不到品牌色，
 * 放在 2px 茶墨框旁邊會像貼紙。線條 SVG 用 currentColor 描邊，選到的那一列自動跟著反白。
 * 大小預設 20，側欄用 16，箭頭用 14 到 16。
 */
export type IcoName =
  | "home" | "orders" | "bell" | "heart" | "box" | "card" | "pin" | "file"
  | "user" | "phone" | "mail" | "chat" | "gear" | "menu" | "close"
  | "right" | "left" | "trash" | "lines" | "search" | "alert" | "check";

const P: Record<IcoName, React.ReactNode> = {
  home: <><path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V21h14V9.5" /></>,
  orders: <><rect x="4" y="3" width="16" height="18" /><path d="M8 8h8M8 12h8M8 16h5" /></>,
  bell: <><path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4z" /><path d="M10 21h4" /></>,
  heart: <path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 10c0 5.6-7 10-7 10z" />,
  box: <><path d="M3 7l9-4 9 4v10l-9 4-9-4z" /><path d="M3 7l9 4 9-4M12 11v10" /></>,
  card: <><rect x="3" y="5" width="18" height="14" /><path d="M3 10h18" /></>,
  pin: <><path d="M12 21s-6-5.4-6-11a6 6 0 0 1 12 0c0 5.6-6 11-6 11z" /><circle cx="12" cy="10" r="2" /></>,
  file: <><path d="M6 3h8l4 4v14H6z" /><path d="M14 3v4h4M9 12h6M9 16h6" /></>,
  user: <><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>,
  phone: <path d="M6 3h4l2 5-3 2a10 10 0 0 0 5 5l2-3 5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 4 5a2 2 0 0 1 2-2z" />,
  mail: <><rect x="3" y="5" width="18" height="14" /><path d="M3 6l9 7 9-7" /></>,
  chat: <path d="M4 12a8 7 0 1 1 16 0c0 4-4 7-8 7l-4 2v-3a7 7 0 0 1-4-6z" />,
  gear: <><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1" /></>,
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  right: <path d="M9 6l6 6-6 6" />,
  left: <path d="M15 6l-6 6 6 6" />,
  trash: <path d="M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14" />,
  lines: <path d="M4 6h16M4 12h16M4 18h16" />,
  search: <><circle cx="11" cy="11" r="6" /><path d="M20 20l-4.3-4.3" /></>,
  alert: <><path d="M12 4l9 16H3z" /><path d="M12 10v4M12 17v.5" /></>,
  check: <path d="M5 12l4 4L19 7" />,
};

export default function Ico({ n, size = 20 }: { n: IcoName; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className="ico"
    >
      {P[n]}
    </svg>
  );
}
