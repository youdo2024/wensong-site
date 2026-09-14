/* 懶人動態區塊：把文章裡的 ::: 簡碼轉成帶動畫的資訊圖表 HTML
   站長只要打幾行純文字，網站就渲染成會動的圖表（捲動時淡入、數字跳動、長條圖長出來）。
   產出的 HTML 走 sanitizeArticle 消毒（允許 class／style／data-count 等），仍杜絕 script。
   支援型別：數字 stat｜長條圖 bar｜時間軸 timeline｜對比 vs｜金句 quote｜重點 cards｜進度 donut */

const SEP = /\s*[｜|]\s*/; // 全形或半形分隔線

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/* 從一段文字抽出「前綴＋數字＋後綴」，供數字跳動用；沒有數字則回傳 num=null */
function parseNum(s: string): { prefix: string; num: number | null; suffix: string; raw: string; dec: number } {
  /* 小數也要抓進來（例如 8.1、1.68 億），否則跳動過程會出現「0.1」這種怪畫面 */
  const m = s.match(/^(\D*?)(\d[\d,]*(?:\.\d+)?)(.*)$/);
  if (!m) return { prefix: "", num: null, suffix: "", raw: s, dec: 0 };
  const body = m[2].replace(/,/g, "");
  const dot = body.indexOf(".");
  return { prefix: m[1], num: Number(body), suffix: m[3], raw: s, dec: dot < 0 ? 0 : body.length - dot - 1 };
}

/* 型別名稱正規化（中英皆可） */
function normType(t: string): string {
  const map: Record<string, string> = {
    "數字": "stat", "stat": "stat", "重點數字": "stat",
    "長條圖": "bar", "bar": "bar", "長條": "bar", "比例": "bar",
    "時間軸": "timeline", "timeline": "timeline", "時間": "timeline", "歷程": "timeline",
    "對比": "vs", "vs": "vs", "比較": "vs",
    "金句": "quote", "quote": "quote", "引言": "quote",
    "重點": "cards", "cards": "cards", "卡片": "cards", "清單": "cards",
    "進度": "donut", "donut": "donut", "圓餅": "donut", "百分比": "donut", "圈": "donut",
    "翻卡": "flip", "flip": "flip", "字卡": "flip", "翻牌": "flip",
    "問答": "quiz", "quiz": "quiz", "測驗": "quiz", "選擇題": "quiz", "小考": "quiz",
    "展開": "fold", "fold": "fold", "摺疊": "fold", "折疊": "fold", "收合": "fold",
    "滑桿": "slider", "slider": "slider", "對比圖": "slider", "比對": "slider", "今昔": "slider",
    "刮刮": "scratch", "scratch": "scratch", "刮刮樂": "scratch", "刮開": "scratch",
    "投票": "poll", "poll": "poll", "票選": "poll", "民調": "poll",
  };
  return map[t.trim()] || "";
}

function statCard(v: string, i: number): string {
  const [numPart, label = ""] = v.split(SEP);
  const p = parseNum(numPart.trim());
  const numHtml =
    p.num !== null
      ? `<span class="yb-num" data-count="${p.num}" data-dec="${p.dec}" data-prefix="${esc(p.prefix)}" data-suffix="${esc(p.suffix)}">${esc(p.raw)}</span>`
      : `<span class="yb-num">${esc(numPart.trim())}</span>`;
  return `<div class="yb-stat-card" style="--i:${i}">${numHtml}<span class="yb-stat-label">${esc(label.trim())}</span></div>`;
}

function renderStat(title: string, lines: string[]): string {
  const cards = lines.map(statCard).join("");
  const head = title ? `<div class="yb-b-title">${esc(title)}</div>` : "";
  return `<div class="yb-block yb-stat">${head}<div class="yb-stat-row">${cards}</div></div>`;
}

