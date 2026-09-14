import { marked, Renderer, type Tokens } from "marked";
import sanitizeHtml from "sanitize-html";
import { renderBlocks } from "./blocks";

export type TocItem = { id: string; text: string };

/* 連結轉換：一律補 rel=noopener；外部網址（http/https 且不是本站）自動開新分頁，
   讀者點出去不會蓋掉正在看的頁面 */
function linkTransform(tagName: string, attribs: Record<string, string>) {
  const href = attribs.href || "";
  const external = /^https?:\/\//i.test(href) && !/(^|\.)wensong\.tw/i.test(href.replace(/^https?:\/\//i, "").split("/")[0]);
  return {
    tagName,
    attribs: { ...attribs, rel: "noopener", ...(external ? { target: "_blank" } : {}) },
  };
}

/* 消毒：只留安全標籤與屬性，杜絕 XSS（腳本、事件屬性、javascript: 連結等） */
export function sanitize(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: [
      "h1", "h2", "h3", "h4", "p", "br", "hr", "blockquote", "ul", "ol", "li",
      "strong", "em", "b", "i", "u", "s", "a", "img", "figure", "figcaption",
      "table", "thead", "tbody", "tr", "th", "td", "code", "pre",
    ],
    allowedAttributes: {
      a: ["href", "title", "target", "rel"],
      img: ["src", "alt", "title", "width", "height", "loading"],
      h2: ["id"],
      "*": [],
    },
    allowedSchemes: ["http", "https", "mailto"],
    transformTags: {
      a: linkTransform,
    },
  });
}

/* 文章內文專用消毒：文章只有站主在後台編輯，允許 div/span 與行內 style
   以支援手工圖表；仍杜絕 script、事件屬性、javascript: 連結（沿用預設防護） */
export function sanitizeArticle(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: [
      "h1", "h2", "h3", "h4", "p", "br", "hr", "blockquote", "ul", "ol", "li",
      "strong", "em", "b", "i", "u", "s", "a", "img", "figure", "figcaption",
      "table", "thead", "tbody", "tr", "th", "td", "code", "pre", "div", "span",
    ],
    allowedAttributes: {
      a: ["href", "title", "target", "rel"],
      img: ["src", "alt", "title", "width", "height", "loading"],
      h2: ["id"],
      /* class 與少量 data-* 供懶人動態區塊（數字跳動、長條圖、問答對錯）掛動畫與互動；仍不含事件屬性 */
      "*": ["style", "class", "data-count", "data-dec", "data-prefix", "data-suffix", "data-reveal", "data-correct", "data-poll", "data-opt", "data-tw", "data-temp", "aria-hidden", "tabindex"],
    },
    allowedSchemes: ["http", "https", "mailto"],
    /* style 只放行版面／顏色類屬性，擋掉會外連或執行的 CSS（position/behavior 等） */
    allowedStyles: {
      "*": {
        "color": [/.*/], "background": [/.*/], "background-color": [/.*/],
        "border": [/.*/], "border-top": [/.*/], "border-bottom": [/.*/], "border-left": [/.*/], "border-right": [/.*/], "border-radius": [/.*/],
        "box-shadow": [/.*/], "text-shadow": [/.*/],
        "margin": [/.*/], "margin-top": [/.*/], "margin-bottom": [/.*/], "margin-left": [/.*/], "margin-right": [/.*/],
        "padding": [/.*/], "padding-top": [/.*/], "padding-bottom": [/.*/], "padding-left": [/.*/], "padding-right": [/.*/],
        "width": [/.*/], "max-width": [/.*/], "min-width": [/.*/], "height": [/.*/], "max-height": [/.*/], "min-height": [/.*/],
        "display": [/.*/], "flex": [/.*/], "flex-direction": [/.*/], "flex-wrap": [/.*/], "align-items": [/.*/], "justify-content": [/.*/], "gap": [/.*/],
        "text-align": [/.*/], "font-size": [/.*/], "font-weight": [/.*/], "font-family": [/.*/], "line-height": [/.*/], "letter-spacing": [/.*/],
        "opacity": [/.*/], "overflow": [/.*/], "white-space": [/.*/], "vertical-align": [/.*/], "float": [/.*/], "clear": [/.*/],
        "grid-template-columns": [/.*/], "position": [/^(relative|absolute|static)$/], "top": [/.*/], "bottom": [/.*/], "left": [/.*/], "right": [/.*/], "z-index": [/.*/],
        /* 懶人區塊動畫用的 CSS 變數（進度、長條、序號…） */
        "--w": [/.*/], "--p": [/.*/], "--pnow": [/.*/], "--i": [/.*/], "--rv-delay": [/.*/], "--x": [/.*/],
      },
    },
    transformTags: {
      a: linkTransform,
    },
  });
}

