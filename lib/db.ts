import Database from "better-sqlite3";
import { NPOBAN_SEED } from "./data/npoban-seed";
import { isReviewSite } from "./review-mode";
import { TERMS_V2, PRIVACY_V2, RETURNS_V2 } from "./legal-v2";
import { BRAND } from "./brand";
import crypto from "crypto";
import path from "path";
import fs from "fs";

/*
 * 問爽的官網資料庫（2026-09-14 從佑在幹嘛官網 fork）。
 *
 * 佑在幹嘛那支 db.ts 是 3,165 行的「schema ＋ 一年份內容遷移」混合體，
 * 這裡只留 schema、預設設定與必要的種子（捐贈碼清單），內容一律走後台。
 *
 * 規則（沿用，違反就會在 Zeabur 的空資料庫上炸）：
 *   1. addColumn 一定放在對應 CREATE TABLE 之後。
 *   2. 一次性遷移用 settings 表的 key 當旗標擋重跑。
 *   3. 建表與種子放在延遲初始化裡：next build 會多程序平行 import 本檔。
 */

export const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), "data");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

let _db: Database.Database | null = null;

function initDb(): Database.Database {
const db = new Database(path.join(DATA_DIR, "site.db"));
db.pragma("journal_mode = WAL");
db.pragma("busy_timeout = 10000");

/* ═══════════════════════ 內容：集數、來賓、文章 ═══════════════════════ */
db.exec(`
/* 集數。欄位分兩群：
   RSS 唯讀群（guid、title、pub_date、duration、audio_*、image、rss_description、rss_link）
   每次同步都會被 SoundOn 的內容覆蓋；
   手動群（key、series、ep_no、short_title、summary、notes、transcript、chapters、tags、
   seo_title、slug_alias、published、sort）只在第一次匯入時給預設值，之後同步不動。
   分群寫在 lib/episodes.ts 的 upsert 裡，這裡只是宣告。 */
CREATE TABLE IF NOT EXISTS episodes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guid TEXT UNIQUE NOT NULL,
  key TEXT UNIQUE NOT NULL,                 /* 網址用：23 / submit-03 / 0 */
  series TEXT NOT NULL DEFAULT 'main',      /* main 正篇 | submit 投稿 | pilot 試播 | other */
  ep_no TEXT NOT NULL DEFAULT '',           /* 標題裡的集數字串，排序用 */
  title TEXT NOT NULL,                      /* RSS 原標題 */
  short_title TEXT NOT NULL DEFAULT '',     /* 手動精簡標題（列表與 H1 優先用它） */
  pub_date TEXT NOT NULL DEFAULT '',        /* ISO */
  duration INTEGER NOT NULL DEFAULT 0,      /* 秒 */
  audio_url TEXT NOT NULL DEFAULT '',
  audio_type TEXT NOT NULL DEFAULT '',
  audio_bytes INTEGER NOT NULL DEFAULT 0,
  image TEXT NOT NULL DEFAULT '',           /* RSS 封面（外部網址） */
  cover TEXT NOT NULL DEFAULT '',           /* 手動封面（後台上傳），優先於 image */
  rss_description TEXT NOT NULL DEFAULT '', /* 原始 HTML，永遠保留 */
  rss_link TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',           /* 節目筆記 Markdown */
  transcript TEXT NOT NULL DEFAULT '',      /* 逐字稿 Markdown */
  chapters TEXT NOT NULL DEFAULT '[]',      /* [{t:秒,label}] */
  tags TEXT NOT NULL DEFAULT '[]',
  seo_title TEXT NOT NULL DEFAULT '',
  slug_alias TEXT NOT NULL DEFAULT '',      /* 英文別名，301 到主網址 */
  published INTEGER NOT NULL DEFAULT 1,
  sort INTEGER NOT NULL DEFAULT 0,
  views INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT '',
  synced_at TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_episodes_pub ON episodes (published, pub_date DESC);
CREATE INDEX IF NOT EXISTS idx_episodes_alias ON episodes (slug_alias);

CREATE TABLE IF NOT EXISTS guests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',           /* 店家或頭銜 */
  intro TEXT NOT NULL DEFAULT '',           /* Markdown */
  photo TEXT NOT NULL DEFAULT '',
  links TEXT NOT NULL DEFAULT '[]',         /* [{label,url}] */
  published INTEGER NOT NULL DEFAULT 1,
  featured INTEGER NOT NULL DEFAULT 0,
  sort INTEGER NOT NULL DEFAULT 0,
  views INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS episode_guests (
  episode_id INTEGER NOT NULL,
  guest_id INTEGER NOT NULL,
  PRIMARY KEY (episode_id, guest_id)
);

/* 文章：不綁集數的 SEO 文章，沿用佑在幹嘛的 Markdown ＋ ::: 動態區塊 */
CREATE TABLE IF NOT EXISTS articles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  category TEXT NOT NULL,
  tags TEXT NOT NULL DEFAULT '[]',
  date TEXT NOT NULL,
  read_min INTEGER NOT NULL DEFAULT 5,
  location TEXT DEFAULT '',
  summary TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  published INTEGER NOT NULL DEFAULT 1,
  sort INTEGER DEFAULT 0,
  views INTEGER DEFAULT 0,
  cover TEXT DEFAULT '',
  author TEXT DEFAULT '${BRAND.name}',
  seo_title TEXT DEFAULT '',
  updated_at TEXT DEFAULT '',
  entities TEXT DEFAULT '',
  sources TEXT DEFAULT '',
  cta_text TEXT DEFAULT '',
  cta_shop INTEGER NOT NULL DEFAULT 1,
  cta_support INTEGER NOT NULL DEFAULT 1
);
`);

/* ═══════════════════════ 商店、訂單、贊助（第 3 段施工，先鎖站長模式） ═══════════════════════ */
db.exec(`
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  price INTEGER NOT NULL,
  stock INTEGER NOT NULL DEFAULT 0,
  description TEXT NOT NULL DEFAULT '',
  option_name TEXT,
  option_choices TEXT NOT NULL DEFAULT '[]',
  story TEXT NOT NULL DEFAULT '[]',
  spec TEXT NOT NULL DEFAULT '[]',
  featured INTEGER NOT NULL DEFAULT 0,
  published INTEGER NOT NULL DEFAULT 1,
  views INTEGER DEFAULT 0,
  image TEXT DEFAULT '',
  sort INTEGER DEFAULT 0,
  price_original INTEGER DEFAULT 0,
  price_note TEXT DEFAULT '',
  notice TEXT DEFAULT '',
  choice_stocks TEXT DEFAULT '{}',
  soldout_label TEXT DEFAULT '',
  images TEXT DEFAULT '[]',
  soldout_collapse INTEGER DEFAULT 0,
  partner_id INTEGER DEFAULT NULL,
  temp_zone TEXT DEFAULT 'ambient',
  choice_expiry TEXT DEFAULT '{}',
  ship_note TEXT DEFAULT '',
  corp_entry INTEGER DEFAULT 0,
  free_ship INTEGER DEFAULT 0,
  notify INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_no TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT NOT NULL,
  address TEXT NOT NULL,
  pay_method TEXT NOT NULL,
  invoice_type TEXT NOT NULL,
  invoice_data TEXT NOT NULL DEFAULT '{}',
  items TEXT NOT NULL,
  subtotal INTEGER NOT NULL,
  shipping INTEGER NOT NULL,
  total INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'paid',
  tracking_no TEXT DEFAULT '',
  created_at TEXT NOT NULL,
  ship_detail TEXT DEFAULT '',
  refunded_at TEXT DEFAULT '',
  addon_amount INTEGER DEFAULT 0,
  ship_list TEXT DEFAULT '[]',
  zip TEXT DEFAULT '',
  discount_code TEXT DEFAULT '',
  discount_amount INTEGER DEFAULT 0,
  trade_no TEXT DEFAULT '',
  token TEXT DEFAULT '',
  ga_sid TEXT DEFAULT '',
  ga_snum TEXT DEFAULT '',
  remind_at TEXT DEFAULT '',
  remind_count INTEGER NOT NULL DEFAULT 0,
  pay_link TEXT DEFAULT '',
  fail_mailed INTEGER NOT NULL DEFAULT 0,
  contacted_at TEXT DEFAULT '',
  remind_round INTEGER NOT NULL DEFAULT 0,
  remind_seq INTEGER NOT NULL DEFAULT 0,
  remind_stop INTEGER NOT NULL DEFAULT 0,
  round_started_at TEXT DEFAULT '',
  gift INTEGER NOT NULL DEFAULT 0,
  source TEXT DEFAULT '',
  env TEXT DEFAULT '',
  charge_lock_at TEXT DEFAULT '',
  invoice_lock_at TEXT DEFAULT '',
  pay_note TEXT DEFAULT '',
  line_optin INTEGER DEFAULT 0,
  ship_method TEXT DEFAULT '宅配',
  admin_seen INTEGER DEFAULT 0,
  notified INTEGER DEFAULT 0,
  ga_cid TEXT DEFAULT '',
  invoice_no TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS sponsorships (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mode TEXT NOT NULL,
  amount INTEGER NOT NULL,
  display_name TEXT DEFAULT '',
  message TEXT DEFAULT '',
  email TEXT NOT NULL,
  pay_method TEXT NOT NULL,
  invoice_type TEXT NOT NULL,
  invoice_data TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  wish_topic TEXT DEFAULT '',
  source TEXT DEFAULT '',
  env TEXT DEFAULT '',
  remind_round INTEGER NOT NULL DEFAULT 0,
  remind_seq INTEGER NOT NULL DEFAULT 0,
  remind_stop INTEGER NOT NULL DEFAULT 0,
  round_started_at TEXT DEFAULT '',
  fail_mailed INTEGER NOT NULL DEFAULT 0,
  charge_fail_count INTEGER NOT NULL DEFAULT 0,
  phone TEXT DEFAULT '',
  newsletter INTEGER DEFAULT 1,
  contacted_at TEXT DEFAULT '',
  line_asked_at TEXT DEFAULT '',
  trade_no TEXT DEFAULT '',
  provider TEXT DEFAULT '',
  pay_token TEXT DEFAULT '',
  invoice_no TEXT DEFAULT '',
  atm_bank TEXT DEFAULT '',
  atm_vaccount TEXT DEFAULT '',
  atm_expire TEXT DEFAULT '',
  credit_token TEXT DEFAULT '',
  credit_hash TEXT DEFAULT '',
  next_charge_at TEXT DEFAULT '',
  last_charge_note TEXT DEFAULT '',
  ga_cid TEXT DEFAULT '',
  ga_sid TEXT DEFAULT '',
  ga_snum TEXT DEFAULT '',
  remind_at TEXT DEFAULT '',
  remind_count INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS sponsor_charges (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sponsorship_id INTEGER NOT NULL,
  mer_trade_no TEXT NOT NULL,
  trade_no TEXT DEFAULT '',
  amount INTEGER NOT NULL,
  status TEXT NOT NULL,
  note TEXT DEFAULT '',
  created_at TEXT NOT NULL,
  invoice_no TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS sponsor_trade_nos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sponsorship_id INTEGER NOT NULL,
  trade_no TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sponsor_trade_nos_sp ON sponsor_trade_nos (sponsorship_id, id);
CREATE TABLE IF NOT EXISTS discount_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE NOT NULL,
  kind TEXT NOT NULL DEFAULT 'percent',
  value INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT '',
  name TEXT DEFAULT '',
  expires_at TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS pay_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL DEFAULT '',
  items TEXT NOT NULL,
  need_address INTEGER NOT NULL DEFAULT 1,
  pays TEXT NOT NULL DEFAULT '[]',
  hold_days INTEGER NOT NULL DEFAULT 30,
  inv_tax_id TEXT DEFAULT '',
  inv_company TEXT DEFAULT '',
  preset_name TEXT DEFAULT '',
  preset_phone TEXT DEFAULT '',
  preset_email TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open',
  order_no TEXT DEFAULT '',
  reserved INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  used_at TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS partners (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  key TEXT NOT NULL UNIQUE,
  pin TEXT NOT NULL DEFAULT '',
  notify_emails TEXT NOT NULL DEFAULT '',
  ship_origin TEXT NOT NULL DEFAULT '',
  cvs_brand TEXT NOT NULL DEFAULT '7-11',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS npoban (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL
);
`);

/* ═══════════════════════ 通知、寄信、名單（程式保留，先不開） ═══════════════════════ */
db.exec(`
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sms_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  phone TEXT NOT NULL,
  content TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'manual',
  status TEXT NOT NULL DEFAULT 'sent',
  error TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS line_bindings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  line_user_id TEXT NOT NULL UNIQUE,
  phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  user_id INTEGER,
  status TEXT NOT NULL DEFAULT 'bound',
  source TEXT NOT NULL DEFAULT '',
  order_no TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  blocked_at TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_line_bindings_phone ON line_bindings(phone);
CREATE INDEX IF NOT EXISTS idx_line_bindings_email ON line_bindings(email);
CREATE TABLE IF NOT EXISTS line_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  line_user_id TEXT NOT NULL,
  order_no TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL DEFAULT 'manual',
  content TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'sent',
  error TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS newsletters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subject TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  btn_text TEXT NOT NULL DEFAULT '',
  btn_url TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TEXT NOT NULL,
  started_at TEXT NOT NULL DEFAULT '',
  finished_at TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS newsletter_sends (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  newsletter_id INTEGER NOT NULL,
  email TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  error TEXT NOT NULL DEFAULT '',
  sent_at TEXT NOT NULL DEFAULT '',
  UNIQUE(newsletter_id, email)
);
CREATE INDEX IF NOT EXISTS idx_nlsend_pending ON newsletter_sends(newsletter_id, status);
CREATE TABLE IF NOT EXISTS notify_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  ref_id INTEGER NOT NULL,
  ref_no TEXT NOT NULL DEFAULT '',
  event TEXT NOT NULL,
  channel TEXT NOT NULL,
  status TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notify_log_ref ON notify_log(kind, ref_id);
CREATE TABLE IF NOT EXISTS mail_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL DEFAULT 'routine',
  route TEXT NOT NULL DEFAULT '',
  to_addr TEXT NOT NULL,
  subject TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  ref_no TEXT NOT NULL DEFAULT '',
  body_hash TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS mail_body (
  hash TEXT PRIMARY KEY,
  html TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mail_log_to ON mail_log(to_addr);
CREATE INDEX IF NOT EXISTS idx_mail_log_ref ON mail_log(ref_no);
CREATE INDEX IF NOT EXISTS idx_mail_log_at ON mail_log(created_at);
CREATE TABLE IF NOT EXISTS notify_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  ref_id INTEGER NOT NULL,
  event TEXT NOT NULL,
  channel TEXT NOT NULL,
  payload TEXT NOT NULL DEFAULT '{}',
  due_at TEXT NOT NULL,
  sent_at TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL DEFAULT '',
  avatar TEXT NOT NULL DEFAULT '',
  provider TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  newsletter INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  last_login_at TEXT NOT NULL DEFAULT '',
  UNIQUE(provider, provider_id)
);
CREATE TABLE IF NOT EXISTS mail_blocked (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  reason TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS subscribers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  unsub_token TEXT DEFAULT '',
  unsubscribed_at TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS page_views (
  page TEXT NOT NULL,
  ym TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (page, ym)
);
CREATE TABLE IF NOT EXISTS poll_votes (
  key TEXT NOT NULL,
  opt INTEGER NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (key, opt)
);
CREATE TABLE IF NOT EXISTS short_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  target TEXT NOT NULL,
  channel TEXT NOT NULL DEFAULT 'manual',
  clicks INTEGER NOT NULL DEFAULT 0,
  blocked INTEGER NOT NULL DEFAULT 0,
  last_click_at TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_short_links_target ON short_links (target, channel);
`);

/* ═══════════════════════ 後台帳號（3 人各自登入，記錄誰改了什麼） ═══════════════════════ */
db.exec(`
CREATE TABLE IF NOT EXISTS admin_users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  pass_hash TEXT NOT NULL,                  /* scrypt，格式 salt:hash（lib/admin-users.ts） */
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  last_login_at TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS admin_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_name TEXT NOT NULL DEFAULT '',
  action TEXT NOT NULL,
  target TEXT NOT NULL DEFAULT '',
  detail TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_admin_log_at ON admin_log (created_at DESC);
`);

/* ── 輕量 migration：舊資料庫補欄位（新表要加欄位時用，放在對應 CREATE TABLE 之後） ── */
function addColumn(table: string, col: string, def: string) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!cols.some((c) => c.name === col)) {
    try {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
    } catch (e) {
      if (!(e instanceof Error && e.message.includes("duplicate column"))) throw e;
    }
  }
}
/*
 * 訂購人／收件人可以分開。留空＝同訂購人，這是唯一的判斷依據
 * （lib/recipient.ts 的 recipientOf 統一處理顯示），
 * 資料庫這裡不回填、不改寫任何一筆舊訂單。
 */
