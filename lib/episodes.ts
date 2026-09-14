import db, { getSetting, setSetting } from "./db";
import { BRAND } from "./brand";

/*
 * 集數：從 SoundOn RSS 同步進 episodes 表。
 *
 * 分群規則（決策定案 2026-09-14）：
 *   RSS 唯讀群每次同步覆蓋：title、pub_date、duration、audio_*、image、rss_description、rss_link
 *   手動群只在第一次匯入時給預設值：key、series、ep_no、short_title、summary、notes、
 *   transcript、chapters、tags、seo_title、slug_alias、published、sort
 * 站長在後台改過的筆記不會被下一次同步洗掉，這是這支最重要的一條契約。
 *
 * 不用 XML 套件：SoundOn 的 RSS 結構固定，逐 <item> 用正則取欄位就夠，
 * 而且純函式部分（parseRss、parseTitle、cleanDescription）冒煙測試載得動。
 */

export type RssItem = {
  guid: string;
  title: string;
  link: string;
  pubDate: string;      /* ISO */
  duration: number;     /* 秒 */
  audioUrl: string;
  audioType: string;
  audioBytes: number;
  image: string;
  description: string;  /* 原始 HTML（content:encoded 優先） */
};

export type Series = "main" | "submit" | "pilot" | "other";

/* ── 純函式：解析 ── */

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, "&");
}

/* 取 <tag>…</tag> 的文字；CDATA 原樣取出，非 CDATA 解實體。找不到回空字串 */
function tagText(block: string, tag: string): string {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "i");
  const m = block.match(re);
  if (!m) return "";
  const raw = m[1].trim();
  const cdata = raw.match(/^<!\[CDATA\[([\s\S]*?)\]\]>$/);
  return cdata ? cdata[1].trim() : decodeEntities(raw);
}

function attr(block: string, tag: string, name: string): string {
  const re = new RegExp(`<${tag}\\b([^>]*)\\/?>`, "i");
  const m = block.match(re);
  if (!m) return "";
  const a = m[1].match(new RegExp(`${name}\\s*=\\s*"([^"]*)"`, "i")) || m[1].match(new RegExp(`${name}\\s*=\\s*'([^']*)'`, "i"));
  return a ? decodeEntities(a[1]) : "";
}

/* itunes:duration 可能是秒數或 HH:MM:SS／MM:SS */
export function parseDuration(s: string): number {
  const t = (s || "").trim();
  if (!t) return 0;
  if (/^\d+$/.test(t)) return Number(t);
  const parts = t.split(":").map((x) => Number(x));
  if (parts.some((x) => Number.isNaN(x))) return 0;
  return parts.reduce((acc, x) => acc * 60 + x, 0);
}

export function parseRss(xml: string): { channel: { title: string; description: string; image: string; link: string }; items: RssItem[] } {
  const chanBlock = xml.split(/<item\b/i)[0];
  const channel = {
    title: tagText(chanBlock, "title"),
    description: tagText(chanBlock, "description"),
    image: attr(chanBlock, "itunes:image", "href"),
    link: tagText(chanBlock, "link"),
  };
  const items: RssItem[] = [];
  const re = /<item\b[^>]*>([\s\S]*?)<\/item>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const b = m[1];
    const pub = tagText(b, "pubDate");
    const d = pub ? new Date(pub) : null;
    const encoded = tagText(b, "content:encoded");
    items.push({
      guid: tagText(b, "guid") || attr(b, "enclosure", "url"),
      title: tagText(b, "title"),
      link: tagText(b, "link"),
      pubDate: d && !Number.isNaN(d.getTime()) ? d.toISOString() : "",
      duration: parseDuration(tagText(b, "itunes:duration")),
      audioUrl: attr(b, "enclosure", "url"),
      audioType: attr(b, "enclosure", "type"),
      audioBytes: Number(attr(b, "enclosure", "length")) || 0,
      image: attr(b, "itunes:image", "href"),
      description: encoded || tagText(b, "description"),
    });
  }
  return { channel, items };
}

