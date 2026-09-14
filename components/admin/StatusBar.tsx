/*
 * 狀態列：一眼看完「現在是什麼狀態、多少錢、怎麼付的、什麼時候」，再加一句「下一步該做什麼」。
 *
 * 為什麼下一句話這麼重要：站長打開一張訂單，真正要知道的不是欄位，是「我現在要不要動手」。
 * 那句話算不出來就不要寫（例如帳號效期沒記在資料裡），寧可少一行也不要編一個看起來很像真的的句子。
 */
export type StatusTone = "pending" | "ok" | "fail" | "muted";

export default function StatusBar({
  word, tone = "muted", amount, meta, next,
}: {
  word: React.ReactNode;
  tone?: StatusTone;
  amount?: React.ReactNode;
  meta?: React.ReactNode;
  next?: React.ReactNode;
}) {
  return (
    /* 顏色不寫 inline：語意由 data-tone 決定，色值統一在 admin.css 的 token */
    <div className="ad-status" data-tone={tone}>
      <div className="top">
        {/* 色塊與狀態字同色：語意色只有四個，這裡是它們最主要的出場 */}
        <span className="word">
          <span className="dot" />{word}
        </span>
        {amount != null && <span className="ad-amt">{amount}</span>}
      </div>
      {meta && <div className="meta">{meta}</div>}
      {next && (
        <div className="next">
          <b>下一步</b>
          {next}
        </div>
      )}
    </div>
  );
}