function renderBar(title: string, lines: string[]): string {
  const rows = lines.map((l) => {
    const m = l.match(/^(.*?)[\s｜|]+(\d[\d.]*)\s*(\S*)$/);
    const label = m ? m[1].trim() : l.trim();
    const val = m ? Number(m[2]) : 0;
    const unit = m && m[3] ? m[3] : "";
    return { label, val, unit };
  });
  const max = Math.max(1, ...rows.map((r) => r.val));
  /* 數值都 ≤100 時當百分比直接畫（85→85%）；有超過 100 的就依最大值等比例縮放 */
  const scale = max <= 100 ? 100 : max;
  const bars = rows
    .map((r, i) => {
      const pct = Math.round((r.val / scale) * 100);
      return `<div class="yb-bar-row" style="--i:${i}"><span class="yb-bar-label">${esc(r.label)}</span><span class="yb-bar-track"><span class="yb-bar-fill" style="--w:${pct}%"></span></span><span class="yb-bar-val" data-count="${r.val}" data-suffix="${esc(r.unit)}">${r.val}${esc(r.unit)}</span></div>`;
    })
    .join("");
  const head = title ? `<div class="yb-b-title">${esc(title)}</div>` : "";
  return `<div class="yb-block yb-bar">${head}${bars}</div>`;
}

function renderTimeline(title: string, lines: string[]): string {
  const items = lines
    .map((l, i) => {
      const [when, ...rest] = l.split(SEP);
      const text = rest.join("｜");
      return `<div class="yb-tl-item" style="--i:${i}"><span class="yb-tl-dot"></span><div class="yb-tl-body"><b class="yb-tl-when">${esc(when.trim())}</b>${text ? `<span class="yb-tl-text">${esc(text.trim())}</span>` : ""}</div></div>`;
    })
    .join("");
  const head = title ? `<div class="yb-b-title">${esc(title)}</div>` : "";
  return `<div class="yb-block yb-timeline">${head}<div class="yb-tl-line">${items}</div></div>`;
}

function renderVs(title: string, lines: string[]): string {
  const cards = lines
    .map((l, i) => {
      const [head, ...rest] = l.split(SEP);
      const body = rest.join("｜");
      return `<div class="yb-vs-card yb-vs-${i % 2 === 0 ? "a" : "b"}" style="--i:${i}"><b class="yb-vs-head">${esc(head.trim())}</b>${body ? `<span class="yb-vs-body">${esc(body.trim())}</span>` : ""}</div>`;
    })
    .join("");
  const head = title ? `<div class="yb-b-title">${esc(title)}</div>` : "";
  /* 剛好兩張卡時，中間蓋一顆「VS」印章 */
  const badge = lines.length === 2 ? `<span class="yb-vs-badge" aria-hidden="true">VS</span>` : "";
  return `<div class="yb-block yb-vs">${head}<div class="yb-vs-row">${badge}${cards}</div></div>`;
}

function renderQuote(_title: string, lines: string[]): string {
  const text = lines.join(" ").trim();
  return `<div class="yb-block yb-quote"><span class="yb-quote-mark">”</span><p class="yb-quote-text">${esc(text)}</p></div>`;
}