addColumn("orders", "recipient_name", "TEXT DEFAULT ''");
addColumn("orders", "recipient_phone", "TEXT DEFAULT ''");

/* ═══════════════════════ 預設設定（既有資料庫不覆蓋） ═══════════════════════ */
const defSet = db.prepare("INSERT OR IGNORE INTO settings (key,value) VALUES (?,?)");

/* 站長模式：商店、支持、電子報三塊先鎖。商店靠 shop_enabled=0 ＋預覽金鑰；
   支持靠 support_mode=off；電子報區塊靠 newsletter_block=0。第 3 段施工完再開。 */
defSet.run("shop_enabled", "0");
defSet.run("support_mode", "off");
defSet.run("newsletter_block", "0");
defSet.run("shop_gateway", "ecpay");
/* 付款方式：第 3 段接藍新，先只留信用卡與 ATM */
defSet.run("pay_methods_off", JSON.stringify(["linepay", "applepay", "samsungpay", "twqr"]));
defSet.run("product_categories", "周邊,其他");
defSet.run("ship_fee", "120");
defSet.run("ship_fee_cvs", "65");
defSet.run("free_ship_threshold", "1500");
defSet.run("freight_mode", "flat");
defSet.run("cold_enabled", "0");
defSet.run("partner_late_days", "0");
defSet.run("addon_tiers", JSON.stringify([100, 300, 1000, 3000]));
defSet.run("sponsor_tiers", JSON.stringify([150, 500, 1500, 5000]));
defSet.run("sponsor_lead", BRAND.sponsorLead);
/* 站長通知信箱：備份與站內通知都寄這裡（站長 2026-09-14 決定寄 hi@wensong.tw） */
defSet.run("owner_notify_emails", BRAND.email);
defSet.run("notify_emails", "");
defSet.run("line_quota_monthly", "200");
defSet.run("line_notify_on", "0");
defSet.run("line_test_user_ids", "");
defSet.run("social_fb", "");
defSet.run("social_ig", "");
defSet.run("social_yt", "");
/* 節目連結：RSS 來源與各收聽平台（後台「設定・內容」可改） */
defSet.run("podcast_rss_url", BRAND.rssUrl);
defSet.run("platform_soundon", BRAND.soundonLink);
defSet.run("platform_apple", "");
defSet.run("platform_spotify", "");
defSet.run("platform_kkbox", "");
defSet.run("platform_youtube", "");
/* 主持人簡介（首頁主持人區與關於頁用；後台可改） */
defSet.run("host_1_name", BRAND.hosts[0].name);
defSet.run("host_1_title", BRAND.hosts[0].title);
defSet.run("host_1_intro", BRAND.hosts[0].intro);
defSet.run("host_1_photo", "");
defSet.run("host_1_link", BRAND.hosts[0].link);
defSet.run("host_2_name", BRAND.hosts[1].name);
defSet.run("host_2_title", BRAND.hosts[1].title);
defSet.run("host_2_intro", BRAND.hosts[1].intro);
defSet.run("host_2_photo", "");
defSet.run("host_2_link", BRAND.hosts[1].link);
/* 法律頁：從問爽的 v2 版換品牌（lib/legal-v2.ts），後台「設定・內容」可再改 */
defSet.run("terms_md", TERMS_V2);
defSet.run("privacy_md", PRIVACY_V2);
defSet.run("returns_md", RETURNS_V2);
/* 通知整合：上線時間與 dry run 旗標（沿用 docs/notify-spec.md） */
{
  const launched = db.prepare("SELECT value FROM settings WHERE key='notify_launch_at'").get() as { value: string } | undefined;
  if (!launched) {
    db.prepare("INSERT INTO settings (key,value) VALUES ('notify_launch_at',?)").run(new Date().toISOString());
    defSet.run("notify_dry_run", "1");
    defSet.run("notify_pause", "0");
  }
}

