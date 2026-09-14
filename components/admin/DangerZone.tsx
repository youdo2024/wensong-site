/*
 * 危險區：刪除、清空這種做了回不來的動作，一律收在頁面最底、紅框、附一句「會發生什麼事」。
 * 動作本身要用 ConfirmSubmit，這個容器只負責位置與長相，不負責確認。
 */
export default function DangerZone({
  title, warn, children,
}: { title: React.ReactNode; warn?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="danger-zone">
      <div className="dz-t">{title}</div>
      {warn && <div className="dz-w">{warn}</div>}
      {children}
    </div>
  );
}