function renderCards(title: string, lines: string[]): string {
  const cards = lines
    .map((l, i) => {
      const parts = l.split(SEP).map((s) => s.trim());
      /* 最後一欄若是網址，整張卡變成可點的連結（開新分頁），例如店家資訊連到 Google Map */
      let url = "";
      if (parts.length > 1 && /^https?:\/\//.test(parts[parts.length - 1])) url = parts.pop() as string;
      let icon = "", head = "", body = "";
      if (parts.length >= 3) [icon, head, body] = parts;
      else if (parts.length === 2) [head, body] = parts;
      else [head] = parts;
      const inner = `${icon ? `<span class="yb-card-icon">${esc(icon)}</span>` : ""}<div class="yb-card-body"><b class="yb-card-head">${esc(head)}</b>${body ? `<span class="yb-card-text">${esc(body)}</span>` : ""}</div>`;
      return url
        ? `<a class="yb-card yb-card-link" style="--i:${i}" href="${esc(url)}" target="_blank" rel="noopener">${inner}</a>`
        : `<div class="yb-card" style="--i:${i}">${inner}</div>`;
    })
    .join("");
  const head = title ? `<div class="yb-b-title">${esc(title)}</div>` : "";
  return `<div class="yb-block yb-cards">${head}<div class="yb-cards-grid">${cards}</div></div>`;
}

function renderDonut(title: string, lines: string[]): string {
  const src = (title || lines[0] || "").trim();
  const [numPart, label = ""] = src.split(SEP);
  const p = parseNum(numPart.trim());
  const pct = Math.max(0, Math.min(100, p.num ?? 0));
  const extraLabel = title ? lines.join(" ") : label; // 標題行放百分比時，內文行當補充說明
  return `<div class="yb-block yb-donut"><div class="yb-ring" style="--p:${pct}"><div class="yb-ring-hole"><span class="yb-num" data-count="${pct}" data-suffix="%">${pct}%</span></div></div>${extraLabel ? `<div class="yb-donut-label">${esc(extraLabel.trim())}</div>` : ""}</div>`;
}

/* 翻卡：每行「正面｜背面」，點卡片 3D 翻面看答案 */
function renderFlip(title: string, lines: string[]): string {
  const cards = lines
    .map((l, i) => {
      const [front, ...rest] = l.split(SEP);
      const back = rest.join("｜") || front;
      return `<div class="yb-flip" style="--i:${i}"><div class="yb-flip-inner"><div class="yb-flip-face yb-flip-front"><span>${esc(front.trim())}</span></div><div class="yb-flip-face yb-flip-back"><span>${esc(back.trim())}</span></div></div></div>`;
    })
    .join("");
  const head = title ? `<div class="yb-b-title">${esc(title)}</div>` : "";
  return `<div class="yb-block yb-flipwrap">${head}<div class="yb-flip-grid">${cards}</div><div class="yb-hint">點 卡 片 翻 面</div></div>`;
}

/* 問答：標題行＝題目；每行一個選項，句尾加「＊」（或 *）＝正解；
   「解說：」開頭的行＝作答後顯示的說明 */
function renderQuiz(title: string, lines: string[]): string {
  let exp = "";
  const opts: { text: string; correct: boolean }[] = [];
  for (const l of lines) {
    const em = l.match(/^解說[:：｜|]\s*(.*)$/);
    if (em) { exp = em[1]; continue; }
    const correct = /[＊*]\s*$/.test(l);
    opts.push({ text: l.replace(/[＊*]\s*$/, "").replace(/^[-•]\s*/, "").trim(), correct });
  }
  const optHtml = opts
    .map((o, i) => `<div class="yb-quiz-opt" data-correct="${o.correct ? 1 : 0}" style="--i:${i}"><span class="yb-quiz-mark"></span><span class="yb-quiz-txt">${esc(o.text)}</span></div>`)
    .join("");
  return `<div class="yb-block yb-quiz"><div class="yb-quiz-q">${esc(title || "小測驗")}</div><div class="yb-quiz-opts">${optHtml}</div>${exp ? `<div class="yb-quiz-exp">${esc(exp)}</div>` : ""}<div class="yb-hint">點 一 個 答 案</div></div>`;
}

/* 展開：標題行＝按鈕文字，內文行點開才出現（延伸閱讀、資料來源用） */
function renderFold(title: string, lines: string[]): string {
  const body = lines.map((l) => `<p>${esc(l)}</p>`).join("");
  return `<div class="yb-block yb-fold"><div class="yb-fold-btn"><span class="yb-fold-label">${esc(title || "展開看更多")}</span><span class="yb-fold-arrow" aria-hidden="true">▾</span></div><div class="yb-fold-body"><div class="yb-fold-innr">${body}</div></div></div>`;
}

/* 滑桿：兩行「圖片網址｜標籤」，左右拖曳比較兩張圖（今昔對比） */
function renderSlider(title: string, lines: string[]): string {
  const parse = (l: string) => { const [u, ...r] = l.split(SEP); return { u: u.trim(), label: r.join("｜").trim() }; };
  const a = parse(lines[0] || "");
  const b = parse(lines[1] || "");
  if (!a.u || !b.u) return "";
  const head = title ? `<div class="yb-b-title">${esc(title)}</div>` : "";
  return `<div class="yb-block yb-sliderwrap">${head}<div class="yb-slide-stage"><img class="yb-slide-img yb-slide-under" src="${esc(b.u)}" alt="${esc(b.label)}" loading="lazy"><div class="yb-slide-overwrap"><img class="yb-slide-img" src="${esc(a.u)}" alt="${esc(a.label)}" loading="lazy"></div><div class="yb-slide-handle" aria-hidden="true"><span>◀ ▶</span></div>${a.label ? `<span class="yb-slide-tag yb-slide-tag-a">${esc(a.label)}</span>` : ""}${b.label ? `<span class="yb-slide-tag yb-slide-tag-b">${esc(b.label)}</span>` : ""}</div><div class="yb-hint">左 右 拖 曳 比 較</div></div>`;
}

/* 刮刮樂：內文藏在牛皮紙刮層底下，刮開才看得到（刮層 canvas 由前端動態蓋上） */
function renderScratch(title: string, lines: string[]): string {
  const head = title ? `<div class="yb-b-title">${esc(title)}</div>` : "";
  const body = lines.map((l) => `<p>${esc(l)}</p>`).join("");
  return `<div class="yb-block yb-scratch">${head}<div class="yb-scratch-area"><div class="yb-scratch-content">${body}</div></div><div class="yb-hint">按 住 刮 開</div></div>`;
}

/* 投票：標題＝題目、每行一個選項；投完即時顯示所有讀者的百分比（資料存站上） */
function renderPoll(title: string, lines: string[]): string {
  const opts = lines
    .map((l, i) => `<div class="yb-poll-opt" data-opt="${i}" style="--i:${i}"><span class="yb-poll-label">${esc(l.replace(/^[-•]\s*/, "").trim())}</span><span class="yb-poll-bar"><span class="yb-poll-fill"></span></span><span class="yb-poll-pct"></span></div>`)
    .join("");
  return `<div class="yb-block yb-poll" data-poll="${esc((title || lines.join("/")).slice(0, 120))}"><div class="yb-quiz-q">${esc(title || "投個票")}</div><div class="yb-poll-opts">${opts}</div><div class="yb-hint">投 一 票，看 大 家 怎 麼 選</div></div>`;
}

/* 詞彙註解：內文的 [[詞｜說明]] 變成可滑過／點按的浮出小卡 */
function renderTerms(line: string): string {
  return line.replace(/\[\[([^\]｜|]{1,30})[｜|]([^\]]{1,200})\]\]/g, (_m, w, tip) =>
    `<span class="yb-term" tabindex="0">${esc(String(w).trim())}<span class="yb-term-pop">${esc(String(tip).trim())}</span></span>`
  );
}

