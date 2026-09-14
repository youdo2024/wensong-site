/* 每次換頁重新掛載，觸發 .page-fade 的 0.22 秒淡入（globals.css） */
export default function Template({ children }: { children: React.ReactNode }) {
  return <div className="page-fade">{children}</div>;
}