/* 一般 markdown（隱私權、條款等）→ 消毒後的 HTML */
export function renderMarkdown(md: string): string {
  return sanitize(marked.parse(md, { async: false }) as string);
}

/* ── 中文斷行：讓換行只落在標點處 ──
   本來想用 CSS 的 word-break:keep-all，但各家瀏覽器行為不一致：
   Chromium 仍會在中文標點處換行，WebKit（Safari）卻把整段中文當成一個不可斷的字，
   只剩數字旁的半形空格能斷，於是出現「體重 246 ／ 公克，…」這種難看的斷法。
   所以改在輸出 HTML 時處理：把「到標點為止」的短句各自包成一個 nowrap，
   換行就只會發生在句子與句子之間，和瀏覽器無關。
   太長的句子不包，免得在窄螢幕撐出水平捲軸。
   上限要抓在「最窄的目標螢幕放得下」：360px 手機的內文欄寬約 320px，
   內文一個字約 17.8px（16.5px＋0.08em 字距）→ 17 字＝302px，放得下；
   標題字級 23px、字距 0.1em，一個字約 25.3px，還要扣掉左邊方塊的 26px，
   可用約 294px → 11 字＝278px。所以標題的上限必須比內文小很多。
   引言框字級 18px 又有左右各 26px 內距與外框，可用僅約 264px → 13 字。
   360px 以下由 globals.css 的 media query 整個解除。 */
const SEG_MAX_TEXT = 17;
const SEG_MAX_HEADING = 11;
const SEG_MAX_QUOTE = 13;
const SEG_RE = /[^，。、；：！？…]*[，。、；：！？…]|[^，。、；：！？…]+/g;

function wrapClauses(text: string, max: number): string {
  return text.replace(SEG_RE, (seg) => {
    const len = seg.trim().length;
    return len > 0 && len <= max ? `<span class="nb">${seg}</span>` : seg;
  });
}

/* 引言框裡的段落已經被 paragraph 依內文寬度包過了，這裡把超出引言可用寬度的
   長句還原成可自由換行，避免它把引言框撐破 */
function relaxClauses(html: string, max: number): string {
  return html.replace(/<span class="nb">([^<]*)<\/span>/g, (m, inner: string) =>
    inner.trim().length > max ? inner : m
  );
}

/* 以標籤為界切開，只加工標籤之外的文字，不碰標籤本身與屬性值 */
function breakAtPunctuation(html: string, max: number): string {
  return html
    .split(/(<[^>]*>)/)
    .map((part, i) => (i % 2 === 1 ? part : wrapClauses(part, max)))
    .join("");
}

/* 把 markdown 轉成文章 HTML，h2 依序給 s1、s2… 的 id 供目錄使用 */
export function renderArticle(md: string): { html: string; toc: TocItem[] } {
  const toc: TocItem[] = [];
  const renderer = new Renderer();
  renderer.heading = function ({ tokens, depth }: Tokens.Heading) {
    const text = this.parser.parseInline(tokens);
    /* 目錄要的是純文字，所以在加 nowrap 標記之前先取 */
    const plain = text.replace(/<[^>]+>/g, "");
    const out = breakAtPunctuation(text, SEG_MAX_HEADING);
    if (depth === 2) {
      const id = `s${toc.length + 1}`;
      toc.push({ id, text: plain });
      return `<h2 id="${id}">${out}</h2>\n`;
    }
    return `<h${depth}>${out}</h${depth}>\n`;
  };
  renderer.paragraph = function ({ tokens }: Tokens.Paragraph) {
    return `<p>${breakAtPunctuation(this.parser.parseInline(tokens), SEG_MAX_TEXT)}</p>\n`;
  };
  renderer.blockquote = function ({ tokens }: Tokens.Blockquote) {
    return `<blockquote>${relaxClauses(this.parser.parse(tokens), SEG_MAX_QUOTE)}</blockquote>\n`;
  };
  const html = marked.parse(renderBlocks(md), { renderer, async: false }) as string;
  return { html: sanitizeArticle(html), toc };
}
