import db from "./db";

/*
 * 夥伴的純資料層。跟 lib/partner.ts 拆開的原因：
 * 那支 import 了 next/headers（讀 cookie 驗身分），任何脫離 request 環境的程式
 * （結算計算、排程、測試）一碰就炸。這裡只有查表，誰都能用。
 */

export type Partner = {
  id: number; name: string; key: string; pin: string;
  notify_emails: string; ship_origin: string; cvs_brand: string; active: number;
};

export function partnerByKey(key: string): Partner | undefined {
  if (!key) return undefined;
  return db.prepare("SELECT * FROM partners WHERE key=? AND active=1").get(key) as Partner | undefined;
}

export function partnerById(id: number): Partner | undefined {
  return db.prepare("SELECT * FROM partners WHERE id=?").get(id) as Partner | undefined;
}

export function allPartners(): Partner[] {
  return db.prepare("SELECT * FROM partners ORDER BY id").all() as Partner[];
}