/*
 * 標題 → 系列、集數、網址 key、精簡標題。
 *   「問爽的23 - 坪林女王…feat.坪感覺 嫻嫻《問爽的 WenSong》」→ main / 23 / "23" / "坪林女王…feat.坪感覺 嫻嫻"
 *   「投稿03 - 餐廳裡面…《問爽的 WenSong》」→ submit / 03 / "submit-03"
 *   「EP0｜問爽的 試播集」→ pilot / 0 / "0"
 * 認不得的標題 key 用 guid 的前 8 碼雜湊，永遠不會撞。
 */
export function parseTitle(title: string, guid: string): { series: Series; epNo: string; key: string; shortTitle: string } {
  /* 節目後綴與「feat. 來賓」都剝掉：來賓另外掛在 episode_guests，H1 不用再寫一次 */
  const t = title.replace(BRAND.titleSuffix, "").replace(/《問爽的[^》]*》/g, "").replace(/\s*(?:feat\.?|ft\.?)\s*[^《]*$/i, "").trim();
  let m = t.match(/^問爽的\s*(\d+)\s*[-–—｜|:：]?\s*(.*)$/);
  if (m) return { series: "main", epNo: m[1], key: String(Number(m[1])), shortTitle: m[2].trim() || t };
  m = t.match(/^投稿\s*(\d+)\s*[-–—｜|:：]?\s*(.*)$/);
  if (m) return { series: "submit", epNo: m[1], key: `submit-${m[1].padStart(2, "0")}`, shortTitle: m[2].trim() || t };
  m = t.match(/^EP\s*0+\s*[-–—｜|:：]?\s*(.*)$/i);
  if (m || /試播/.test(t)) return { series: "pilot", epNo: "0", key: "0", shortTitle: (m ? m[1] : t).replace(/^問爽的\s*/, "").trim() || t };
  let h = 0;
  for (const ch of guid) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return { series: "other", epNo: "", key: `x-${h.toString(36).slice(0, 8)}`, shortTitle: t };
}

/* 標題裡的來賓：feat./ft. 之後、《 之前。「好嶼：Ian、MIki」這種整串當一位，站長再拆 */
export function guestNamesFromTitle(title: string): string[] {
  const m = title.match(/(?:feat\.?|ft\.?)\s*([^《]+)/i);
  if (!m) return [];
  return m[1].split(/\s*[&＆]\s*|\s+和\s+|\s+與\s+/).map((s) => s.trim()).filter(Boolean);
}

/* 簡介裡固定尾巴的起點：從最早出現的那一個切掉 */
const TAIL_MARKERS = [
  "🎧", "🔴", "🫶", "____", "✨ 追蹤", "✨追蹤", "Hosting provided by", "#問爽的",
  "如果你們有任何想了解", "還有更多有趣的內容", "感謝大家的支持", "馬上收聽", "小額贊助",
];

/* HTML 簡介 → Markdown 純文字：去標籤、換行保留、剝掉尾巴、「・」項目改成清單 */
export function cleanDescription(html: string): string {
  let s = html || "";
  s = s.replace(/<br\s*\/?>/gi, "\n").replace(/<\/p>/gi, "\n\n").replace(/<\/li>/gi, "\n");
  s = s.replace(/<a\b[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_, href, text) => {
    const t = String(text).replace(/<[^>]+>/g, "").trim();
    return t && t !== href ? `[${t}](${href})` : href;
  });
  s = s.replace(/<[^>]+>/g, "");
  s = decodeEntities(s).replace(/ /g, " ");
  let cut = s.length;
  for (const mk of TAIL_MARKERS) {
    const i = s.indexOf(mk);
    if (i >= 0 && i < cut) cut = i;
  }
  s = s.slice(0, cut);
  s = s
    .split("\n")
    .map((ln) => ln.replace(/\s+$/g, "").replace(/^\s*[・•●]\s*/, "- "))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return s;
}

