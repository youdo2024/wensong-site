/*
 * 空狀態：沒有資料時給一句話，不要留一片空白。
 * 站長回報過「以為壞掉」，一句「還沒有人買」跟空白的差別就是要不要打電話問。
 */
export default function Empty({ children }: { children: React.ReactNode }) {
  return <p className="ad-empty">{children}</p>;
}
