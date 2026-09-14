/*
 * 設定鍵 ←→ 表單欄位的對照表（設定拆六頁，2026-09-05）。
 *
 * 為什麼需要這張表：以前 /admin/settings 是一整頁一顆儲存，saveSettings 讀「全部」欄位、
 * 寫「全部」鍵，沒讀到就當成空值寫回去也不會出事，因為表單一定帶著全部欄位。
 * 拆成六頁之後每一次送出只帶自己那一頁的欄位，同一支 saveSettings 如果照舊無條件寫，
 * 按一下商店頁的儲存就會把通知、內容、金流那三頁的設定全部洗成空白，
 * 而且畫面上不會有任何跡象，要等到客人收不到信才會發現。
 *
 * 所以規則只有一條：一個設定鍵的來源欄位，這次送出的表單裡一個都沒有，就完全不碰它。
 * 判斷邏輯放在這支純函式檔（不 import react、不 import lib/db），
 * actions.ts 與冒煙測試共用同一份，才不會兩邊各寫一套然後慢慢對不上。
 */

/* 每個設定鍵由哪些表單欄位決定。多對一（例如四階金額）就列出全部，有任何一個在就算這頁有送 */
export const SETTING_SOURCES: Record<string, string[]> = {
  /* ── 贊助頁 ── */
  sponsor_tiers: ["tier_1", "tier_2", "tier_3", "tier_4"],
  addon_tiers: ["addon_1", "addon_2", "addon_3", "addon_4"],
  sponsor_lead: ["sponsor_lead"],
  addon_enabled: ["addon_enabled"],
  nav_support_home: ["nav_support_home"],
  nav_support_shop: ["nav_support_shop"],
  home_support_section: ["home_support_section"],
  footer_business_model: ["footer_business_model"],
  /* support_enabled 是舊鍵，跟著 support_mode 一起算，來源欄位也是 support_mode */
  support_mode: ["support_mode"],
  support_enabled: ["support_mode"],
  support_url: ["support_url"],
  /* 每月定額走藍新還是外連（設定・贊助）。漏了這行時 saveSettings 的 has() 永遠 false，怎麼存都存不進去（2026-09-14 站長實測） */
  monthly_gateway: ["monthly_gateway"],

  /* ── 商店頁 ── */
  shop_enabled: ["shop_enabled"],
  product_categories: ["product_categories"],
  free_ship_threshold: ["free_ship_threshold"],
  ship_fee: ["ship_fee"],
  ship_fee_cvs: ["ship_fee_cvs"],
  rate_charge_ambient_home: ["rate_charge_ambient_home"],
  rate_charge_ambient_cvs: ["rate_charge_ambient_cvs"],
  rate_charge_cold_home: ["rate_charge_cold_home"],
  rate_charge_cold_cvs: ["rate_charge_cold_cvs"],
  rate_cost_ambient_home: ["rate_cost_ambient_home"],
  rate_cost_ambient_cvs: ["rate_cost_ambient_cvs"],
  rate_cost_cold_home: ["rate_cost_cold_home"],
  rate_cost_cold_cvs: ["rate_cost_cold_cvs"],
  rate_free_ambient_home: ["rate_free_ambient_home"],
  rate_free_ambient_cvs: ["rate_free_ambient_cvs"],
  rate_free_cold_home: ["rate_free_cold_home"],
  rate_free_cold_cvs: ["rate_free_cold_cvs"],
  cold_enabled: ["cold_enabled"],
  partner_late_days: ["partner_late_days"],
  cvs_brand_own: ["cvs_brand_own"],
  freight_mode: ["freight_mode"],
  notify_all_products: ["notify_all_products"],
  notify_emails: ["notify_emails"],
  owner_notify_emails: ["owner_notify_emails"],
  article_shop_cta: ["article_shop_cta"],
  article_shop_href: ["article_shop_href"],
  home_who_img: ["home_who_img"],
  pillar_img_1: ["pillar_img_1"],
  pillar_img_2: ["pillar_img_2"],
  pillar_img_3: ["pillar_img_3"],
  pillar_img_4: ["pillar_img_4"],
  pillar_img_5: ["pillar_img_5"],
  /*
   * 付款方式那兩排是「沒勾就完全不送」的 checkbox（跟 Switch 不一樣，前面沒有藏 value="0"），
   * 所以沒辦法用欄位本身判斷這一區在不在，要靠同一區裡的隱藏標記 pm_form。
   * 沒有這個標記就代表這次的表單根本沒有付款方式那一區，三個鍵一律不動。
   */
  pay_methods_off_shop: ["pm_form"],
  pay_methods_off_support: ["pm_form"],
  pay_methods_off: ["pm_form"],
  /* LINE Pay 探測成功時清掉失敗紀錄，也只在有付款方式那一區時才會發生 */
  linepay_last_error: ["pm_form"],
  ecpay_atm_bank: ["ecpay_atm_bank"],
  ecpay_atm_backstage: ["ecpay_atm_backstage"],
  newebpay_atm_bank: ["newebpay_atm_bank"],
  applepay_onsite: ["applepay_onsite"],

  /* ── 金流頁 ── */
  shop_gateway: ["shop_gateway"],

  /* ── 通知頁 ── */
  notify_pause: ["notify_pause"],
  notify_dry_run: ["notify_dry_run"],
  mail_copy_to: ["mail_copy_to"],
  mail_copy_manual: ["mail_copy_manual"],
  mail_copy_remind: ["mail_copy_remind"],
  mail_copy_routine: ["mail_copy_routine"],
  mail_copy_owner: ["mail_copy_owner"],
  line_notify_on: ["line_notify_on"],
  line_collect_email: ["line_collect_email"],
  line_quota_monthly: ["line_quota_monthly"],
  line_test_user_ids: ["line_test_user_ids"],

  /* ── 內容頁 ── */
  social_fb: ["social_fb"],
  social_ig: ["social_ig"],
  social_yt: ["social_yt"],
  privacy_md: ["privacy_md"],
  terms_md: ["terms_md"],
  returns_md: ["returns_md"],
  podcast_rss_url: ["podcast_rss_url"],
  platform_apple: ["platform_apple"],
  platform_spotify: ["platform_spotify"],
  platform_kkbox: ["platform_kkbox"],
  platform_youtube: ["platform_youtube"],
  platform_soundon: ["platform_soundon"],
  host_1_name: ["host_1_name"], host_1_title: ["host_1_title"], host_1_intro: ["host_1_intro"], host_1_photo: ["host_1_photo"], host_1_link: ["host_1_link"],
  host_2_name: ["host_2_name"], host_2_title: ["host_2_title"], host_2_intro: ["host_2_intro"], host_2_photo: ["host_2_photo"], host_2_link: ["host_2_link"],
  newsletter_block: ["newsletter_block"],
};

