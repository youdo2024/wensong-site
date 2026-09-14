/*
 * 卡片：後台唯一的「一塊內容」容器。2px 茶墨框、米袋淺底、直角，硬陰影只給要被看見的那一張。
 * 有 title 就自動長出區塊標題（一行字加一條細線），不必再手寫 h3 與間距。
 */
export default function Card({
  title, pad = true, lift = false, children, id,
}: {
  title?: React.ReactNode;
  /* 內距。表格、清單這種自己有內距的內容傳 false */
  pad?: boolean;
  /* 硬陰影。一屏最多一兩張，全部都浮起來等於都沒浮起來 */
  lift?: boolean;
  children: React.ReactNode;
  id?: string;
}) {
  return (
    <div id={id}>
      {title && (
        <div className="ad-sect">
          <h2>{title}</h2>
          <div className="rule" />
        </div>
      )}
      <div className={`ad-card${pad ? " pad" : ""}${lift ? " lift" : ""}`}>{children}</div>
    </div>
  );
}