/* ── 隨機金鑰：只產生一次，跟著 volume 走 ── */
const randKey = (key: string, bytes: number, enc: "hex" | "base64url") => {
  if (!db.prepare("SELECT 1 FROM settings WHERE key=?").get(key)) {
    db.prepare("INSERT INTO settings (key,value) VALUES (?,?)").run(key, crypto.randomBytes(bytes).toString(enc));
  }
};
randKey("instance_secret", 32, "hex");   /* 後台 session 等 HMAC 的後備金鑰（ADMIN_SECRET 優先） */
randKey("shop_preview_key", 12, "base64url"); /* 商店預覽連結（站長模式的鑰匙） */
randKey("plan_preview_key", 12, "base64url");
randKey("partner_key", 12, "base64url");
defSet.run("partner_pin", "0201");

/* ── 捐贈碼清單（財政部開放資料）：表是空的才灌，之後由後台按鈕更新 ── */
if ((db.prepare("SELECT COUNT(*) AS n FROM npoban").get() as { n: number }).n === 0) {
  const ins = db.prepare("INSERT OR REPLACE INTO npoban (code,name) VALUES (?,?)");
  const rows = Object.entries(NPOBAN_SEED);
  db.transaction(() => {
    for (const [code, name] of rows) ins.run(code, name);
  })();
  db.prepare("INSERT INTO settings (key,value) VALUES ('npoban_updated_at',?) ON CONFLICT(key) DO NOTHING")
    .run("2026-08-31（隨程式碼附帶的版本）");
}

