/*
 * 電話號碼的正規化與檢查。
 *
 * 為什麼要獨立一支：贈品單跟結帳單對電話的要求本來就不一樣。
 *
 * 結帳單收的是「買東西的本人」，簡訊、超商取貨通知都要打得到他，
 * 所以那邊維持嚴格的手機格式（09 開頭 10 碼），不改。
 *
 * 贈品單收的是「站長要送的人」，那份名單是從各種地方抄來的：
 * 有人只留店裡的市話（04 2235 1691）、有人是 07 開頭 9 碼、
 * 有人會寫成 0970-107-502 或 (02)2700-1234。
 * 這些號碼宅配司機打得通，是真的能用的電話，不該被擋在門外。
 *
 * 所以這裡的規則是「看得出來是台灣的電話就收」，把清洗留給 normalize，
 * 把判斷留給 phoneKind——需要嚴格的地方自己去看 kind 是不是 mobile。
 */

/* 全形數字與各種分隔符號都清掉，+886 換回 0，分機用 # 保留。
   為什麼保留分機：寄到公司或店裡的貨，沒有分機司機就找不到人。 */
export function normalizePhone(v: string | null | undefined): string {
  let s = String(v || "").trim();
  /* 全形數字轉半形（從 Excel、LINE 複製過來很常見） */
  s = s.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
  /* 分機的各種寫法統一成 # */
  s = s.replace(/\s*(分機|轉|ext\.?|#)\s*/gi, "#");
  /* 國碼 +886 或 886 開頭換回 0 */
  s = s.replace(/^\s*(\+?886)[\s-]*/, "0");
  /* 剩下的分隔符號全部清掉，只留數字與 # */
  s = s.replace(/[^\d#]/g, "");
  /* 清完之後如果不是 0 開頭又是 9 碼以上，通常是漏打前面的 0（例如 987654321） */
  return s;
}

export type PhoneKind = "mobile" | "landline" | "other" | "bad";

/*
 * 判斷這是哪一種號碼。
 *
 * mobile：09 開頭 10 碼，可以發簡訊。
 * landline：0 開頭、總長 9 到 11 碼（含區碼），例如 02-27001234、04-22351691、
 *           037-123456、089-123456。台灣市話含區碼就是 9 到 10 碼，
 *           留到 11 是給 0800 這種特殊碼。
 * other：不是 0 開頭但長度合理，例如有人只寫了 27001234 這種沒區碼的。
 *        這種號碼司機要自己補區碼，會有麻煩，所以另外標一類讓介面提醒。
 * bad：短到不可能是電話，或根本沒有數字。
 */
export function phoneKind(v: string | null | undefined): PhoneKind {
  const s = normalizePhone(v).split("#")[0];
  if (!/^\d+$/.test(s)) return "bad";
  if (/^09\d{8}$/.test(s)) return "mobile";
  if (/^0\d{8,10}$/.test(s)) return "landline";
  if (s.length >= 7 && s.length <= 15) return "other";
  return "bad";
}

/* 贈品單用的門檻：只要看得出來是電話就放行 */
export function phoneUsable(v: string | null | undefined): boolean {
  return phoneKind(v) !== "bad";
}

/* 只有這一種才能發簡訊——要不要提醒站長「這位收不到簡訊」用得上 */
export function isMobile(v: string | null | undefined): boolean {
  return phoneKind(v) === "mobile";
}