function renderOne(type: string, title: string, lines: string[]): string {
  switch (type) {
    case "stat": return renderStat(title, lines);
    case "bar": return renderBar(title, lines);
    case "timeline": return renderTimeline(title, lines);
    case "vs": return renderVs(title, lines);
    case "quote": return renderQuote(title, lines);
    case "cards": return renderCards(title, lines);
    case "donut": return renderDonut(title, lines);
    case "flip": return renderFlip(title, lines);
    case "quiz": return renderQuiz(title, lines);
    case "fold": return renderFold(title, lines);
    case "slider": return renderSlider(title, lines);
    case "scratch": return renderScratch(title, lines);
    case "poll": return renderPoll(title, lines);
    default: return "";
  }
}

/* 主函式：掃描 Markdown，把 ::: 區塊換成 HTML；其餘原樣保留。
   區塊 = 一行「:::型別 標題」＋接續的非空白行，遇空白行或下一個 ::: 或檔尾結束。 */
export function renderBlocks(md: string): string {
  const lines = md.split(/\r?\n/);
  const out: string[] = [];
  let i = 0;
  let inFence = false; // ``` 程式碼柵欄內不做任何轉換（::: 與 [[詞｜說明]] 都原樣保留）
  while (i < lines.length) {
    const line = lines[i];
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      out.push(line);
      i++;
      continue;
    }
    if (inFence) {
      out.push(line);
      i++;
      continue;
    }
    const m = line.match(/^:::\s*(\S+)\s*(.*)$/);
    const type = m ? normType(m[1]) : "";
    if (m && type) {
      const title = (m[2] || "").trim();
      const body: string[] = [];
      i++;
      while (i < lines.length && lines[i].trim() !== "" && !lines[i].startsWith(":::")) {
        body.push(lines[i].trim());
        i++;
      }
      /* 吞掉區塊的關閉圍欄（單獨一行的 :::），不讓它以文字漏到頁面上 */
      if (i < lines.length && lines[i].trim() === ":::") i++;
      const html = renderOne(type, title, body.filter(Boolean));
      // 前後補空行，讓 marked 視為 HTML 區塊原樣輸出
      out.push("", html, "");
      continue;
    }
    /* 游離的關閉圍欄（前面隔了空行）也一併吞掉 */
    if (line.trim() === ":::") {
      i++;
      continue;
    }
    out.push(renderTerms(line));
    i++;
  }
  return out.join("\n");
}
