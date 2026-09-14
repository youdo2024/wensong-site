/* 贊助引言的「給觀眾的信」排版：
   後台若用換行分段（空一行＝新段落）就照著排；
   舊資料是單行輸入（換行早被壓成空白）時，把空白視為站長的斷句點——
   句號（。！？…」）結尾的收成一段，逗號結尾的短句聚在同一段內換行，讀起來像詩行。
   variant：1 清爽信紙／2 復古信箋卡片／3 手機精簡（中段收合） */

function parseParagraphs(text: string): string[][] {
  const paras: string[][] = [];
  if (/\n/.test(text)) {
    for (const block of text.split(/\n{2,}/)) {
      const lines = block
        .split(/\n/)
        .map((s) => s.trim())
        .filter(Boolean);
      if (lines.length) paras.push(lines);
    }
    return paras;
  }
  let cur: string[] = [];
  for (const seg of text.split(/\s+/).map((s) => s.trim()).filter(Boolean)) {
    cur.push(seg);
    if (/[。！？…」]$/.test(seg)) {
      paras.push(cur);
      cur = [];
    }
  }
  if (cur.length) paras.push(cur);
  return paras;
}

const CONTACT_MAIL = "hi@wensong.tw";

function Para({ lines, className }: { lines: string[]; className?: string }) {
  return (
    <p className={className}>
      {lines.map((ln, j) => (
        <span key={j}>
          {/* 含「點此來信」的句子渲染成小按鈕，點了開信箱寫信 */}
          {ln.includes("點此來信") ? (
            <a
              href={`mailto:${CONTACT_MAIL}?subject=${encodeURIComponent("大額支持／企業合作")}`}
              className="btn"
              style={{ fontSize: 13.5, padding: "8px 18px", letterSpacing: ".12em" }}
            >
              {ln.replace(/[。，]$/, "")}
            </a>
          ) : (
            ln
          )}
          {j < lines.length - 1 && <br />}
        </span>
      ))}
    </p>
  );
}

export default function LeadLetter({
  text,
  closing,
  variant = 1,
}: {
  text: string;
  closing?: string;
  variant?: 1 | 2 | 3;
}) {
  const paras = parseParagraphs(text);
  if (!paras.length) return null;

  /* 只有一句短文案時（例如預設的一句話）維持置中，不擺出信件的架式 */
  const short = paras.length === 1 && paras[0].length === 1 && paras[0][0].length <= 40;
  if (short) {
    const one = paras[0][0];
    const glue = closing ? (/[。！？…」]$/.test(one) ? closing : `。${closing}`) : "";
    return (
      <div className="lead-letter single">
        <p>{one + glue}</p>
      </div>
    );
  }

  const tail = (
    <>
      {closing && <p className="closing">{closing}</p>}
      {variant === 2 ? (
        <div className="seal-sig" aria-label="問爽的 敬上">
          <b>問爽的</b>
          <span>敬上</span>
        </div>
      ) : (
        <p className="sig">── 維尼與安妮</p>
      )}
    </>
  );

  if (variant === 3) {
    /* 手機精簡：只先亮出開頭與結尾的詩行，中段收在「展開」裡，縮短捲到贊助按鈕的距離 */
    const poemIdx = paras.findIndex((p) => p.length > 1);
    const cut = poemIdx > 0 ? poemIdx : Math.max(1, paras.length - 1);
    const head = paras[0];
    const middle = paras.slice(1, cut);
    const rest = paras.slice(cut);
    return (
      <div className="lead-letter v3">
        <Para lines={head} />
        {middle.length > 0 && (
          <details>
            <summary>展開，讀完整段話</summary>
            {middle.map((lines, i) => (
              <Para key={i} lines={lines} />
            ))}
          </details>
        )}
        {rest.map((lines, i) => (
          <Para key={i} lines={lines} className={lines.length > 1 ? "poem" : undefined} />
        ))}
        {tail}
      </div>
    );
  }

  return (
    <div className={`lead-letter${variant === 2 ? " v2" : ""}`}>
      {paras.map((lines, i) => (
        <Para key={i} lines={lines} className={variant === 2 && lines.length > 1 ? "poem" : undefined} />
      ))}
      {tail}
    </div>
  );
}