/* 卡片摘要：清乾淨的簡介取第一段，去掉清單符號，截到 110 字 */
export function summaryFrom(clean: string, max = 110): string {
  const flat = clean.replace(/^- /gm, "").replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  const head = flat.slice(0, max);
  const cutAt = Math.max(head.lastIndexOf("。"), head.lastIndexOf("！"), head.lastIndexOf("？"));
  return cutAt >= max * 0.5 ? head.slice(0, cutAt + 1) : `${head.slice(0, max - 1)}…`;
}

/* 秒 → 「45 分」；超過一小時「1 小時 5 分」 */
export function fmtDuration(sec: number): string {
  const m = Math.round(sec / 60);
  if (m < 60) return `${m} 分鐘`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h} 小時 ${r} 分` : `${h} 小時`;
}

/* 集數顯示名：main 23 → 「第 23 集」；submit → 「投稿 03」；pilot → 「試播集」 */
/*
 * 章節時間字串的解析與格式化（後台編輯集數的「章節」欄位用，app/admin/actions.ts
 * 的 parseChapters 與編輯頁的 chaptersText 都要用同一套格式基準）。
 *
 * 輸出固定「分:秒」，分鐘數可以超過 99（節目本身有超過 1 小時的集數，
 * 100 分鐘後的章節分鐘數會是 3 位數）。舊正則的第一段只吃 1~2 位數，
 * 100 分鐘那一行整行解析失敗會被靜默跳過，只要編輯頁重新儲存
 * （哪怕沒動章節欄位），那個章節就從資料庫消失了。
 */
export function parseChapterLine(raw: string): { t: number; label: string } | null {
  const m = raw.trim().match(/^(\d{1,3}(?::\d{1,2}){1,2})\s+(.+)$/);
  if (!m) return null;
  const t = m[1].split(":").map(Number).reduce((a, x) => a * 60 + x, 0);
  return { t, label: m[2].trim() };
}

export function fmtChapterTime(t: number): string {
  const m = Math.floor(t / 60);
  const s = t % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function epLabel(series: string, epNo: string): string {
  if (series === "main") return `第 ${Number(epNo)} 集`;
  if (series === "submit") return `投稿 ${epNo}`;
  if (series === "pilot") return "試播集";
  return "特別篇";
}

/* ── 資料庫：同步 ── */

export type SyncResult = { ok: boolean; added: number; updated: number; total: number; guestsAdded: number; msg?: string };

function slugForGuest(): string {
  const row = db.prepare("SELECT COALESCE(MAX(id),0) AS n FROM guests").get() as { n: number };
  return `guest-${row.n + 1}`;
}

/* 來賓自動建檔：只在這一集第一次匯入時做，名字完全相同就掛既有那位 */
function attachGuests(episodeId: number, names: string[], now: string): number {
  let added = 0;
  for (const name of names) {
    let g = db.prepare("SELECT id FROM guests WHERE name=?").get(name) as { id: number } | undefined;
    if (!g) {
      const r = db.prepare("INSERT INTO guests (slug,name,created_at) VALUES (?,?,?)").run(slugForGuest(), name, now);
      g = { id: Number(r.lastInsertRowid) };
      added++;
    }
    db.prepare("INSERT OR IGNORE INTO episode_guests (episode_id,guest_id) VALUES (?,?)").run(episodeId, g.id);
  }
  return added;
}

export function upsertEpisodes(items: RssItem[]): Omit<SyncResult, "ok"> {
  const now = new Date().toISOString();
  let added = 0, updated = 0, guestsAdded = 0;
  const find = db.prepare("SELECT id FROM episodes WHERE guid=?");
  const upd = db.prepare(
    `UPDATE episodes SET title=@title,pub_date=@pub_date,duration=@duration,audio_url=@audio_url,audio_type=@audio_type,
       audio_bytes=@audio_bytes,image=@image,rss_description=@rss_description,rss_link=@rss_link,synced_at=@now WHERE guid=@guid`
  );
  const ins = db.prepare(
    `INSERT INTO episodes (guid,key,series,ep_no,title,short_title,pub_date,duration,audio_url,audio_type,audio_bytes,image,
       rss_description,rss_link,summary,notes,published,created_at,synced_at)
     VALUES (@guid,@key,@series,@ep_no,@title,@short_title,@pub_date,@duration,@audio_url,@audio_type,@audio_bytes,@image,
       @rss_description,@rss_link,@summary,@notes,1,@now,@now)`
  );
  const tx = db.transaction(() => {
    for (const it of items) {
      if (!it.guid) continue;
      const base = {
        guid: it.guid, title: it.title, pub_date: it.pubDate, duration: it.duration, audio_url: it.audioUrl,
        audio_type: it.audioType, audio_bytes: it.audioBytes, image: it.image, rss_description: it.description, rss_link: it.link, now,
      };
      const exists = find.get(it.guid) as { id: number } | undefined;
      if (exists) {
        upd.run(base);
        updated++;
        continue;
      }
      const p = parseTitle(it.title, it.guid);
      /* key 撞到（同一集重新上傳換了 guid）就補後綴，不讓整批同步失敗 */
      let key = p.key;
      let n = 2;
      while (db.prepare("SELECT 1 FROM episodes WHERE key=?").get(key)) key = `${p.key}-${n++}`;
      const clean = cleanDescription(it.description);
      const r = ins.run({ ...base, key, series: p.series, ep_no: p.epNo, short_title: p.shortTitle, summary: summaryFrom(clean), notes: clean });
      added++;
      guestsAdded += attachGuests(Number(r.lastInsertRowid), guestNamesFromTitle(it.title), now);
    }
  });
  tx();
  const total = (db.prepare("SELECT COUNT(*) AS n FROM episodes").get() as { n: number }).n;
  return { added, updated, total, guestsAdded };
}

export async function syncEpisodes(): Promise<SyncResult> {
  const url = getSetting("podcast_rss_url", BRAND.rssUrl);
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(20_000), headers: { "User-Agent": "wensong-site/1.0" } });
    if (!res.ok) return { ok: false, added: 0, updated: 0, total: 0, guestsAdded: 0, msg: `RSS 回 ${res.status}` };
    const xml = await res.text();
    const { channel, items } = parseRss(xml);
    if (items.length === 0) return { ok: false, added: 0, updated: 0, total: 0, guestsAdded: 0, msg: "RSS 裡沒有任何集數，沒有動資料庫" };
    const r = upsertEpisodes(items);
    if (channel.image) setSetting("podcast_cover", channel.image);
    setSetting("episodes_synced_at", new Date().toISOString());
    setSetting("episodes_sync_last", JSON.stringify({ ...r, at: new Date().toISOString() }));
    return { ok: true, ...r };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    setSetting("episodes_sync_last", JSON.stringify({ ok: false, msg, at: new Date().toISOString() }));
    return { ok: false, added: 0, updated: 0, total: 0, guestsAdded: 0, msg };
  }
}

/* 每小時醒一次；距上次成功同步超過 23 小時才真的去抓。表是空的（第一次部署）立刻抓 */
export function startEpisodeSyncLoop(): void {
  const g = globalThis as unknown as { __wsEpisodeLoop?: ReturnType<typeof setInterval> };
  if (g.__wsEpisodeLoop) return;
  const tick = async () => {
    try {
      const empty = (db.prepare("SELECT COUNT(*) AS n FROM episodes").get() as { n: number }).n === 0;
      const last = Date.parse(getSetting("episodes_synced_at", "")) || 0;
      if (empty || Date.now() - last > 23 * 3600_000) {
        const r = await syncEpisodes();
        console.log(`[episodes] 同步 ${r.ok ? "完成" : "失敗"}：新增 ${r.added}、更新 ${r.updated}、共 ${r.total}${r.msg ? `（${r.msg}）` : ""}`);
      }
    } catch (e) {
      console.error("[episodes] 同步例外", e);
    }
  };
  setTimeout(tick, 15_000);
  g.__wsEpisodeLoop = setInterval(tick, 60 * 60_000);
}

/* ── 查詢 helpers ── */

export type EpisodeRow = {
  id: number; guid: string; key: string; series: Series; ep_no: string; title: string; short_title: string;
  pub_date: string; duration: number; audio_url: string; audio_type: string; audio_bytes: number; image: string; cover: string;
  rss_description: string; rss_link: string; summary: string; notes: string; transcript: string; chapters: string; tags: string;
  seo_title: string; slug_alias: string; published: number; sort: number; views: number; created_at: string; updated_at: string; synced_at: string;
};

export function displayTitle(e: Pick<EpisodeRow, "title" | "short_title">): string {
  return e.short_title || e.title.replace(BRAND.titleSuffix, "").trim();
}

export function coverOf(e: Pick<EpisodeRow, "image" | "cover">): string {
  return e.cover || e.image || getSetting("podcast_cover", "");
}

export function guestsOfEpisode(episodeId: number): { id: number; slug: string; name: string; title: string; photo: string }[] {
  return db
    .prepare("SELECT g.id,g.slug,g.name,g.title,g.photo FROM guests g JOIN episode_guests eg ON eg.guest_id=g.id WHERE eg.episode_id=? AND g.published=1 ORDER BY g.sort,g.id")
    .all(episodeId) as { id: number; slug: string; name: string; title: string; photo: string }[];
}

/*
 * 最早一集的發布日期（about 頁「從 X 年 Y 月開始」用）。
 * pub_date 解析失敗時存空字串，空字串在字典序排序下比任何非空日期字串都小，
 * MIN(pub_date) 只要有任何一集是空字串，結果就是那個空字串而不是真正最早的日期，
 * 沒有這道過濾的話 about 頁那段文案會整段消失（空字串是 falsy）。
 */
export function firstPublishedDate(): string {
  const row = db.prepare("SELECT MIN(pub_date) AS d FROM episodes WHERE published=1 AND pub_date<>''").get() as { d: string | null };
  return row.d || "";
}

/*
 * 集數 -> 來賓人數的對照表，一次 JOIN 查完。
 * 後台集數列表原本對每一列各自下一次 SQL（guestCount(id)），而且同一列被呼叫
 * 兩次（判斷要不要顯示、顯示數字各一次），N 集就是 2N 次額外查詢；來賓列表
 * 早就用同樣的 JOIN 寫法處理過同樣需求，這裡補齊集數列表那邊的寫法。
 * 沒有來賓的集數不會出現在回傳的物件裡，呼叫端用 counts[id] || 0 取值。
 */
export function episodeGuestCounts(): Record<number, number> {
  const rows = db.prepare("SELECT episode_id AS id, COUNT(guest_id) AS n FROM episode_guests GROUP BY episode_id").all() as { id: number; n: number }[];
  const map: Record<number, number> = {};
  for (const r of rows) map[r.id] = r.n;
  return map;
}

/*
 * 集數 key／slug_alias 是否跟別集的 key 或 alias 撞號（後台 saveEpisode 存檔前檢查）。
 *
 * 舊查詢只驗證「新 key」是否撞到別集的 key 或 alias，沒有驗證「新 slug_alias」
 * 是否撞到別集的 key。可以把某集的英文別名設成另一集現有的 key 而不會跳錯，
 * 但 /ep/[key] 的 load() 一律先比對 key 再查 alias，這個別名會被真正持有
 * 那個 key 的集數永久擋住：後台顯示存檔成功，前台 301 永遠不會生效。
 * 兩個方向都要查，所以用 key／alias 兩個候選值同時比對對方的 key 欄與 alias 欄。
 */
export function episodeSlugConflict(id: number, key: string, alias: string): boolean {
  const candidates = alias ? [key, alias] : [key];
  const placeholders = candidates.map(() => "?").join(",");
  const row = db
    .prepare(`SELECT id FROM episodes WHERE id<>? AND (key IN (${placeholders}) OR (slug_alias<>'' AND slug_alias IN (${placeholders})))`)
    .get(id, ...candidates, ...candidates);
  return !!row;
}

/*
 * 逐字稿轉成 JSON-LD 用的純文字摘要（集數頁的結構化資料 transcript 欄位）。
 *
 * 舊寫法直接對 Markdown 原文 e.transcript.slice(0,5000) 硬切，`**粗體**`、
 * `[文字](網址)` 這類語法有機率被切一半，殘留的破碎符號會以字面文字塞進
 * 結構化資料。這裡先去掉常見 Markdown 語法轉成純文字，再找換行／句號等
 * 語意邊界截斷，避免在語法或詞彙正中間切斷。
 */
export function transcriptExcerpt(md: string, max = 5000): string {
  const plain = md
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)]\([^)]*\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^>\s?/gm, "")
    .replace(/^[-*+]\s+/gm, "")
    .replace(/(\*\*|__)(.*?)\1/g, "$2")
    .replace(/(\*|_)(.*?)\1/g, "$2")
    .replace(/`([^`]*)`/g, "$1")
    .trim();
  if (plain.length <= max) return plain;
  const cut = plain.slice(0, max);
  const boundary = Math.max(cut.lastIndexOf("\n"), cut.lastIndexOf("。"), cut.lastIndexOf("！"), cut.lastIndexOf("？"));
  return (boundary > max * 0.5 ? cut.slice(0, boundary + 1) : cut).trim();
}