/* ── 審核用測試站（REVIEW_SITE=1）：商店與支持先開，讓審核人員看得到 ── */
if (isReviewSite() && (db.prepare("SELECT COUNT(*) AS n FROM settings WHERE key='review_seed_v1'").get() as { n: number }).n === 0) {
  const set = db.prepare("INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value");
  set.run("shop_enabled", "1");
  set.run("support_mode", "hybrid");
  db.prepare("INSERT INTO settings (key,value) VALUES ('review_seed_v1','1')").run();
}

return db;
}

function ensureDb(): Database.Database {
  if (!_db) _db = initDb();
  return _db;
}

/* 對外介面：其他檔案照樣 import db 來用，第一次呼叫方法時才真正開庫 */
const dbLazy = new Proxy({} as Database.Database, {
  get(_target, prop) {
    const d = ensureDb();
    const v = Reflect.get(d, prop);
    return typeof v === "function" ? (v as (...args: unknown[]) => unknown).bind(d) : v;
  },
});

export default dbLazy;

/* ── helpers ── */
export function getSetting(key: string, fallback = ""): string {
  const row = ensureDb().prepare("SELECT value FROM settings WHERE key=?").get(key) as { value: string } | undefined;
  return row ? row.value : fallback;
}
export function setSetting(key: string, value: string) {
  ensureDb().prepare("INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(key, value);
}
export function json<T>(s: string, fallback: T): T {
  try { return JSON.parse(s) as T; } catch { return fallback; }
}
