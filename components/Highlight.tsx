/* 把文案裡【】包住的字以品牌紅強調（前後台共用，無相依） */
export default function Highlight({ text, bold = false }: { text: string; bold?: boolean }) {
  const parts = text.split(/【|】/);
  return (
    <>
      {parts.map((p, i) =>
        i % 2 === 1 ? (
          bold ? (
            <b key={i} style={{ color: "var(--seal)" }}>{p}</b>
          ) : (
            <em key={i} style={{ fontStyle: "normal", color: "var(--seal)" }}>{p}</em>
          )
        ) : (
          <span key={i}>{p}</span>
        )
      )}
    </>
  );
}