export type GuestImportInput = {
  slug: string; name: string; title: string; intro: string; photo: string; links: string;
  published: number; featured: number; sort: number;
};

/*
 * 來賓匯入（tools/guests/push-guests.mjs → app/api/admin/import-guest 用）。
 *
 * 用 slug 當比對鍵，不是 name：guests.slug 在 schema 是 UNIQUE NOT NULL，
 * 是這張表真正的身分欄。舊寫法用 name 精確字串比對決定「更新既有這位」或
 * 「新增一位」，本機恰好有兩位同名不同人的來賓時，後推的那位會直接覆蓋
 * 前面那位的 slug／簡介／照片，兩人資料被靜默合併。
 */
export function upsertGuestImport(g: GuestImportInput, now: string): { action: "insert" | "update"; id: number } {
  const existing = db.prepare("SELECT id FROM guests WHERE slug=?").get(g.slug) as { id: number } | undefined;
  if (existing) {
    db.prepare(
      `UPDATE guests SET name=@name,title=@title,intro=@intro,photo=@photo,links=@links,published=@published,featured=@featured,sort=@sort,updated_at=@now WHERE id=@id`
    ).run({ ...g, now, id: existing.id });
    return { action: "update", id: existing.id };
  }
  const r = db.prepare(
    `INSERT INTO guests (slug,name,title,intro,photo,links,published,featured,sort,created_at,updated_at)
     VALUES (@slug,@name,@title,@intro,@photo,@links,@published,@featured,@sort,@now,@now)`
  ).run({ ...g, now });
  return { action: "insert", id: Number(r.lastInsertRowid) };
}

/*
 * 表單傳來的 id 是否為合法的資料庫主鍵（deleteEpisode／deleteGuest 存檔前檢查）。
 * formData.get("id") 轉 Number 後沒驗證是否為合法正整數；缺欄位或亂填時
 * Number() 得到 NaN，better-sqlite3 會把 NaN 當 REAL 綁進去，WHERE id=NaN
 * 比對不到任何列，DELETE 靜默無效，但後面仍會照常寫入操作記錄、導回列表頁，
 * 看起來像操作成功。回傳合法的正整數 id，不合法一律回 null。
 */
export function validDbId(v: unknown): number | null {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export function episodesOfGuest(guestId: number): EpisodeRow[] {
  return db
    .prepare("SELECT e.* FROM episodes e JOIN episode_guests eg ON eg.episode_id=e.id WHERE eg.guest_id=? AND e.published=1 ORDER BY e.pub_date DESC")
    .all(guestId) as EpisodeRow[];
}
