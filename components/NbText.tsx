/*
 * 中文照標點斷句（JSX 版）：與文章內文的 .nb 機制同一套原則——
 * 把「到標點為止」的短句包成 nowrap，換行只落在句讀之間。
 * 超過 max 字的長句不包（交給瀏覽器自由折行，避免窄螢幕溢出）。
 */
const SEG_RE = /[^，。、；：！？…]*[，。、；：！？…]|[^，。、；：！？…]+/g;

export default function NbText({ text, max = 15 }: { text: string; max?: number }) {
  const segs = text.match(SEG_RE) || [text];
  return (
    <>
      {segs.map((seg, i) =>
        seg.trim().length > 0 && seg.trim().length <= max ? (
          <span key={i} className="nb">{seg}</span>
        ) : (
          <span key={i}>{seg}</span>
        )
      )}
    </>
  );
}