/*
 * 文案信件（copy_*）與通知文案（ncopy_*）的欄位名就等於設定鍵名，數量上百條且由
 * lib/copy 與 lib/notify-copy 定義，列進上面那張表只會多一份要同步的清單。
 * 它們的規則本來就是「表單裡有這一格才寫」，用前綴判斷即可。
 */
export const PREFIXES = ["copy_", "ncopy_"];

/* 這次送出的表單（欄位名清單）會寫到哪些設定鍵。沒列出來的鍵這次一定不會被動到 */
export function willWrite(presentFields: Iterable<string>): string[] {
  const present = new Set(presentFields);
  const keys = new Set<string>();
  for (const [key, sources] of Object.entries(SETTING_SOURCES)) {
    if (sources.some((f) => present.has(f))) keys.add(key);
  }
  for (const f of present) {
    if (PREFIXES.some((p) => f.startsWith(p))) keys.add(f);
  }
  return [...keys].sort();
}

/* 單一設定鍵這次有沒有被送出來。actions.ts 的每一個 setSetting 前面都要問過這一句 */
export function carriesField(presentFields: Iterable<string>, settingKey: string): boolean {
  const present = new Set(presentFields);
  if (PREFIXES.some((p) => settingKey.startsWith(p))) return present.has(settingKey);
  return (SETTING_SOURCES[settingKey] || []).some((f) => present.has(f));
}
